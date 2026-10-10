-- Socle V1 : organisations, membres, groupes, clients, contacts, pipelines, actions.
--
-- Règles :
-- * Toute table métier porte organization_id et est protégée par Row Level Security.
-- * Les liens entre tables passent par des clés composites (organization_id, id) :
--   impossible de rattacher une ligne à une ligne d'un autre compte.
-- * Le statut de pipeline n'est jamais stocké ; il est recalculé à partir des actions.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Organisations et membres
-- ─────────────────────────────────────────────────────────────

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  language text not null default 'fr' check (language in ('fr', 'nl', 'it')),
  plan text not null default 'trial',
  modules text[] not null default array['crm'],
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  language text not null default 'fr' check (language in ('fr', 'nl', 'it')),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- Vrai si l'utilisateur connecté appartient à l'organisation.
-- security definer : évite que la politique de organization_members ne s'appelle elle-même.
create function public.is_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

create function public.is_owner(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Création d'un compte : l'organisation et son premier membre (propriétaire) en une fois.
create function public.create_organization(org_name text, org_language text default 'fr')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.organizations (name, language)
  values (org_name, org_language)
  returning id into new_id;
  insert into public.organization_members (organization_id, user_id, role)
  values (new_id, auth.uid(), 'owner');
  return new_id;
end;
$$;

-- Profil créé automatiquement à l'inscription.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- Fichier clients
-- ─────────────────────────────────────────────────────────────

create table public.client_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  color text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  group_id uuid,
  name text not null check (length(trim(name)) > 0),
  address text,
  postal_code text,
  city text,
  country text default 'BE',
  lat double precision,
  lng double precision,
  category text check (category in ('A', 'B', 'C')),
  visit_frequency_days integer check (visit_frequency_days > 0),
  opening_hours jsonb,
  notes text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, group_id)
    references public.client_groups (organization_id, id) on delete set null (group_id)
);
create index clients_org_idx on public.clients (organization_id);
create index clients_group_idx on public.clients (group_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  job_title text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade
);
create index contacts_client_idx on public.contacts (client_id);

-- ─────────────────────────────────────────────────────────────
-- Pipelines configurables et actions
-- ─────────────────────────────────────────────────────────────

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null,
  name text not null,
  position integer not null default 0,
  -- Facultatif : pipeline propre à un groupe (ex. FACQ).
  group_id uuid,
  -- Codes d'étapes considérées faites par défaut (ex. tarif SAMO).
  implied_by_default text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, group_id)
    references public.client_groups (organization_id, id) on delete cascade
);

create table public.pipeline_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pipeline_id uuid not null,
  -- Identifiant stable de l'étape : la logique ne lit jamais le libellé.
  code text not null check (code ~ '^[a-z0-9_]+$'),
  label text not null,
  short_label text,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (pipeline_id, code),
  foreign key (organization_id, pipeline_id)
    references public.pipelines (organization_id, id) on delete cascade
);

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  step_id uuid,
  kind text not null default 'note',
  status text not null default 'todo' check (status in (
    'todo', 'appointment_to_set', 'appointment_set', 'in_progress',
    'waiting', 'follow_up', 'done', 'blocked'
  )),
  due_date date,
  note text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade,
  foreign key (organization_id, step_id)
    references public.pipeline_steps (organization_id, id) on delete set null (step_id)
);
create index actions_client_idx on public.actions (client_id);
create index actions_open_due_idx on public.actions (organization_id, due_date) where status <> 'done';

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger actions_touch before update on public.actions
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;

create policy organizations_select on public.organizations
  for select to authenticated using (public.is_member(id));
create policy organizations_update on public.organizations
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
-- Pas d'insert direct : passer par create_organization(). Pas de delete côté client.

create policy profiles_select on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or exists (
      select 1 from public.organization_members mine
      join public.organization_members theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy members_select on public.organization_members
  for select to authenticated using (public.is_member(organization_id));
create policy members_insert on public.organization_members
  for insert to authenticated with check (public.is_owner(organization_id));
create policy members_delete on public.organization_members
  for delete to authenticated using (public.is_owner(organization_id));

-- Tables métier : un membre a tous les droits sur les données de son organisation, et seulement celles-là.
do $$
declare
  t text;
begin
  foreach t in array array['client_groups', 'clients', 'contacts', 'pipelines', 'pipeline_steps', 'actions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_member(organization_id))
         with check (public.is_member(organization_id))',
      t || '_member_all', t
    );
  end loop;
end;
$$;

-- Droits de base (RLS filtre ensuite les lignes). Le rôle anon n'a accès à rien.
grant usage on schema public to authenticated;
grant select, update on public.organizations to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.organization_members to authenticated;
grant select, insert, update, delete on
  public.client_groups, public.clients, public.contacts,
  public.pipelines, public.pipeline_steps, public.actions
  to authenticated;
revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.is_member(uuid), public.is_owner(uuid) to authenticated;
