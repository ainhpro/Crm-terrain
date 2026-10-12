-- Traitement d'envoi des emails (relecture D03).
-- États : queued (en file) → sending (pris par un traitement, verrou daté) → sent | failed | uncertain.
-- « uncertain » : on ne sait pas si le fournisseur a accepté (coupure après l'appel, traitement
-- interrompu) ; jamais renvoyé automatiquement, l'utilisateur décide (renvoyer ou marquer envoyé).
-- Les utilisateurs mettent en file et lisent ; seul le traitement serveur nommé « envois » change l'état.
-- Effet sur les données existantes : aucun (les messages déjà en file restent « queued »).

alter table public.outbound_messages drop constraint outbound_messages_status_check;
alter table public.outbound_messages add constraint outbound_messages_status_check
  check (status in ('queued', 'sending', 'sent', 'failed', 'uncertain'));

alter table public.outbound_messages
  add column locked_until timestamptz,
  add column provider_message_id text,
  add column updated_at timestamptz not null default now(),
  add check (status <> 'sending' or locked_until is not null),
  add check (status <> 'sent' or sent_at is not null);

create index outbound_messages_queue on public.outbound_messages (created_at) where status in ('queued', 'sending');

-- Un utilisateur ne peut mettre en file qu'un message neuf : pas de faux « envoyé ».
drop policy outbound_messages_member_all on public.outbound_messages;
create policy outbound_messages_select on public.outbound_messages for select to authenticated
  using (public.is_member(organization_id));
create policy outbound_messages_insert on public.outbound_messages for insert to authenticated
  with check (
    public.is_member(organization_id) and status = 'queued' and attempts = 0
    and sent_at is null and locked_until is null and provider_message_id is null and last_error is null
  );
