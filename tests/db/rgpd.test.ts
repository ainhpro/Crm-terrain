import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, asUser, connect, createOrg, createUser, type Query, sqlState } from './helpers';

// RGPD (règle 10) : suppression complète d'une entreprise ; suppression d'un compte utilisateur
// sans perdre les heures ni les rapports.

let db: pg.Client;
let alice: string; // propriétaire de A
let tom: string; // technicien membre de A
let bea: string; // propriétaire de B (témoin)
let orgA: string;
let orgB: string;
const A: Record<string, string> = {};

async function fill(owner: string, org: string, worker: string, r: Record<string, string>) {
  await asUser(
    db,
    owner,
    async (q) => {
      const one = async (sql: string, p: unknown[]) => (await q(sql, p)).rows[0].id as string;
      r.group = await one(`insert into client_groups (organization_id, name) values ($1, 'Groupe') returning id`, [org]);
      r.client = await one(`insert into clients (organization_id, group_id, name) values ($1, $2, 'Client') returning id`, [org, r.group]);
      await q(`insert into contacts (organization_id, client_id, name) values ($1, $2, 'Contact')`, [org, r.client]);
      r.pipeline = await one(`insert into pipelines (organization_id, code, name, group_id) values ($1, 'VENTE', 'Vente', $2) returning id`, [org, r.group]);
      r.step = await one(`insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'offre', 'Offre', 0) returning id`, [org, r.pipeline]);
      r.deal = await one(`insert into deals (organization_id, client_id, pipeline_id, name) values ($1, $2, $3, 'Affaire ouverte') returning id`, [org, r.client, r.pipeline]);
      await q(`insert into actions (organization_id, client_id, deal_id, step_id, status) values ($1, $2, $3, $4, 'todo')`, [org, r.client, r.deal, r.step]);
      r.type = await one(`insert into intervention_types (organization_id, name, kind) values ($1, 'SAV', 'sav') returning id`, [org]);
      r.principal = await one(`insert into principals (organization_id, name) values ($1, 'Donneur') returning id`, [org]);
      await q(`insert into principal_addresses (organization_id, principal_id, label, email) values ($1, $2, 'Bureau', 'b@d.test')`, [org, r.principal]);
      r.case = await one(`insert into service_cases (organization_id, type_id, principal_id, client_id, problem) values ($1, $2, $3, $4, 'Panne') returning id`, [org, r.type, r.principal, r.client]);
      await q(`insert into case_references (organization_id, case_id, issuer_id, number) values ($1, $2, $3, 'T-1')`, [org, r.case, r.principal]);
      r.visit = await one(`insert into service_visits (organization_id, case_id, scheduled_at) values ($1, $2, now()) returning id`, [org, r.case]);
      await q(`insert into visit_workers (organization_id, visit_id, user_id, arrived_at, left_at) values ($1, $2, $3, now() - interval '1 hour', now())`, [org, r.visit, worker]);
      r.media = await one(`insert into visit_media (organization_id, visit_id, kind, storage_path, content_type) values ($1, $2, 'notice', 'x/y.jpg', 'image/jpeg') returning id`, [org, r.visit]);
      r.need = await one(`insert into part_needs (organization_id, case_id, designation, media_id) values ($1, $2, 'Joint', $3) returning id`, [org, r.case, r.media]);
      await q(`insert into part_orders (organization_id, need_id, supplier_label, quantity) values ($1, $2, 'Usine', 1)`, [org, r.need]);
      await q(`insert into part_receipts (organization_id, need_id, quantity) values ($1, $2, 1)`, [org, r.need]);
      r.report = await one(
        `insert into report_versions (organization_id, visit_id, version, done_text, status, validated_at, no_signature_reason) values ($1, $2, 1, 'Fait', 'validated', now(), 'not_required') returning id`,
        [org, r.visit],
      );
      await q(`insert into outbound_messages (organization_id, case_id, report_version_id, kind, recipient_label, idempotency_key) values ($1, $2, $3, 'report_email', 'Bureau', $4)`, [org, r.case, r.report, `k-${org}`]);
      await q(`insert into inbound_messages (organization_id, subject, fingerprint, suggested_case_id) values ($1, 'Ticket T-1', $2, $3)`, [org, `f-${org}`, r.case]);
    },
    { commit: true },
  );
}

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@g.test');
  tom = await createUser(db, 'tom@g.test');
  bea = await createUser(db, 'bea@g.test');
  await db.query(`update profiles set full_name = 'Tom Technicien' where id = $1`, [tom]);
  orgA = await createOrg(db, alice, 'Entreprise A');
  orgB = await createOrg(db, bea, 'Entreprise B');
  await addMember(db, alice, orgA, tom, 'tom@g.test');
  await asUser(db, alice, (q) => q(`insert into member_settings (organization_id, user_id, profile) values ($1, $2, 'technician')`, [orgA, tom]), { commit: true });
  await fill(alice, orgA, tom, A);
  await fill(bea, orgB, bea, {});
});

