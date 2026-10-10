-- Module interventions (technicien SAV) et réglages de compte, selon le § 6 ter du cahier des charges.
--
-- Dossier (service_cases) → passages (service_visits) → temps par intervenant (visit_workers),
-- photos (visit_media), rapports versionnés (report_versions, figés une fois validés).
-- Pièces : besoin (part_needs) → commandes (part_orders) → réceptions (part_receipts).
-- Envois : file persistante (outbound_messages) avec clé d'idempotence ; réceptions : inbound_messages.
-- Toutes les tables : organization_id, RLS « membre », clés composites, droits minimaux.

-- ─────────────────────────────────────────────────────────────
-- Identité de l'entreprise (imprimée sur rapports et emails)
-- ─────────────────────────────────────────────────────────────

alter table public.organizations
  add column profile text not null default 'commercial' check (profile in ('commercial', 'technician', 'both')),
  add column timezone text not null default 'Europe/Brussels',
  add column company_name text,
  add column address text,
  add column phone text,
  add column email text,
  add column vat_number text,
  add column iban text,
  add column payment_terms text,
  add column logo_path text;

-- ─────────────────────────────────────────────────────────────
-- Réglages par membre : profil, types d'intervention attribués, options
-- ─────────────────────────────────────────────────────────────

create table public.member_settings (
  organization_id uuid not null,
  user_id uuid not null,
  profile text not null default 'commercial' check (profile in ('commercial', 'technician', 'both')),
  type_ids uuid[] not null default '{}',
  options jsonb not null default '{"parts": true, "pricing": true, "signature": true, "warranty": true}',
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

-- ─────────────────────────────────────────────────────────────
-- Types d'intervention et donneurs d'ordre
-- ─────────────────────────────────────────────────────────────

create table public.intervention_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'custom' check (kind in ('sav', 'measure', 'showroom', 'custom')),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.principals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  default_type_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name),
  foreign key (organization_id, default_type_id) references public.intervention_types (organization_id, id) on delete set null (default_type_id)
);

create table public.principal_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  principal_id uuid not null,
  label text not null check (length(trim(label)) > 0),
  email text not null check (email like '%@%'),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, principal_id) references public.principals (organization_id, id) on delete cascade
);

-- ─────────────────────────────────────────────────────────────
-- Dossiers, tickets, passages
-- ─────────────────────────────────────────────────────────────

create table public.service_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type_id uuid not null,
  principal_id uuid,
  client_id uuid not null, -- client final
  site_address text,
  payer text not null default 'client' check (payer in ('principal', 'client', 'other')),
  onsite_contact text,
  equipment text,
  request_subject text,
  request_text text,
  problem text,
  warranty text not null default 'unknown' check (warranty in ('yes', 'no', 'unknown')),
  status text not null default 'new'
    check (status in ('new', 'planned', 'in_progress', 'waiting_parts', 'return_to_plan', 'closed', 'cancelled')),
  recipient_language text not null default 'fr' check (recipient_language in ('fr', 'nl', 'it')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, type_id) references public.intervention_types (organization_id, id) on delete restrict,
  foreign key (organization_id, principal_id) references public.principals (organization_id, id) on delete restrict,
  foreign key (organization_id, client_id) references public.clients (organization_id, id) on delete restrict
);
create index service_cases_org_status_idx on public.service_cases (organization_id, status);

-- Numéros de tickets : uniques par émetteur (donneur d'ordre), jamais globaux.
create table public.case_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  issuer_id uuid,
  number text not null check (length(trim(number)) > 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, case_id) references public.service_cases (organization_id, id) on delete cascade,
  foreign key (organization_id, issuer_id) references public.principals (organization_id, id) on delete restrict
);
create unique index case_references_unique_per_issuer
  on public.case_references (organization_id, coalesce(issuer_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(number)));
create index case_references_number_idx on public.case_references (organization_id, lower(trim(number)));

create table public.service_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  scheduled_at timestamptz,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'done', 'cancelled', 'client_absent', 'no_access', 'postponed')),
  outcome_reason text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, case_id) references public.service_cases (organization_id, id) on delete cascade
);
create index service_visits_case_idx on public.service_visits (case_id);
create index service_visits_scheduled_idx on public.service_visits (organization_id, scheduled_at);

-- Temps par intervenant et par passage (arrivée, départ, pauses).
create table public.visit_workers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  visit_id uuid not null,
  user_id uuid not null references auth.users (id) on delete restrict,
  arrived_at timestamptz,
  left_at timestamptz,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  unique (visit_id, user_id),
  check (left_at is null or arrived_at is not null and left_at >= arrived_at),
  foreign key (organization_id, visit_id) references public.service_visits (organization_id, id) on delete cascade
);

create table public.visit_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  visit_id uuid not null,
  kind text not null check (kind in ('before', 'part', 'after', 'notice', 'damaged', 'other')),
  storage_path text not null,
  content_type text not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, visit_id) references public.service_visits (organization_id, id) on delete cascade
);

-- ─────────────────────────────────────────────────────────────
-- Pièces : besoin → commande → réception
-- ─────────────────────────────────────────────────────────────

