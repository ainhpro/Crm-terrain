-- Reproduit, pour les tests locaux sur un Postgres nu, ce que Supabase fournit d'office :
-- rôles anon / authenticated / service_role, schéma auth, auth.users et auth.uid().
-- Ne jamais appliquer ce fichier sur un vrai projet Supabase.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

-- Comme Supabase : droits larges par défaut sur le schéma public ; seule la RLS protège.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
