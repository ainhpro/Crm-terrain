import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, connect, createUser } from './helpers';

// Isolation des comptes : un utilisateur ne voit, ne modifie et ne relie jamais
// les données d'une autre organisation. Règle n°1 du CLAUDE.md.

const BUSINESS_TABLES = ['client_groups', 'clients', 'contacts', 'pipelines', 'pipeline_steps', 'actions'];

let db: pg.Client;
let alice: string; // propriétaire de l'organisation A
let bob: string; // propriétaire de l'organisation B
let orgA: string;
let orgB: string;
const a: Record<string, string> = {}; // identifiants des lignes de A

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@example.test');
  bob = await createUser(db, 'bob@example.test');

  orgA = await asUser(db, alice, async (q) => {
    const { rows } = await q(`select public.create_organization('INDA', 'fr') as id`);
    return rows[0].id;
  }, { commit: true });
  orgB = await asUser(db, bob, async (q) => {
    const { rows } = await q(`select public.create_organization('Concurrent', 'nl') as id`);
    return rows[0].id;
  }, { commit: true });

  await asUser(db, alice, async (q) => {
    const one = async (sql: string, params: unknown[]) => (await q(sql, params)).rows[0].id as string;
    a.group = await one(`insert into client_groups (organization_id, name) values ($1, 'FACQ') returning id`, [orgA]);
    a.client = await one(
      `insert into clients (organization_id, group_id, name, category) values ($1, $2, 'FACQ Geel', 'A') returning id`,
      [orgA, a.group],
    );
    a.contact = await one(
      `insert into contacts (organization_id, client_id, name) values ($1, $2, 'Responsable') returning id`,
      [orgA, a.client],
    );
    a.pipeline = await one(
      `insert into pipelines (organization_id, code, name, group_id) values ($1, 'FACQ_MAJ', 'MAJ showroom', $2) returning id`,
      [orgA, a.group],
    );
    a.step = await one(
      `insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'rdv', 'RDV', 0) returning id`,
      [orgA, a.pipeline],
    );
    a.action = await one(
      `insert into actions (organization_id, client_id, step_id, status, due_date) values ($1, $2, $3, 'todo', '2026-10-20') returning id`,
      [orgA, a.client, a.step],
    );
  }, { commit: true });
});

afterAll(async () => {
  await db.end();
});

describe('lecture', () => {
  it.each(BUSINESS_TABLES)('Alice voit sa ligne dans %s', async (table) => {
    const count = await asUser(db, alice, async (q) => (await q(`select count(*)::int as n from ${table}`)).rows[0].n);
    expect(count).toBe(1);
  });

  it.each(BUSINESS_TABLES)("Bob ne voit rien de A dans %s", async (table) => {
    const count = await asUser(db, bob, async (q) => (await q(`select count(*)::int as n from ${table}`)).rows[0].n);
    expect(count).toBe(0);
  });

  it.each([...BUSINESS_TABLES, 'organizations', 'organization_members', 'profiles'])(
    'un visiteur non connecté ne voit rien dans %s',
    async (table) => {
      const count = await asUser(db, null, async (q) => (await q(`select count(*)::int as n from ${table}`)).rows[0].n);
      expect(count).toBe(0);
    },
  );

  it("chacun ne voit que sa propre organisation et ses membres", async () => {
    const orgs = await asUser(db, bob, async (q) => (await q('select id from organizations')).rows.map((r) => r.id));
    expect(orgs).toEqual([orgB]);
    const members = await asUser(db, bob, async (q) => (await q('select user_id from organization_members')).rows);
    expect(members).toEqual([{ user_id: bob }]);
  });

  it("Bob ne voit pas le profil d'Alice", async () => {
    const ids = await asUser(db, bob, async (q) => (await q('select id from profiles')).rows.map((r) => r.id));
    expect(ids).toEqual([bob]);
  });
});