afterAll(async () => {
  await db.end();
});

const count = (q: Query, table: string, org: string) => q(`select count(*)::int as n from ${table} where organization_id = $1`, [org]).then((r) => r.rows[0].n as number);

describe('protections inchangées hors suppression de l’entreprise', () => {
  it('une ligne référencée reste protégée (même erreur 23503)', async () => {
    expect(await sqlState(asUser(db, alice, (q) => q(`delete from intervention_types where id = $1`, [A.type])))).toBe('23503');
    expect(await sqlState(asUser(db, alice, (q) => q(`delete from clients where id = $1`, [A.client])))).toBe('23503');
  });
  it('un rapport validé ne se supprime pas ; un parcours suivi ne perd pas d’étape', async () => {
    expect(await sqlState(asUser(db, alice, (q) => q(`delete from report_versions where id = $1`, [A.report])))).toBe('55000');
    expect(await sqlState(asUser(db, alice, (q) => q(`update pipeline_steps set archived_at = now() where id = $1`, [A.step])))).toBe('55006');
  });
});

describe('suppression d’un compte utilisateur (technicien)', () => {
  it('le compte part, ses heures et son nom restent sur le passage', async () => {
    const before = (await db.query(`select worker_name from visit_workers where visit_id = $1`, [A.visit])).rows[0].worker_name;
    expect(before).toBe('Tom Technicien');
    await db.query(`delete from auth.users where id = $1`, [tom]); // traitement serveur « suppression de compte »
    const w = (await db.query(`select user_id, worker_name, left_at is not null as timed from visit_workers where visit_id = $1`, [A.visit])).rows[0];
    expect(w).toEqual({ user_id: null, worker_name: 'Tom Technicien', timed: true });
    const left = (await db.query(`select count(*)::int as n from organization_members where user_id = $1`, [tom])).rows[0].n;
    expect(left).toBe(0);
  });
  it('le dernier propriétaire d’une entreprise avec d’autres membres ne peut pas disparaître', async () => {
    const zoe = await createUser(db, 'zoe@g.test');
    const solo = await createOrg(db, zoe, 'Solo');
    const max = await createUser(db, 'max@g.test');
    await addMember(db, zoe, solo, max, 'max@g.test');
    expect(await sqlState(db.query(`delete from auth.users where id = $1`, [zoe]))).toBe('P0001');
  });
});

describe('suppression d’une entreprise (delete_organization)', () => {
  it('un membre ne peut pas supprimer l’entreprise', async () => {
    const mia = await createUser(db, 'mia@g.test');
    await addMember(db, alice, orgA, mia, 'mia@g.test');
    expect(await sqlState(asUser(db, mia, (q) => q(`select public.delete_organization($1)`, [orgA])))).toBe('42501');
    expect(await sqlState(asUser(db, bea, (q) => q(`select public.delete_organization($1)`, [orgA])))).toBe('42501');
  });

  it('le propriétaire supprime tout, rapports figés et affaires ouvertes compris ; l’autre entreprise est intacte', async () => {
    const tables = [
      'client_groups', 'clients', 'contacts', 'pipelines', 'pipeline_steps', 'deals', 'actions', 'intervention_types', 'principals',
      'principal_addresses', 'service_cases', 'case_references', 'service_visits', 'visit_workers', 'visit_media', 'part_needs',
      'part_orders', 'part_receipts', 'report_versions', 'outbound_messages', 'inbound_messages', 'member_settings', 'organization_members',
    ];
    const bBefore = await Promise.all(tables.map((t) => count(db.query.bind(db) as Query, t, orgB)));
    expect(await sqlState(asUser(db, alice, (q) => q(`select public.delete_organization($1)`, [orgA]), { commit: true }))).toBeUndefined();
    for (const t of tables) expect(await count(db.query.bind(db) as Query, t, orgA), t).toBe(0);
    expect((await db.query(`select count(*)::int as n from organizations where id = $1`, [orgA])).rows[0].n).toBe(0);
    expect(await Promise.all(tables.map((t) => count(db.query.bind(db) as Query, t, orgB)))).toEqual(bBefore);
    // Le compte d'Alice existe toujours : elle peut créer une autre entreprise ou supprimer son compte.
    expect((await db.query(`select count(*)::int as n from profiles where id = $1`, [alice])).rows[0].n).toBe(1);
  });
});