create table public.part_needs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  reference text,
  designation text not null check (length(trim(designation)) > 0),
  quantity integer not null default 1 check (quantity > 0),
  remark text,
  media_id uuid,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, case_id) references public.service_cases (organization_id, id) on delete cascade,
  foreign key (organization_id, media_id) references public.visit_media (organization_id, id) on delete set null (media_id)
);

create table public.part_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  need_id uuid not null,
  supplier_label text not null,
  quantity integer not null check (quantity > 0),
  external_ref text,
  ordered_at timestamptz not null default now(),
  foreign key (organization_id, need_id) references public.part_needs (organization_id, id) on delete cascade
);

create table public.part_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  need_id uuid not null,
  quantity integer not null check (quantity > 0),
  received_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual', 'email')),
  foreign key (organization_id, need_id) references public.part_needs (organization_id, id) on delete cascade
);

-- ─────────────────────────────────────────────────────────────
-- Rapports versionnés : une version validée est figée
-- ─────────────────────────────────────────────────────────────

create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  visit_id uuid not null,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'validated')),
  done_text text,
  todo_text text,
  remarks text,
  pricing_mode text not null default 'none' check (pricing_mode in ('none', 'hourly', 'flat')),
  hourly_rate_cents integer check (hourly_rate_cents >= 0),
  flat_cents integer check (flat_cents >= 0),
  vat_rate_bp integer not null default 2100 check (vat_rate_bp between 0 and 10000),
  rounding_minutes integer not null default 15 check (rounding_minutes in (1, 5, 10, 15, 30, 60)),
  presence_minutes integer,
  billable_minutes integer,
  amount_excl_cents integer,
  amount_incl_cents integer,
  signature_path text,
  no_signature_reason text,
  language text not null default 'fr' check (language in ('fr', 'nl', 'it')),
  validated_at timestamptz,
  validated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (visit_id, version),
  check (status = 'draft' or validated_at is not null),
  check (status = 'draft' or signature_path is not null or length(trim(coalesce(no_signature_reason, ''))) > 0),
  foreign key (organization_id, visit_id) references public.service_visits (organization_id, id) on delete cascade
);

create function public.freeze_validated_report()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'validated' then
    raise exception 'a validated report version is frozen; create a new version' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger report_versions_frozen before update or delete on public.report_versions
  for each row execute function public.freeze_validated_report();

-- ─────────────────────────────────────────────────────────────
-- Envois et réceptions
-- ─────────────────────────────────────────────────────────────

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid,
  report_version_id uuid,
  kind text not null check (kind in ('report_email', 'part_order', 'billing', 'cloud_copy')),
  recipient_label text not null,
  recipient_email text,
  subject text,
  body text,
  -- Une même opération (même version, même destinataire) n'est jamais mise deux fois en file.
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (organization_id, idempotency_key),
  foreign key (organization_id, case_id) references public.service_cases (organization_id, id) on delete cascade,
  foreign key (organization_id, report_version_id) references public.report_versions (organization_id, id) on delete restrict
);

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  from_address text,
  subject text,
  body_text text,
  fingerprint text not null,
  received_at timestamptz not null default now(),
  suggested_case_id uuid,
  status text not null default 'pending' check (status in ('pending', 'attached', 'ignored')),
  attached_case_id uuid,
  unique (organization_id, fingerprint),
  foreign key (organization_id, suggested_case_id) references public.service_cases (organization_id, id) on delete set null (suggested_case_id),
  foreign key (organization_id, attached_case_id) references public.service_cases (organization_id, id) on delete set null (attached_case_id)
);

-- ─────────────────────────────────────────────────────────────
-- RLS et droits
-- ─────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'intervention_types', 'principals', 'principal_addresses', 'service_cases', 'case_references',
    'service_visits', 'visit_workers', 'visit_media', 'part_needs', 'part_orders', 'part_receipts',
    'report_versions', 'outbound_messages', 'inbound_messages'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_member(organization_id))
         with check (public.is_member(organization_id))',
      t || '_member_all', t
    );
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end;
$$;

grant select, insert, update, delete on
  public.intervention_types, public.principals, public.principal_addresses, public.service_cases,
  public.case_references, public.service_visits, public.visit_workers, public.visit_media,
  public.part_needs, public.part_orders, public.part_receipts, public.report_versions,
  public.inbound_messages
  to authenticated;
-- La file d'envoi : on peut mettre en file et lire ; l'état n'est changé que par le traitement d'envoi (serveur).
grant select, insert on public.outbound_messages to authenticated;

-- Réglages par membre : chacun voit et modifie les siens ; un propriétaire, ceux de son équipe.
alter table public.member_settings enable row level security;
create policy member_settings_select on public.member_settings for select to authenticated
  using (user_id = auth.uid() or public.is_owner(organization_id));
create policy member_settings_write on public.member_settings for all to authenticated
  using (public.is_member(organization_id) and (user_id = auth.uid() or public.is_owner(organization_id)))
  with check (public.is_member(organization_id) and (user_id = auth.uid() or public.is_owner(organization_id)));
revoke all on public.member_settings from public, anon, authenticated;
grant select, insert, update on public.member_settings to authenticated;

-- Identité de l'entreprise : modifiable par le propriétaire (politique organizations_update), colonnes listées.
grant update (profile, company_name, address, phone, email, vat_number, iban, payment_terms, logo_path)
  on public.organizations to authenticated;

revoke all on function public.freeze_validated_report() from public, anon, authenticated;
