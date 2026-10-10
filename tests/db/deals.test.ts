import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, connect, createOrg, createUser, type Query, sqlState } from './helpers';

// Affaires et cohérence des pipelines (relecture P02 à P05).

let db: pg.Client;
let alice: string;
let org: string;
const id: Record<string, string> = {};

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@d.test');
  org = await createOrg(db, alice, 'INDA');
  await asUser(
    db,
    alice,
    async (q) => {
      const one = async (sql: string, params: unknown[]) => (await q(sql, params)).rows[0].id as string;
      id.facq = await one(`insert into client_groups (organization_id, name) values ($1, 'FACQ') returning id`, [org]);
      id.stg = await one(`insert into client_groups (organization_id, name) values ($1, 'STG') returning id`, [org]);
      id.geel = await one(`insert into clients (organization_id, group_id, name) values ($1, $2, 'Geel') returning id`, [org, id.facq]);
      id.zele = await one(`insert into clients (organization_id, group_id, name) values ($1, $2, 'Zele') returning id`, [org, id.stg]);
      id.facqMaj = await one(`insert into pipelines (organization_id, code, name, group_id) values ($1, 'FACQ_MAJ', 'MAJ', $2) returning id`, [org, id.facq]);
      id.common = await one(`insert into pipelines (organization_id, code, name) values ($1, 'COMMUN', 'Commun') returning id`, [org]);
      for (const [k, code, pos] of [['rdv', 'rdv', 0], ['offre', 'offre', 1], ['cmd', 'commande', 2]] as const)
        id[k] = await one(
          `insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, $3, $3, $4) returning id`,
          [org, id.facqMaj, code, pos],
        );
      id.commonStep = await one(
        `insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'suivi', 'Suivi', 0) returning id`,
        [org, id.common],
      );
      id.deal2025 = await one(`insert into deals (organization_id, client_id, pipeline_id, name) values ($1, $2, $3, 'MAJ 2025') returning id`, [org, id.geel, id.facqMaj]);
      id.deal2026 = await one(`insert into deals (organization_id, client_id, pipeline_id, name) values ($1, $2, $3, 'MAJ 2026') returning id`, [org, id.geel, id.facqMaj]);
    },
    { commit: true },
  );
});

afterAll(async () => {
  await db.end();
});

const as = <T>(fn: (q: Query) => Promise<T>) => asUser(db, alice, fn);

describe('affaires (P02)', () => {
  it('un client peut avoir plusieurs affaires sur le même pipeline', async () => {
    const n = await as(async (q) => (await q(`select count(*)::int as n from deals where client_id = $1`, [id.geel])).rows[0].n);
    expect(n).toBe(2);
  });

  it('une affaire close a une date de clôture, une ouverte n’en a pas', async () => {
    expect(await sqlState(as((q) => q(`update deals set status = 'won' where id = $1`, [id.deal2025])))).toBe('23514');
    expect(await sqlState(as((q) => q(`update deals set status = 'won', closed_on = '2025-12-01' where id = $1`, [id.deal2025])))).toBeUndefined();
  });
});

