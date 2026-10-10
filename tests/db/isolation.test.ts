import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, asUser, connect, createOrg, createUser, type OrgRows, seedOrg, sqlState } from './helpers';

// Isolation des comptes (règle n°1 du CLAUDE.md) : données présentes dans A et dans B,
// lecture, écriture et liens croisés testés table par table.

const TABLES = ['client_groups', 'clients', 'contacts', 'pipelines', 'pipeline_steps', 'actions'] as const;
type Table = (typeof TABLES)[number];
const ROW_KEY: Record<Table, keyof OrgRows> = {
  client_groups: 'group',
  clients: 'client',
  contacts: 'contact',
  pipelines: 'pipeline',
  pipeline_steps: 'step',
  actions: 'action',
};

let db: pg.Client;
let alice: string; // propriétaire de A
let bob: string; // propriétaire de B
let erin: string; // membre de A et de B
let dave: string; // connecté, sans organisation
let orgA: string;
let orgB: string;
let A: OrgRows;
let B: OrgRows;

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@example.test');
  bob = await createUser(db, 'bob@example.test');
  erin = await createUser(db, 'erin@example.test');
  dave = await createUser(db, 'dave@example.test');
  orgA = await createOrg(db, alice, 'INDA');
  orgB = await createOrg(db, bob, 'Concurrent');
  A = await seedOrg(db, alice, orgA, 'A');
  B = await seedOrg(db, bob, orgB, 'B');
  await addMember(db, alice, orgA, erin, 'erin@example.test');
  await addMember(db, bob, orgB, erin, 'erin@example.test');
});

afterAll(async () => {
  await db.end();
});

const ids = (q: (s: string) => Promise<pg.QueryResult>, table: string) =>
  q(`select id from ${table} order by id`).then((r) => r.rows.map((x) => x.id).sort());

describe('lecture', () => {
  it.each(TABLES)('%s : chacun ne voit que les lignes de ses organisations', async (table) => {
    const key = ROW_KEY[table];
    expect(await asUser(db, alice, (q) => ids(q, table))).toEqual([A[key]]);
    expect(await asUser(db, bob, (q) => ids(q, table))).toEqual([B[key]]);
    expect(await asUser(db, erin, (q) => ids(q, table))).toEqual([A[key], B[key]].sort());
    expect(await asUser(db, dave, (q) => ids(q, table))).toEqual([]);
  });

  it.each([...TABLES, 'organizations', 'organization_members', 'profiles', 'invitations'])(
    '%s : un visiteur non connecté est refusé',
    async (table) => {
      expect(await sqlState(asUser(db, null, (q) => q(`select * from ${table}`)))).toBe('42501');
    },
  );
});

describe('écriture croisée', () => {
  it.each(TABLES)("%s : Bob ne modifie ni ne supprime rien de A", async (table) => {
    const id = A[ROW_KEY[table]];
    const updated = await asUser(db, bob, async (q) =>
      (await q(`update ${table} set organization_id = organization_id where id = $1`, [id])).rowCount,
    );
    const deleted = await asUser(db, bob, async (q) => (await q(`delete from ${table} where id = $1`, [id])).rowCount);
    expect([updated, deleted]).toEqual([0, 0]);
    // La ligne de A est intacte.
    expect(await asUser(db, alice, (q) => ids(q, table))).toContain(id);
  });

  it("Bob ne crée rien dans l'organisation A", async () => {
    expect(
      await sqlState(asUser(db, bob, (q) => q(`insert into client_groups (organization_id, name) values ($1, 'x')`, [orgA]))),
    ).toBe('42501');
  });

  it("Alice ne déplace pas un client vers B", async () => {
    expect(
      await sqlState(asUser(db, alice, (q) => q('update clients set organization_id = $1 where id = $2', [orgB, A.client]))),
    ).toBe('42501');
  });
});

describe('liens entre organisations (clés composites)', () => {
  // Chaque lien : Bob, dans B, tente de pointer vers une ligne de A, à la création puis à la modification.
  const LINKS: { name: string; insert: () => [string, unknown[]]; update: () => [string, unknown[]] }[] = [
    {
      name: 'client → groupe',
      insert: () => [`insert into clients (organization_id, group_id, name) values ($1, $2, 'x')`, [orgB, A.group]],
      update: () => [`update clients set group_id = $1 where id = $2`, [A.group, B.client]],
    },
    {
      name: 'contact → client',
      insert: () => [`insert into contacts (organization_id, client_id, name) values ($1, $2, 'x')`, [orgB, A.client]],
      update: () => [`update contacts set client_id = $1 where id = $2`, [A.client, B.contact]],
    },
    {
      name: 'pipeline → groupe',
      insert: () => [`insert into pipelines (organization_id, code, name, group_id) values ($1, 'X', 'x', $2)`, [orgB, A.group]],
      update: () => [`update pipelines set group_id = $1 where id = $2`, [A.group, B.pipeline]],
    },
    {
      name: 'étape → pipeline',
      insert: () => [
        `insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'x', 'x', 5)`,
        [orgB, A.pipeline],
      ],
      update: () => [`update pipeline_steps set pipeline_id = $1, code = 'autre' where id = $2`, [A.pipeline, B.step]],
    },
    {
      name: 'action → client',
      insert: () => [`insert into actions (organization_id, client_id) values ($1, $2)`, [orgB, A.client]],
      update: () => [`update actions set client_id = $1 where id = $2`, [A.client, B.action]],
    },
    {
      name: 'action → étape',
      insert: () => [`insert into actions (organization_id, client_id, step_id) values ($1, $2, $3)`, [orgB, B.client, A.step]],
      update: () => [`update actions set step_id = $1 where id = $2`, [A.step, B.action]],
    },
  ];

  it.each(LINKS)('$name : refusé à la création et à la modification', async (link) => {
    const [insSql, insParams] = link.insert();
    const [updSql, updParams] = link.update();
    expect(await sqlState(asUser(db, bob, (q) => q(insSql, insParams)))).toBe('23503');
    expect(await sqlState(asUser(db, bob, (q) => q(updSql, updParams)))).toBe('23503');
  });
});

describe('contraintes', () => {
  it("le code d'étape est un identifiant, pas un libellé", async () => {
    expect(
      await sqlState(
        asUser(db, alice, (q) =>
          q(`insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'Offre envoyée', 'Offre', 1)`, [
            orgA,
            A.pipeline,
          ]),
        ),
      ),
    ).toBe('23514');
  });

  it("refuse un statut d'action inconnu", async () => {
    expect(
      await sqlState(asUser(db, alice, (q) => q(`update actions set status = 'Terminé' where id = $1`, [A.action]))),
    ).toBe('23514');
  });
});
