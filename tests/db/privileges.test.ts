import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, connect, createOrg, createUser, seedOrg, sqlState } from './helpers';

// Droits effectifs (S02, S03) et auteur des actions (S04).

let db: pg.Client;
let alice: string;
let bob: string;
let orgA: string;
let client: string;

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@p.test');
  bob = await createUser(db, 'bob@p.test');
  orgA = await createOrg(db, alice, 'A');
  client = (await seedOrg(db, alice, orgA, 'A')).client;
});

afterAll(async () => {
  await db.end();
});

const has = async (role: string, table: string, priv: string) =>
  (await db.query(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${table}`, priv])).rows[0].ok as boolean;

describe('droits effectifs (S02)', () => {
  let tables: string[] = [];
  beforeAll(async () => {
    tables = (await db.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.tablename);
  });

  it('aucun TRUNCATE, TRIGGER ni REFERENCES pour anon et authenticated', async () => {
    for (const table of tables)
      for (const role of ['anon', 'authenticated'])
        for (const priv of ['TRUNCATE', 'TRIGGER', 'REFERENCES'])
          expect(await has(role, table, priv), `${role} ${priv} ${table}`).toBe(false);
  });

  it('anon ne peut rien lire ni écrire', async () => {
    for (const table of tables)
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
        expect(await has('anon', table, priv), `anon ${priv} ${table}`).toBe(false);
  });

  it("TRUNCATE est refusé même à un membre", async () => {
    expect(await sqlState(asUser(db, alice, (q) => q('truncate actions')))).toBe('42501');
  });

  it("seules les fonctions prévues sont exécutables par authenticated, aucune par anon", async () => {
    const { rows } = await db.query(`
      select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`);
    const callable = rows.filter((r) => r.auth).map((r) => r.proname).sort();
    expect(callable).toEqual(['accept_invitation', 'create_organization', 'delete_organization', 'invite_member', 'is_member', 'is_owner', 'reorder_pipeline_steps']);
    expect(rows.filter((r) => r.anon).map((r) => r.proname)).toEqual([]);
  });
});

describe('abonnement (S03)', () => {
  it("la propriétaire renomme son organisation mais ne change ni plan ni modules", async () => {
    const n = await asUser(db, alice, async (q) => (await q(`update organizations set name = 'INDA SRL' where id = $1`, [orgA])).rowCount);
    expect(n).toBe(1);
    expect(await sqlState(asUser(db, alice, (q) => q(`update organizations set plan = 'premium' where id = $1`, [orgA])))).toBe('42501');
    expect(
      await sqlState(asUser(db, alice, (q) => q(`update organizations set modules = array['crm','interventions'] where id = $1`, [orgA]))),
    ).toBe('42501');
  });
});

describe("auteur d'une action (S04)", () => {
  it("l'auteur est toujours l'utilisateur connecté, et ne change plus ensuite", async () => {
    const id = await asUser(
      db,
      alice,
      async (q) =>
        (await q(`insert into actions (organization_id, client_id, created_by) values ($1, $2, $3) returning id`, [orgA, client, bob])).rows[0]
          .id,
      { commit: true },
    );
    const author = async () => (await db.query(`select created_by from public.actions where id = $1`, [id])).rows[0].created_by;
    expect(await author()).toBe(alice);
    await asUser(db, alice, (q) => q(`update actions set created_by = $1, note = 'x' where id = $2`, [bob, id]), { commit: true });
    expect(await author()).toBe(alice);
  });
});
