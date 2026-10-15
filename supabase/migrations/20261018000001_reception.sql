-- Réception des emails par transfert (cahier § 6 ter). Chaque compte a une adresse de réception propre,
-- « <jeton>@<domaine de réception> », au jeton aléatoire : le compte destinataire est déterminé par cette
-- adresse seule, jamais par le ticket ou l'expéditeur. Le traitement nommé « réception d'emails » (serveur)
-- range l'email dans les demandes à traiter ; il ne déclenche jamais rien d'autre.

alter table public.organizations
  add column inbound_token text not null unique default substr(md5(gen_random_uuid()::text), 1, 20)
    check (inbound_token ~ '^[0-9a-f]{20}$');

alter table public.inbound_messages
  add column channel text not null default 'paste' check (channel in ('paste', 'forward')),
  add column message_id text,
  add column attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array');

create index inbound_messages_pending_idx on public.inbound_messages (organization_id, received_at desc) where status = 'pending';

-- Droits : les membres lisent l'adresse de leur compte (droit de lecture existant sur organizations),
-- sans pouvoir la changer ; les emails reçus restent soumis à la RLS des membres.
revoke update (inbound_token) on public.organizations from public, anon, authenticated;
revoke all on public.inbound_messages from public, anon, authenticated;
grant select, insert, update, delete on public.inbound_messages to authenticated;
