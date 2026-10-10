import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, asUser, connect, createOrg, createUser, type Query, sqlState } from './helpers';

// Module interventions : isolation des nouvelles tables, tickets par émetteur,
// rapports figés, file d'envoi, réglages par membre.

let db: pg.Client;
let alice: string;
let bob: string;
let tom: string; // technicien membre de A
let orgA: string;
let orgB: string;
type Rows = Record<string, string>;
let A: Rows;
let B: Rows;

async function seed(owner: string, org: string): Promise<Rows> {
  return asUser(
    db,
    owner,
    async (q) => {
      const one = async (sql: string, p: unknown[]) => (await q(sql, p)).rows[0].id as string;
      const r: Rows = {};
      r.client = await one(`insert into clients (organization_id, name) values ($1, 'Mme Exemple') returning id`, [org]);
      r.type = await one(`insert into intervention_types (organization_id, name, kind) values ($1, 'SAV', 'sav') returning id`, [org]);
      r.principal = await one(`insert into principals (organization_id, name) values ($1, 'INDA') returning id`, [org]);
      r.address = await one(
        `insert into principal_addresses (organization_id, principal_id, label, email) values ($1, $2, 'Parois', 'parois@inda.test') returning id`,
        [org, r.principal],
      );
      r.case = await one(
        `insert into service_cases (organization_id, type_id, principal_id, client_id, problem) values ($1, $2, $3, $4, 'Joint') returning id`,
        [org, r.type, r.principal, r.client],
      );
      r.ref = await one(`insert into case_references (organization_id, case_id, issuer_id, number) values ($1, $2, $3, '2026-0457') returning id`, [
        org,
        r.case,
        r.principal,
      ]);
      r.visit = await one(`insert into service_visits (organization_id, case_id, scheduled_at) values ($1, $2, now()) returning id`, [org, r.case]);
      r.worker = await one(
        `insert into visit_workers (organization_id, visit_id, user_id, arrived_at, left_at) values ($1, $2, $3, now() - interval '77 minutes', now()) returning id`,
        [org, r.visit, owner],
      );
      r.media = await one(
        `insert into visit_media (organization_id, visit_id, kind, storage_path, content_type) values ($1, $2, 'notice', 'x/y.jpg', 'image/jpeg') returning id`,
        [org, r.visit],
      );
      r.need = await one(
        `insert into part_needs (organization_id, case_id, reference, designation, media_id) values ($1, $2, '4512-08', 'Joint d''angle', $3) returning id`,
        [org, r.case, r.media],
      );
      r.order = await one(`insert into part_orders (organization_id, need_id, supplier_label, quantity) values ($1, $2, 'Usine', 1) returning id`, [
        org,
        r.need,
      ]);
      r.receipt = await one(`insert into part_receipts (organization_id, need_id, quantity) values ($1, $2, 1) returning id`, [org, r.need]);
      r.report = await one(`insert into report_versions (organization_id, visit_id, version, done_text) values ($1, $2, 1, 'Fait') returning id`, [
        org,
        r.visit,
      ]);
      r.outbound = await one(
        `insert into outbound_messages (organization_id, case_id, kind, recipient_label, recipient_email, idempotency_key) values ($1, $2, 'report_email', 'INDA parois', 'parois@inda.test', $3) returning id`,
        [org, r.case, `k-${org}`],
      );
      r.inbound = await one(`insert into inbound_messages (organization_id, subject, fingerprint) values ($1, 'Ticket 2026-0457', $2) returning id`, [
        org,
        `f-${org}`,
      ]);
      return r;
    },
    { commit: true },
  );
}

const TABLES: [string, string][] = [
  ['intervention_types', 'type'],
  ['principals', 'principal'],
  ['principal_addresses', 'address'],
  ['service_cases', 'case'],
  ['case_references', 'ref'],
  ['service_visits', 'visit'],
  ['visit_workers', 'worker'],
  ['visit_media', 'media'],
  ['part_needs', 'need'],
  ['part_orders', 'order'],
  ['part_receipts', 'receipt'],
  ['report_versions', 'report'],
  ['outbound_messages', 'outbound'],
  ['inbound_messages', 'inbound'],
];

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@i.test');
  bob = await createUser(db, 'bob@i.test');
  tom = await createUser(db, 'tom@i.test');
  orgA = await createOrg(db, alice, 'A');
  orgB = await createOrg(db, bob, 'B');
  await addMember(db, alice, orgA, tom, 'tom@i.test');
  A = await seed(alice, orgA);
  B = await seed(bob, orgB);
});

afterAll(async () => {
  await db.end();
});

const as = <T>(user: string, fn: (q: Query) => Promise<T>) => asUser(db, user, fn);

