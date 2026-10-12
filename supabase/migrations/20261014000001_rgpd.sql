-- RGPD (règle 10) : suppression complète d'une entreprise, et suppression d'un compte utilisateur
-- sans perdre les rapports déjà produits.
--
-- 1. Les liens internes à un compte passent de RESTRICT à NO ACTION. Pour une suppression isolée,
--    rien ne change : la ligne référencée reste protégée (même erreur 23503, vérifiée en fin
--    d'instruction au lieu d'immédiatement). Mais la suppression d'une entreprise, qui efface tout
--    en cascade dans la même instruction, n'est plus bloquée par l'ordre des cascades.
-- 2. Rapports figés et parcours suivis par des affaires : protégés comme avant, sauf quand
--    l'entreprise elle-même est en cours de suppression (sa ligne a déjà disparu).
-- 3. Heures des intervenants : le nom est copié à l'enregistrement ; supprimer le compte d'un
--    technicien met son identifiant à vide sans effacer ses heures (les rapports restent justes).
-- 4. delete_organization : seul un propriétaire supprime son entreprise.
-- Effet sur les données existantes : les noms des intervenants déjà enregistrés sont recopiés ;
-- rien d'autre ne change.

-- ─────────────────────────────────────────────────────────────
-- 1. RESTRICT → NO ACTION pour les liens entre tables d'un même compte
-- ─────────────────────────────────────────────────────────────

do $$
declare
  c record;
begin
  for c in
    select con.conname, cls.relname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where con.contype = 'f' and con.confdeltype = 'r' and n.nspname = 'public' and rn.nspname = 'public'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
    execute format('alter table public.%I add constraint %I %s', c.relname, c.conname, replace(c.def, ' ON DELETE RESTRICT', ''));
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. Protections levées seulement pendant la suppression de l'entreprise
-- ─────────────────────────────────────────────────────────────

create or replace function public.freeze_validated_report()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'validated' then
    if tg_op = 'UPDATE'
       and old.pdf_path is null and old.client_pdf_path is null
       and (to_jsonb(new) - 'pdf_path' - 'client_pdf_path') = (to_jsonb(old) - 'pdf_path' - 'client_pdf_path') then
      return new;
    end if;
    -- Entreprise supprimée (règle 10) : tout part avec elle, rapports figés compris.
    if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = old.organization_id) then
      return old;
    end if;
    raise exception 'a validated report version is frozen; create a new version' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.protect_pipeline_in_use()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.position is not distinct from old.position
     and new.archived_at is not distinct from old.archived_at
     and new.pipeline_id is not distinct from old.pipeline_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.pipeline_id is distinct from old.pipeline_id
     and not exists (select 1 from public.pipelines p where p.id = new.pipeline_id) then
    return new;
  end if;
  -- Entreprise supprimée : ses parcours partent avec elle.
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    return old;
  end if;
  if exists (select 1 from public.deals d where d.pipeline_id = old.pipeline_id and d.status = 'open') then
    raise exception 'pipeline has open deals: steps cannot be moved or removed' using errcode = '55006';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.freeze_validated_report() from public, anon, authenticated;
revoke all on function public.protect_pipeline_in_use() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Heures des intervenants : nom figé, compte supprimable
-- ─────────────────────────────────────────────────────────────

alter table public.visit_workers add column worker_name text;
update public.visit_workers w set worker_name = coalesce(nullif(p.full_name, ''), p.email)
from public.profiles p where p.id = w.user_id;

alter table public.visit_workers drop constraint visit_workers_user_id_fkey;
alter table public.visit_workers alter column user_id drop not null;
alter table public.visit_workers
  add constraint visit_workers_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

create function public.set_worker_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.worker_name is null and new.user_id is not null then
    select coalesce(nullif(p.full_name, ''), p.email) into new.worker_name from public.profiles p where p.id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger visit_workers_name before insert on public.visit_workers
  for each row execute function public.set_worker_name();

revoke all on function public.set_worker_name() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Suppression d'une entreprise par son propriétaire
-- ─────────────────────────────────────────────────────────────

create function public.delete_organization(org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner(org) then
    raise exception 'only an owner can delete the organization' using errcode = '42501';
  end if;
  delete from public.organizations where id = org;
end;
$$;

revoke all on function public.delete_organization(uuid) from public, anon, authenticated;
grant execute on function public.delete_organization(uuid) to authenticated;