describe('écriture', () => {
  it("Bob ne peut pas créer de client dans l'organisation A", async () => {
    await expect(
      asUser(db, bob, (q) => q(`insert into clients (organization_id, name) values ($1, 'Intrus')`, [orgA])),
    ).rejects.toThrow(/row-level security/);
  });

  it.each(BUSINESS_TABLES)("Bob ne peut ni modifier ni supprimer les lignes de A dans %s", async (table) => {
    const updated = await asUser(db, bob, async (q) =>
      (await q(`update ${table} set organization_id = organization_id where organization_id = $1`, [orgA])).rowCount,
    );
    const deleted = await asUser(db, bob, async (q) =>
      (await q(`delete from ${table} where organization_id = $1`, [orgA])).rowCount,
    );
    expect(updated).toBe(0);
    expect(deleted).toBe(0);
  });

  it("Alice ne peut pas déplacer un client vers l'organisation B", async () => {
    await expect(
      asUser(db, alice, (q) => q('update clients set organization_id = $1 where id = $2', [orgB, a.client])),
    ).rejects.toThrow();
  });

  it("Bob ne peut pas rattacher un contact de B à un client de A", async () => {
    await expect(
      asUser(db, bob, (q) =>
        q(`insert into contacts (organization_id, client_id, name) values ($1, $2, 'Pirate')`, [orgB, a.client]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("Bob ne peut pas utiliser une étape de pipeline de A dans ses actions", async () => {
    await expect(
      asUser(db, bob, async (q) => {
        const { rows } = await q(`insert into clients (organization_id, name) values ($1, 'Client B') returning id`, [orgB]);
        await q(`insert into actions (organization_id, client_id, step_id) values ($1, $2, $3)`, [orgB, rows[0].id, a.step]);
      }),
    ).rejects.toThrow(/foreign key/);
  });

  it("Bob ne peut pas s'ajouter comme membre de l'organisation A", async () => {
    await expect(
      asUser(db, bob, (q) =>
        q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [orgA, bob]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("Bob ne peut pas renommer l'organisation A", async () => {
    const n = await asUser(db, bob, async (q) =>
      (await q(`update organizations set name = 'Piraté' where id = $1`, [orgA])).rowCount,
    );
    expect(n).toBe(0);
  });

  it("personne ne crée d'organisation en direct, seulement via create_organization", async () => {
    await expect(
      asUser(db, alice, (q) => q(`insert into organizations (name) values ('Directe')`)),
    ).rejects.toThrow(/row-level security/);
  });

  it('un visiteur non connecté ne peut pas créer de compte', async () => {
    await expect(asUser(db, null, (q) => q(`select public.create_organization('Anonyme')`))).rejects.toThrow();
  });
});

describe('membres', () => {
  it("un membre ajouté par la propriétaire voit les données de l'organisation", async () => {
    const carol = await createUser(db, 'carol@example.test');
    await asUser(db, alice, (q) =>
      q(`insert into organization_members (organization_id, user_id) values ($1, $2)`, [orgA, carol]),
      { commit: true },
    );
    const count = await asUser(db, carol, async (q) => (await q('select count(*)::int as n from clients')).rows[0].n);
    expect(count).toBe(1);
    // Un simple membre ne peut pas ajouter d'autres membres.
    const dave = await createUser(db, 'dave@example.test');
    await expect(
      asUser(db, carol, (q) =>
        q(`insert into organization_members (organization_id, user_id) values ($1, $2)`, [orgA, dave]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('contraintes', () => {
  it("le code d'étape est un identifiant, pas un libellé", async () => {
    await expect(
      asUser(db, alice, (q) =>
        q(`insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'Offre envoyée', 'Offre', 1)`, [
          orgA,
          a.pipeline,
        ]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("refuse un statut d'action inconnu", async () => {
    await expect(
      asUser(db, alice, (q) => q(`update actions set status = 'Terminé' where id = $1`, [a.action])),
    ).rejects.toThrow(/check constraint/);
  });
});
