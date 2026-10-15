-- Formule des nouveaux comptes : réglage de l'installation, pas d'un compte.
--   « complete »   : CRM et interventions, chaque utilisateur choisit son profil d'écran ;
--   « technicien » : interventions seulement (offre vendue aux techniciens SAV).
-- Elle fixe les modules d'une organisation à sa création ; ensuite, plan et modules ne changent que par
-- le traitement d'abonnement (règle 11). Écrite par npm run supabase:setup (variable FORMULE), jamais
-- par un utilisateur : schéma privé, sans aucun droit pour anon ni authenticated.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.settings (
  key text primary key check (key in ('formule')),
  value text not null,
  check (key <> 'formule' or value in ('complete', 'technicien'))
);
revoke all on private.settings from public, anon, authenticated;

create function private.formule_modules(f text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case f when 'technicien' then array['interventions'] else array['crm', 'interventions'] end;
$$;

-- Formule en vigueur, « complete » si rien n'est réglé. Lisible par l'application (accueil, nom du produit).
create function public.deployment_formule()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from private.settings where key = 'formule'), 'complete');
$$;

-- Modules connus ; jamais vide. Les comptes existants gardent tout ce qu'ils avaient (CRM et interventions).
update public.organizations set modules = array['crm', 'interventions'] where modules = array['crm'];
alter table public.organizations
  alter column modules set default array['crm', 'interventions'],
  add constraint organizations_modules_known
    check (cardinality(modules) > 0 and modules <@ array['crm', 'interventions', 'prospection', 'offres', 'route']);

-- Création d'un compte : modules de la formule en vigueur, jamais choisis par l'utilisateur.
create or replace function public.create_organization(org_name text, org_language text default 'fr')
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
  insert into public.organizations (name, language, modules)
  values (org_name, org_language, private.formule_modules(public.deployment_formule()))
  returning id into new_id;
  insert into public.organization_members (organization_id, user_id, role)
  values (new_id, auth.uid(), 'owner');
  return new_id;
end;
$$;

revoke all on function private.formule_modules(text) from public, anon, authenticated;
revoke all on function public.deployment_formule() from public, anon, authenticated;
revoke all on function public.create_organization(text, text) from public, anon, authenticated;
grant execute on function public.deployment_formule() to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