describe('pipeline applicable au client (P04)', () => {
  it("refuse une affaire STG sur le pipeline FACQ ; accepte un pipeline commun", async () => {
    expect(
      await sqlState(as((q) => q(`insert into deals (organization_id, client_id, pipeline_id, name) values ($1, $2, $3, 'x')`, [org, id.zele, id.facqMaj]))),
    ).toBe('23514');
    expect(
      await sqlState(as((q) => q(`insert into deals (organization_id, client_id, pipeline_id, name) values ($1, $2, $3, 'x')`, [org, id.zele, id.common]))),
    ).toBeUndefined();
  });

  it("refuse de changer le groupe d'un client qui a une affaire ouverte sur le pipeline de son groupe", async () => {
    expect(await sqlState(as((q) => q(`update clients set group_id = $1 where id = $2`, [id.stg, id.geel])))).toBe('23514');
  });

  it("une action sur une étape doit passer par une affaire du même client et du même pipeline", async () => {
    // Sans affaire
    expect(
      await sqlState(as((q) => q(`insert into actions (organization_id, client_id, step_id) values ($1, $2, $3)`, [org, id.geel, id.rdv]))),
    ).toBe('23514');
    // Affaire d'un autre client
    expect(
      await sqlState(
        as((q) => q(`insert into actions (organization_id, client_id, deal_id, step_id) values ($1, $2, $3, $4)`, [org, id.zele, id.deal2026, id.rdv])),
      ),
    ).toBe('23514');
    // Étape d'un autre pipeline
    expect(
      await sqlState(
        as((q) => q(`insert into actions (organization_id, client_id, deal_id, step_id) values ($1, $2, $3, $4)`, [org, id.geel, id.deal2026, id.commonStep])),
      ),
    ).toBe('23514');
    // Correct
    expect(
      await sqlState(
        as((q) => q(`insert into actions (organization_id, client_id, deal_id, step_id) values ($1, $2, $3, $4)`, [org, id.geel, id.deal2026, id.rdv])),
      ),
    ).toBeUndefined();
    // Note libre sans étape ni affaire : toujours possible
    expect(await sqlState(as((q) => q(`insert into actions (organization_id, client_id, note) values ($1, $2, 'appel')`, [org, id.geel])))).toBeUndefined();
  });
});

describe("ordre des étapes (P03)", () => {
  it('deux étapes ne peuvent pas partager une position', async () => {
    expect(
      await sqlState(
        as((q) => q(`insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'bis', 'bis', 1)`, [org, id.facqMaj])),
      ),
    ).toBe('23505');
  });

  it('réordonne toutes les étapes en une fois', async () => {
    const order = await as(async (q) => {
      // Affaires closes d'abord : un parcours suivi par une affaire en cours ne se réordonne pas (relecture D01).
      await q(`update deals set status = 'won', closed_on = '2026-10-10' where pipeline_id = $1`, [id.facqMaj]);
      await q(`select public.reorder_pipeline_steps($1, $2::uuid[])`, [id.facqMaj, [id.cmd, id.rdv, id.offre]]);
      return (await q(`select code from pipeline_steps where pipeline_id = $1 order by position`, [id.facqMaj])).rows.map((r) => r.code);
    });
    expect(order).toEqual(['commande', 'rdv', 'offre']);
  });

  it('refuse une liste incomplète ou avec doublon', async () => {
    expect(await sqlState(as((q) => q(`select public.reorder_pipeline_steps($1, $2::uuid[])`, [id.facqMaj, [id.cmd, id.rdv]])))).toBe('22023');
    expect(
      await sqlState(as((q) => q(`select public.reorder_pipeline_steps($1, $2::uuid[])`, [id.facqMaj, [id.cmd, id.rdv, id.rdv]]))),
    ).toBe('22023');
  });
});

describe('archiver plutôt que supprimer (P05)', () => {
  it("une étape utilisée ne se supprime pas ; elle s'archive", async () => {
    await asUser(db, alice, (q) => q(`insert into actions (organization_id, client_id, deal_id, step_id) values ($1, $2, $3, $4)`, [org, id.geel, id.deal2026, id.offre]), {
      commit: true,
    });
    const closeDeals = (q: Query) => q(`update deals set status = 'won', closed_on = '2026-10-10' where pipeline_id = $1`, [id.facqMaj]);
    expect(await sqlState(as(async (q) => { await closeDeals(q); await q(`delete from pipeline_steps where id = $1`, [id.offre]); }))).toBe('23503');
    expect(await sqlState(as(async (q) => { await closeDeals(q); await q(`update pipeline_steps set archived_at = now() where id = $1`, [id.offre]); }))).toBeUndefined();
  });

  it('un groupe qui a des pipelines ne se supprime pas', async () => {
    // Refusé par la clé étrangère (pipeline) ou par la règle d'affaire ouverte : l'ordre des contrôles n'est pas garanti.
    expect(await sqlState(as((q) => q(`delete from client_groups where id = $1`, [id.facq])))).toMatch(/^(23503|23514)$/);
    expect(await as(async (q) => (await q(`select count(*)::int as n from client_groups where id = $1`, [id.facq])).rows[0].n)).toBe(1);
  });
});