describe('isolation des tables du module', () => {
  it.each(TABLES)('%s : Bob ne voit, ne modifie ni ne supprime rien de A', async (table, key) => {
    const seen = await as(bob, async (q) => (await q(`select id from ${table}`)).rows.map((r) => r.id));
    expect(seen).toEqual([B[key]]);
    const upd = await as(bob, async (q) => (await q(`update ${table} set organization_id = organization_id where id = $1`, [A[key]])).rowCount).catch(
      (e) => e.code,
    );
    const del = await as(bob, async (q) => (await q(`delete from ${table} where id = $1`, [A[key]])).rowCount).catch((e) => e.code);
    // 0 ligne touchée, ou refus de droit (file d'envoi non modifiable)
    expect([0, '42501']).toContain(upd);
    expect([0, '42501']).toContain(del);
  });

  it("Bob ne rattache pas un dossier de B à un client ou un type de A", async () => {
    expect(
      await sqlState(
        as(bob, (q) => q(`insert into service_cases (organization_id, type_id, client_id) values ($1, $2, $3)`, [orgB, B.type, A.client])),
      ),
    ).toBe('23503');
    expect(
      await sqlState(as(bob, (q) => q(`insert into case_references (organization_id, case_id, number) values ($1, $2, 'x')`, [orgB, A.case]))),
    ).toBe('23503');
  });
});

describe('tickets (M03)', () => {
  it("le même numéro chez deux émetteurs : accepté ; deux fois chez le même émetteur : refusé", async () => {
    expect(
      await sqlState(
        as(alice, async (q) => {
          const other = (await q(`insert into principals (organization_id, name) values ($1, 'Culligan') returning id`, [orgA])).rows[0].id;
          await q(`insert into case_references (organization_id, case_id, issuer_id, number) values ($1, $2, $3, '2026-0457')`, [orgA, A.case, other]);
        }),
      ),
    ).toBeUndefined();
    expect(
      await sqlState(
        as(alice, (q) =>
          q(`insert into case_references (organization_id, case_id, issuer_id, number) values ($1, $2, $3, ' 2026-0457 ')`, [orgA, A.case, A.principal]),
        ),
      ),
    ).toBe('23505');
  });
});

describe('rapports figés (M08)', () => {
  it('un brouillon se modifie ; une version validée ne se modifie ni ne se supprime', async () => {
    await asUser(db, alice, (q) => q(`update report_versions set done_text = 'Fait (corrigé)' where id = $1`, [A.report]), { commit: true });
    expect(
      await sqlState(as(alice, (q) => q(`update report_versions set status = 'validated', validated_at = now() where id = $1`, [A.report]))),
    ).toBe('23514'); // ni signature ni motif
    await asUser(
      db,
      alice,
      (q) => q(`update report_versions set status = 'validated', validated_at = now(), no_signature_reason = 'Client absent' where id = $1`, [A.report]),
      { commit: true },
    );
    expect(await sqlState(as(alice, (q) => q(`update report_versions set done_text = 'x' where id = $1`, [A.report])))).toBe('55000');
    expect(await sqlState(as(alice, (q) => q(`delete from report_versions where id = $1`, [A.report])))).toBe('55000');
  });
});

describe("file d'envoi (E06)", () => {
  it("une même opération n'est mise en file qu'une fois ; l'état n'est pas modifiable par l'utilisateur", async () => {
    expect(
      await sqlState(
        as(alice, (q) =>
          q(`insert into outbound_messages (organization_id, kind, recipient_label, idempotency_key) values ($1, 'report_email', 'x', $2)`, [
            orgA,
            `k-${orgA}`,
          ]),
        ),
      ),
    ).toBe('23505');
    expect(await sqlState(as(alice, (q) => q(`update outbound_messages set status = 'sent' where id = $1`, [A.outbound])))).toBe('42501');
  });
});

describe('réglages par membre', () => {
  it('chacun règle les siens ; la propriétaire règle ceux de son équipe ; un membre ne voit pas ceux des autres', async () => {
    await asUser(db, tom, (q) => q(`insert into member_settings (organization_id, user_id, profile) values ($1, $2, 'technician')`, [orgA, tom]), {
      commit: true,
    });
    const n = await as(alice, async (q) =>
      (await q(`update member_settings set options = '{"parts": false}' where user_id = $1`, [tom])).rowCount,
    );
    expect(n).toBe(1);
    await asUser(db, alice, (q) => q(`insert into member_settings (organization_id, user_id) values ($1, $2)`, [orgA, alice]), { commit: true });
    expect(await as(tom, async (q) => (await q(`select user_id from member_settings`)).rows.map((r) => r.user_id))).toEqual([tom]);
    // Tom ne voit pas la ligne d'Alice : sa modification ne touche rien.
    expect(await as(tom, async (q) => (await q(`update member_settings set profile = 'both' where user_id = $1`, [alice])).rowCount)).toBe(0);
    expect(await sqlState(as(bob, (q) => q(`insert into member_settings (organization_id, user_id) values ($1, $2)`, [orgA, bob])))).toBe('42501');
  });

  it("l'identité de l'entreprise est modifiable par la propriétaire, pas par un membre", async () => {
    expect(await as(alice, async (q) => (await q(`update organizations set vat_number = 'BE0123456789' where id = $1`, [orgA])).rowCount)).toBe(1);
    expect(await as(tom, async (q) => (await q(`update organizations set vat_number = 'BE0' where id = $1`, [orgA])).rowCount)).toBe(0);
  });
});
