-- Données de démonstration (base locale uniquement). Les noms de particuliers sont fictifs.
-- Connexions : fabrice@demo.local (commercial et technicien, propriétaire) · tom@demo.local (technicien showroom).

begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'fabrice@demo.local', now()),
  ('22222222-2222-2222-2222-222222222222', 'tom@demo.local', now());
update public.profiles set full_name = 'Fabrice' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set full_name = 'Tom' where id = '22222222-2222-2222-2222-222222222222';

insert into public.organizations (id, name, profile, company_name, address, phone, email, vat_number, iban, payment_terms)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'INDA', 'both', '[Nom de la société]', '[Rue, n°, code postal, ville]',
        '[Téléphone]', 'contact@demo.local', 'BE0123456789', 'BE00 0000 0000 0000', 'Paiement à 30 jours');

insert into public.organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member');

-- ── Commercial : groupes, sites, pipelines INDA ─────────────────────────────

create temporary table seed_groups (code text, id uuid, color text, sites text[]);
insert into seed_groups values
  ('FACQ', gen_random_uuid(), '#0050A0', array['Merelbeke','Zaventem','Diest','Wilrijk','Geel','Brugge','Oostende','Hasselt','Roeselare','Kuurne']),
  ('STG', gen_random_uuid(), '#DC2626', array['Hasselt','Bissegem','Herentals','Brasschaat','Brugge','Gentbrugge','Izegem','Oudenaarde','Turnhout','Veurne','Wilrijk','Zandhoven','Zele','Ninove']),
  ('SAMO', gen_random_uuid(), '#1A1A1A', array['Dupont Courtrai','Dupont Roulers','Dupont Ypres','Dupont Ruiselede','Badkamer Vermeersch','Willems Diels','Demeyer NV']);

insert into public.client_groups (id, organization_id, name, color)
select id, 'aaaaaaaa-0000-0000-0000-000000000001', code, color from seed_groups;

insert into public.clients (organization_id, group_id, name, city, category)
select 'aaaaaaaa-0000-0000-0000-000000000001', g.id,
       case when g.code = 'SAMO' then s else g.code || ' ' || s end,
       case when g.code = 'SAMO' then null else s end,
       (array['A','B','A','C','B'])[1 + (row_number() over () % 5)]
from seed_groups g, unnest(g.sites) s;

create temporary table seed_pipelines (code text, grp text, name text, implied text[], steps text[][]);
insert into seed_pipelines values
  ('FACQ_MAJ', 'FACQ', 'MAJ showroom', '{}', array[['rdv','RDV mise à jour showroom','RDV'],['offre','Offre showroom envoyée','OFFRE'],['commande','Commande passée','CMD'],['placement','Placement / installation','PLACE']]),
  ('FACQ_TAR', 'FACQ', 'Tarifs & formations', '{}', array[['formation_meubles','Formation meubles','FORM.M'],['formation_parois','Formation parois','FORM.P']]),
  ('STG_PLACE', 'STG', 'Placement', '{}', array[['rdv','RDV responsable showroom','RDV'],['proposition','Proposition showroom','PROP'],['commande','Commande passée','CMD'],['placement','Placement / installation','PLACE']]),
  ('STG_FORM', 'STG', 'Formation', '{}', array[['formation','Formation meubles','FORM']]),
  ('SAMO', 'SAMO', 'Tarifs & formation', array['tarif'], array[['tarif','Tarif SAMO livré','TARIF'],['formation','Formation nouveautés produits','FORM']]);

insert into public.pipelines (organization_id, code, name, position, group_id, implied_by_default)
select 'aaaaaaaa-0000-0000-0000-000000000001', p.code, p.name, row_number() over (), g.id, p.implied
from seed_pipelines p join seed_groups g on g.code = p.grp;

insert into public.pipeline_steps (organization_id, pipeline_id, code, label, short_label, position)
select 'aaaaaaaa-0000-0000-0000-000000000001', pl.id, p.steps[i][1], p.steps[i][2], p.steps[i][3], i - 1
from seed_pipelines p
join public.pipelines pl on pl.code = p.code
cross join lateral generate_subscripts(p.steps, 1) i;

-- Une affaire par client et par pipeline de son groupe.
insert into public.deals (organization_id, client_id, pipeline_id, name, opened_on)
select c.organization_id, c.id, p.id, p.name || ' 2026', current_date - 40
from public.clients c join public.pipelines p on p.group_id = c.group_id;

