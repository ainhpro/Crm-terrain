-- Reprise de l'ancien CRM (sauvegarde « entries ») : chaque entrée reprise garde son identifiant
-- d'origine, unique par compte. Réimporter la même sauvegarde n'ajoute rien en double.
-- Effet sur les données existantes : aucun (colonne vide pour les actions déjà présentes).

alter table public.actions add column legacy_id bigint;
create unique index actions_legacy_unique on public.actions (organization_id, legacy_id) where legacy_id is not null;
