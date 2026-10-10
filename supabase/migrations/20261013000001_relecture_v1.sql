-- Relecture externe de la V1 (10 octobre 2026) : corrections en base.
-- S01 : parcours et étapes modifiables par le propriétaire seulement (lecture pour les membres).
-- D01 : pas de déplacement ni de retrait d'étape tant qu'une affaire en cours suit le parcours.
-- D02 : PDF figés à la validation (un par destinataire type), stockés avec la version.
-- R02 : chaque envoi sait à quel public il s'adresse (donneur d'ordre ou client final).
-- Effet sur les données existantes : aucune ligne modifiée ; les versions déjà validées n'ont pas de
-- PDF figé (le PDF reste produit à la demande pour elles, comme avant).

-- ─────────────────────────────────────────────────────────────
-- S01 : droits sur les parcours
-- ─────────────────────────────────────────────────────────────

drop policy pipelines_member_all on public.pipelines;
drop policy pipeline_steps_member_all on public.pipeline_steps;

create policy pipelines_select on public.pipelines for select to authenticated
  using (public.is_member(organization_id));
create policy pipelines_owner_insert on public.pipelines for insert to authenticated
  with check (public.is_owner(organization_id));
create policy pipelines_owner_update on public.pipelines for update to authenticated
  using (public.is_owner(organization_id)) with check (public.is_owner(organization_id));
create policy pipelines_owner_delete on public.pipelines for delete to authenticated
  using (public.is_owner(organization_id));

create policy pipeline_steps_select on public.pipeline_steps for select to authenticated
  using (public.is_member(organization_id));
create policy pipeline_steps_owner_insert on public.pipeline_steps for insert to authenticated
  with check (public.is_owner(organization_id));
create policy pipeline_steps_owner_update on public.pipeline_steps for update to authenticated
  using (public.is_owner(organization_id)) with check (public.is_owner(organization_id));
create policy pipeline_steps_owner_delete on public.pipeline_steps for delete to authenticated
  using (public.is_owner(organization_id));

-- ─────────────────────────────────────────────────────────────
-- D01 : structure d'un parcours suivi par des affaires en cours
-- ─────────────────────────────────────────────────────────────
-- Déplacer une étape change ce qu'« une étape avancée valide les précédentes » déduit ; retirer la
-- dernière étape restante d'une affaire la ferait passer pour terminée. Tant qu'une affaire en cours
-- suit le parcours, on peut renommer et ajouter des étapes, pas les déplacer ni les retirer.

create function public.protect_pipeline_in_use()
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
  -- Rattachement à un parcours invisible (autre compte) : la clé étrangère composite refusera.
  if tg_op = 'UPDATE' and new.pipeline_id is distinct from old.pipeline_id
     and not exists (select 1 from public.pipelines p where p.id = new.pipeline_id) then
    return new;
  end if;
  -- Sous RLS : seules les affaires du compte sont visibles, ce qui suffit (même compte que l'étape).
  if exists (select 1 from public.deals d where d.pipeline_id = old.pipeline_id and d.status = 'open') then
    raise exception 'pipeline has open deals: steps cannot be moved or removed' using errcode = '55006';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger pipeline_steps_in_use before update or delete on public.pipeline_steps
  for each row execute function public.protect_pipeline_in_use();

revoke all on function public.protect_pipeline_in_use() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- D02 : PDF figés
-- ─────────────────────────────────────────────────────────────

alter table public.report_versions
  add column pdf_path text,          -- version donneur d'ordre / interne
  add column client_pdf_path text;   -- version client final (sans remarques internes ni tarif négocié)

-- Une version validée reste figée ; seule exception : enregistrer ses PDF une fois, juste après la
-- validation, sans rien changer d'autre.
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
    raise exception 'a validated report version is frozen; create a new version' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.freeze_validated_report() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- R02 : public de chaque envoi
-- ─────────────────────────────────────────────────────────────

alter table public.outbound_messages
  add column audience text not null default 'principal' check (audience in ('principal', 'client'));