-- Quelques actions réalistes.
create temporary table seed_actions (client text, pipeline text, step text, status text, due int, note text);
insert into seed_actions values
  ('FACQ Geel', 'FACQ_MAJ', 'rdv', 'done', -30, 'RDV avec le responsable showroom'),
  ('FACQ Geel', 'FACQ_MAJ', 'offre', 'done', -14, 'Offre remise, validation budget en cours'),
  ('FACQ Geel', 'FACQ_MAJ', 'commande', 'todo', 0, 'Confirmer la commande'),
  ('FACQ Hasselt', 'FACQ_MAJ', 'offre', 'follow_up', -7, 'Relancer l''offre'),
  ('FACQ Zaventem', 'FACQ_TAR', 'formation_meubles', 'done', -20, null),
  ('FACQ Zaventem', 'FACQ_TAR', 'formation_parois', 'todo', -8, 'Planifier la formation parois'),
  ('FACQ Kuurne', 'FACQ_MAJ', 'placement', 'done', -10, 'Placement terminé'),
  ('FACQ Kuurne', 'FACQ_TAR', 'formation_parois', 'done', -9, null),
  ('STG Herentals', 'STG_PLACE', 'rdv', 'appointment_set', 0, 'RDV responsable 11:00'),
  ('STG Izegem', 'STG_PLACE', 'proposition', 'follow_up', -4, 'Relancer la proposition'),
  ('STG Turnhout', 'STG_FORM', 'formation', 'todo', 0, 'Formation meubles 14:30'),
  ('Dupont Roulers', 'SAMO', 'formation', 'todo', 2, 'Formation nouveautés');

insert into public.actions (organization_id, client_id, deal_id, step_id, kind, status, due_date, note, created_by)
select 'aaaaaaaa-0000-0000-0000-000000000001', c.id, d.id, s.id, 'step', a.status, current_date + a.due, a.note,
       '11111111-1111-1111-1111-111111111111'
from seed_actions a
join public.clients c on c.name = a.client
join public.pipelines p on p.code = a.pipeline
join public.deals d on d.client_id = c.id and d.pipeline_id = p.id
join public.pipeline_steps s on s.pipeline_id = p.id and s.code = a.step;

-- Dernières visites (pour les relances).
update public.clients set created_at = now() - interval '120 days';

-- ── Technicien : types, donneurs d'ordre, dossiers ──────────────────────────

insert into public.intervention_types (id, organization_id, name, kind, position) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'SAV', 'sav', 0),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Prise de mesure', 'measure', 1),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Placement showroom', 'showroom', 2),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Intervention Culligan', 'custom', 3);

insert into public.member_settings (organization_id, user_id, profile, type_ids, options) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'both',
   array['bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000004']::uuid[],
   '{"parts": true, "pricing": true, "signature": true, "warranty": true}'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'technician',
   array['bbbbbbbb-0000-0000-0000-000000000003']::uuid[],
   '{"parts": false, "pricing": true, "signature": true, "warranty": false}');

insert into public.principals (id, organization_id, name, default_type_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'INDA', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Culligan', 'bbbbbbbb-0000-0000-0000-000000000004');

insert into public.principal_addresses (organization_id, principal_id, label, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Parois de douche', 'parois@inda.example'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Meubles', 'meubles@inda.example'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'Bureau', 'bureau@culligan.example');

insert into public.clients (id, organization_id, name, address, city, notes) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mme Exemple', 'Rue de la Station 12', 'Bruxelles', 'Particulier'),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'M. Exemple', 'Kerkstraat 5', 'Gent', 'Particulier');

insert into public.service_cases (id, organization_id, type_id, principal_id, client_id, site_address, payer, request_subject, problem, warranty, status, created_by) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'Rue de la Station 12, 1000 Bruxelles', 'principal',
   'Ticket 2026-0457 — SAV paroi de douche', 'Joint de la paroi de douche qui fuit', 'yes', 'planned', '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', 'Kerkstraat 5, 9000 Gent', 'principal',
   null, 'Prise de mesure salle de bain', 'unknown', 'planned', '11111111-1111-1111-1111-111111111111');

insert into public.case_references (organization_id, case_id, issuer_id, number) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2026-0457');

insert into public.service_visits (organization_id, case_id, scheduled_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', (current_date + time '10:00') at time zone 'Europe/Brussels'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002', (current_date + time '13:30') at time zone 'Europe/Brussels');

commit;
