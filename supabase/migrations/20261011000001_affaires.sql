-- Lot 2 : affaires et cohérence des pipelines (relecture du 10 octobre : P02 à P05).
--
-- * Une affaire (deal) = un projet chez un client qui parcourt un pipeline. L'avancement se calcule
--   par affaire, à partir de ses actions ; il n'est jamais stocké.
-- * Une affaire n'utilise qu'un pipeline commun ou celui du groupe du client.
-- * Une action liée à une étape l'est via une affaire du même client, sur le pipeline de cette étape.
-- * Position d'étape unique par pipeline ; réordonnancement en une transaction.
-- * Une structure utilisée (groupe, pipeline, étape) ne se supprime pas : on l'archive.

-- ─────────────────────────────────────────────────────────────
-- Archivage
-- ─────────────────────────────────────────────────────────────

alter table public.client_groups add column archived_at timestamptz;
alter table public.pipelines add column archived_at timestamptz;
alter table public.pipeline_steps add column archived_at timestamptz;

-- Supprimer un groupe ne supprime plus ses pipelines (et donc l'historique) : refusé s'il en a.
alter table public.pipelines drop constraint pipelines_organization_id_group_id_fkey;
alter table public.pipelines add constraint pipelines_organization_id_group_id_fkey
  foreign key (organization_id, group_id) references public.client_groups (organization_id, id) on delete restrict;

-- Une étape utilisée par des actions ne se supprime plus (avant : l'action perdait son étape).
alter table public.actions drop constraint actions_organization_id_step_id_fkey;
alter table public.actions add constraint actions_organization_id_step_id_fkey
  foreign key (organization_id, step_id) references public.pipeline_steps (organization_id, id) on delete restrict;

-- ─────────────────────────────────────────────────────────────
-- Ordre des étapes
-- ─────────────────────────────────────────────────────────────

alter table public.pipeline_steps add constraint pipeline_steps_position_unique
  unique (pipeline_id, position) deferrable initially immediate;

-- Réordonne toutes les étapes d'un pipeline en une fois : step_ids dans le nouvel ordre.
create function public.reorder_pipeline_steps(pipeline uuid, step_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  expected int;
begin
  select count(*) into expected from public.pipeline_steps s where s.pipeline_id = pipeline;
  if expected = 0 or expected <> cardinality(step_ids)
     or expected <> (select count(distinct x) from unnest(step_ids) x) then
    raise exception 'step list must contain each step of the pipeline exactly once' using errcode = '22023';
  end if;
  set constraints public.pipeline_steps_position_unique deferred;
  -- Sous RLS : seules les étapes visibles (donc du compte) sont modifiées.
  update public.pipeline_steps s
  set position = o.ord - 1
  from unnest(step_ids) with ordinality as o(id, ord)
  where s.id = o.id and s.pipeline_id = pipeline;
  if not found then
    raise exception 'pipeline not found' using errcode = '22023';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Affaires
-- ─────────────────────────────────────────────────────────────

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  pipeline_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'abandoned')),
  opened_on date not null default current_date,
  closed_on date,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  check ((status = 'open') = (closed_on is null)),
  foreign key (organization_id, client_id) references public.clients (organization_id, id) on delete cascade,
  foreign key (organization_id, pipeline_id) references public.pipelines (organization_id, id) on delete restrict
);
create index deals_client_idx on public.deals (client_id);

-- P04 : le pipeline d'une affaire est commun (sans groupe) ou celui du groupe du client.
create function public.check_deal_pipeline()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pipeline_group uuid;
  client_group uuid;
begin
  select p.group_id into pipeline_group from public.pipelines p where p.id = new.pipeline_id;
  if not found then
    return new; -- pipeline invisible (autre compte) : la clé étrangère composite refusera
  end if;
  select c.group_id into client_group from public.clients c where c.id = new.client_id;
  if not found then
    return new; -- client invisible : idem
  end if;
  if pipeline_group is not null and pipeline_group is distinct from client_group then
    raise exception 'pipeline does not apply to this client''s group' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger deals_pipeline_check before insert or update of client_id, pipeline_id on public.deals
  for each row execute function public.check_deal_pipeline();

-- Changer le groupe d'un client qui a des affaires ouvertes sur le pipeline d'un autre groupe : refusé.
create function public.check_client_group_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is not null and not exists (select 1 from public.client_groups g where g.id = new.group_id) then
    return new; -- groupe invisible (autre compte) : la clé étrangère composite refusera
  end if;
  if exists (
    select 1 from public.deals d join public.pipelines p on p.id = d.pipeline_id
    where d.client_id = new.id and d.status = 'open'
      and p.group_id is not null and p.group_id is distinct from new.group_id
  ) then
    raise exception 'client has open deals on another group''s pipeline' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger clients_group_change_check before update of group_id on public.clients
  for each row when (new.group_id is distinct from old.group_id)
  execute function public.check_client_group_change();

-- Actions : une étape n'est utilisée que via une affaire du même client, sur le pipeline de l'étape.
alter table public.actions add column deal_id uuid;
alter table public.actions add constraint actions_organization_id_deal_id_fkey
  foreign key (organization_id, deal_id) references public.deals (organization_id, id) on delete cascade;
create index actions_deal_idx on public.actions (deal_id);

create function public.check_action_deal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  deal_client uuid;
  deal_pipeline uuid;
  step_pipeline uuid;
begin
  if not exists (select 1 from public.clients c where c.id = new.client_id) then
    return new; -- client invisible (autre compte) : la clé étrangère composite refusera
  end if;
  if new.step_id is not null and new.deal_id is null then
    raise exception 'an action on a pipeline step must belong to a deal' using errcode = '23514';
  end if;
  if new.deal_id is not null then
    select d.client_id, d.pipeline_id into deal_client, deal_pipeline from public.deals d where d.id = new.deal_id;
    if not found then
      return new; -- affaire invisible (autre compte) : la clé étrangère composite refusera
    end if;
    if deal_client is distinct from new.client_id then
      raise exception 'deal belongs to another client' using errcode = '23514';
    end if;
    if new.step_id is not null then
      select s.pipeline_id into step_pipeline from public.pipeline_steps s where s.id = new.step_id;
      if found and step_pipeline is distinct from deal_pipeline then
        raise exception 'step is not part of the deal''s pipeline' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger actions_deal_check before insert or update of client_id, deal_id, step_id on public.actions
  for each row execute function public.check_action_deal();

-- ─────────────────────────────────────────────────────────────
-- Sécurité et droits
-- ─────────────────────────────────────────────────────────────

alter table public.deals enable row level security;
create policy deals_member_all on public.deals for all to authenticated
  using (public.is_member(organization_id)) with check (public.is_member(organization_id));

revoke all on public.deals from public, anon, authenticated;
grant select, insert, update, delete on public.deals to authenticated;

revoke all on function public.reorder_pipeline_steps(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.check_deal_pipeline() from public, anon, authenticated;
revoke all on function public.check_client_group_change() from public, anon, authenticated;
revoke all on function public.check_action_deal() from public, anon, authenticated;
grant execute on function public.reorder_pipeline_steps(uuid, uuid[]) to authenticated;
