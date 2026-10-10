-- Socle V1 : organisations, membres, groupes, clients, contacts, pipelines, actions.
--
-- Règles :
-- * Toute table métier porte organization_id et est protégée par Row Level Security.
-- * Les liens entre tables passent par des clés composites (organization_id, id) :
--   impossible de rattacher une ligne à une ligne d'un autre compte.
-- * Le statut de pipeline n'est jamais stocké ; il est recalculé à partir des actions.
-- * Droits minimaux : tout est d'abord retiré à anon et authenticated, puis seuls les droits
--   nécessaires sont rendus (fin de fichier). anon n'a accès à rien.
-- * On n'entre dans une organisation que par create_organization() ou par une invitation
--   acceptée par la personne invitée (identité Auth vérifiée).

-- Comme sur Supabase, les extensions vivent dans le schéma « extensions ».
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

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

-- L'email du profil n'est qu'une copie de l'email Auth (non modifiable par l'utilisateur).
create function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function public.sync_profile_email();

-- Une organisation garde toujours au moins un propriétaire.
-- Seule exception : la suppression de l'organisation elle-même (cascade).
create function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'owner' or (tg_op = 'UPDATE' and new.role = 'owner') then
    return coalesce(new, old);
  end if;
  -- Verrou sur l'organisation : deux départs simultanés ne peuvent pas contourner la règle.
  perform 1 from public.organizations where id = old.organization_id for update;
  if not found then
    return coalesce(new, old); -- organisation en cours de suppression
  end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = old.organization_id and m.role = 'owner' and m.user_id <> old.user_id
  ) then
    raise exception 'last owner cannot leave the organization' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger organization_members_last_owner
  before delete or update of role on public.organization_members
  for each row execute function public.protect_last_owner();

-- ─────────────────────────────────────────────────────────────
-- Invitations
-- ─────────────────────────────────────────────────────────────

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email like '%@%'),
  role text not null default 'member' check (role in ('owner', 'member')),
  -- Seule l'empreinte du jeton est stockée ; le jeton part par email depuis le serveur.
  token_hash bytea not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (organization_id);

-- Réservé aux propriétaires. Renvoie le jeton en clair, une seule fois.
create function public.invite_member(org uuid, invitee_email text, invitee_role text default 'member')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_owner(org) then
    raise exception 'only an owner can invite' using errcode = '42501';
  end if;
  insert into public.invitations (organization_id, email, role, token_hash, invited_by)
  values (org, lower(trim(invitee_email)), invitee_role, extensions.digest(token, 'sha256'), auth.uid());
  return token;
end;
$$;

-- La personne connectée accepte : son email Auth confirmé doit être celui de l'invitation.
create function public.accept_invitation(invitation_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invitations;
  caller_email text;
begin
  select lower(u.email) into caller_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;

  select * into inv from public.invitations i
  where i.token_hash = extensions.digest(invitation_token, 'sha256')
    and i.accepted_at is null and i.expires_at > now()
  for update;

  if caller_email is null or inv.id is null or inv.email <> caller_email then
    -- Même message dans tous les cas : ne rien révéler sur l'invitation.
    raise exception 'invalid or expired invitation' using errcode = 'P0001';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (inv.organization_id, auth.uid(), inv.role)
  on conflict (organization_id, user_id) do nothing;
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.organization_id;
end;
$$;

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

-- L'auteur est l'utilisateur connecté, imposé à la création et figé ensuite.
-- Sans utilisateur (traitement serveur, reprise de données), la valeur fournie est gardée.
create function public.enforce_action_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger actions_author before insert or update on public.actions
  for each row execute function public.enforce_action_author();

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
-- Pas d'insertion directe : create_organization() ou accept_invitation().
-- Un propriétaire retire un membre ; chacun peut partir (sauf le dernier propriétaire, voir déclencheur).
create policy members_delete on public.organization_members
  for delete to authenticated using (public.is_owner(organization_id) or user_id = auth.uid());

alter table public.invitations enable row level security;
create policy invitations_select on public.invitations
  for select to authenticated using (public.is_owner(organization_id));

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

-- ─────────────────────────────────────────────────────────────
-- Droits : tout retirer, puis rendre le strict nécessaire (la RLS filtre ensuite les lignes).
-- Supabase accorde par défaut des droits larges à anon et authenticated : on ne s'y fie pas.
-- ─────────────────────────────────────────────────────────────

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select on public.organizations to authenticated;
grant update (name, language) on public.organizations to authenticated; -- plan et modules : traitement d'abonnement uniquement
grant select on public.profiles to authenticated;
grant update (full_name, language) on public.profiles to authenticated; -- email : copie d'Auth
grant select, delete on public.organization_members to authenticated;
grant select (id, organization_id, email, role, invited_by, expires_at, accepted_at, accepted_by, created_at)
  on public.invitations to authenticated; -- jamais token_hash
grant select, insert, update, delete on
  public.client_groups, public.clients, public.contacts,
  public.pipelines, public.pipeline_steps, public.actions
  to authenticated;

grant execute on function
  public.is_member(uuid), public.is_owner(uuid),
  public.create_organization(text, text),
  public.invite_member(uuid, text, text),
  public.accept_invitation(text)
  to authenticated;
