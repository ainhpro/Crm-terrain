import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { addMember, asUser, connect, createOrg, createUser, type Query, sqlState } from './helpers';

// Relecture externe de la V1 : S01 (parcours réservés au propriétaire), D01 (affaires en cours),
// D02 (PDF figés), accès simultanés, connexion réutilisée après une erreur (S03).

let db: pg.Client;
let alice: string; // propriétaire
let bob: string; // membre
let carla: string; // seconde propriétaire
let org: string;
const id: Record<string, string> = {};

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@r.test');
  bob = await createUser(db, 'bob@r.test');
  carla = await createUser(db, 'carla@r.test');
  org = await createOrg(db, alice, 'Relecture');
  await addMember(db, alice, org, bob, 'bob@r.test');
  await addMember(db, alice, org, carla, 'carla@r.test', 'owner');
  await asUser(
    db,
    alice,
    async (q) => {
      const one = async (sql: string, p: unknown[]) => (await q(sql, p)).rows[0].id as string;
      id.client = await one(`insert into clients (organization_id, name) values ($1, 'Garage Lambert') returning id`, [org]);
      id.pipeline = await one(`insert into pipelines (organization_id, code, name) values ($1, 'VENTE', 'Vente') returning id`, [org]);
      for (const [k, pos] of [['contact', 0], ['offre', 1], ['commande', 2]] as const)
        id[k] = await one(
          `insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, $3, $3, $4) returning id`,
          [org, id.pipeline, k, pos],
        );
      id.free = await one(`insert into pipelines (organization_id, code, name) values ($1, 'LIBRE', 'Libre') returning id`, [org]);
      for (const [k, pos] of [['a', 0], ['b', 1]] as const)
        id[`free_${k}`] = await one(
          `insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, $3, $3, $4) returning id`,
          [org, id.free, k, pos],
        );
      id.deal = await one(`insert into deals (organization_id, client_id, pipeline_id, name) values ($1, $2, $3, 'Vente 2026') returning id`, [
        org, id.client, id.pipeline,
      ]);
      id.type = await one(`insert into intervention_types (organization_id, name, kind) values ($1, 'SAV', 'sav') returning id`, [org]);
      id.case = await one(`insert into service_cases (organization_id, type_id, client_id, problem) values ($1, $2, $3, 'Porte') returning id`, [
        org, id.type, id.client,
      ]);
      id.visit = await one(`insert into service_visits (organization_id, case_id, scheduled_at) values ($1, $2, now()) returning id`, [org, id.case]);
      id.report = await one(`insert into report_versions (organization_id, visit_id, version, done_text) values ($1, $2, 1, 'Fait') returning id`, [
        org, id.visit,
      ]);
      id.draft = await one(`insert into report_versions (organization_id, visit_id, version, done_text) values ($1, $2, 2, 'Brouillon') returning id`, [
        org, id.visit,
      ]);
    },
    { commit: true },
  );
});

afterAll(async () => {
  await db.end();
});

const as = <T>(user: string, fn: (q: Query) => Promise<T>) => asUser(db, user, fn);

describe('S01 : parcours modifiables par le propriétaire seulement', () => {
  it('un membre lit les parcours et leurs étapes', async () => {
    const n = await as(bob, async (q) => (await q(`select count(*)::int as n from pipeline_steps where pipeline_id = $1`, [id.pipeline])).rows[0].n);
    expect(n).toBe(3);
  });

  it('un membre ne crée ni parcours ni étape', async () => {
    expect(await sqlState(as(bob, (q) => q(`insert into pipelines (organization_id, code, name) values ($1, 'X', 'X')`, [org])))).toBe('42501');
    expect(
      await sqlState(
        as(bob, (q) => q(`insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'x', 'x', 9)`, [org, id.free])),
      ),
    ).toBe('42501');
  });

  it('un membre ne modifie ni ne supprime rien, même en SQL direct', async () => {
    const changed = await as(bob, async (q) => [
      (await q(`update pipelines set name = 'Piraté' where id = $1`, [id.free])).rowCount,
      (await q(`update pipeline_steps set label = 'Piraté' where id = $1`, [id.free_a])).rowCount,
      (await q(`delete from pipeline_steps where id = $1`, [id.free_b])).rowCount,
      (await q(`delete from pipelines where id = $1`, [id.free])).rowCount,
    ]);
    expect(changed).toEqual([0, 0, 0, 0]);
  });

  it('un membre ne réordonne pas les étapes par la fonction dédiée', async () => {
    expect(await sqlState(as(bob, (q) => q(`select public.reorder_pipeline_steps($1, $2::uuid[])`, [id.free, [id.free_b, id.free_a]])))).toBe('22023');
  });

  it('le propriétaire modifie, ajoute et réordonne', async () => {
    const r = await as(alice, async (q) => {
      await q(`update pipeline_steps set label = 'Premier contact' where id = $1`, [id.free_a]);
      await q(`insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'c', 'c', 2)`, [org, id.free]);
      await q(`select public.reorder_pipeline_steps($1, (select array_agg(id order by position desc) from pipeline_steps where pipeline_id = $1))`, [id.free]);
      return (await q(`select label from pipeline_steps where pipeline_id = $1 order by position`, [id.free])).rows.map((x) => x.label);
    });
    expect(r).toEqual(['c', 'b', 'Premier contact']);
  });
});

describe('D01 : un parcours suivi par une affaire en cours', () => {
  it('on peut renommer une étape et en ajouter une', async () => {
    expect(
      await sqlState(
        as(alice, async (q) => {
          await q(`update pipeline_steps set label = 'Offre envoyée', short_label = 'OFFRE' where id = $1`, [id.offre]);
          await q(`insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'livraison', 'Livraison', 3)`, [
            org, id.pipeline,
          ]);
        }),
      ),
    ).toBeUndefined();
  });

  it('retirer, supprimer ou déplacer une étape est refusé (l’affaire ne passe pas pour terminée)', async () => {
    expect(await sqlState(as(alice, (q) => q(`update pipeline_steps set archived_at = now() where id = $1`, [id.commande])))).toBe('55006');
    expect(await sqlState(as(alice, (q) => q(`delete from pipeline_steps where id = $1`, [id.commande])))).toBe('55006');
    expect(
      await sqlState(as(alice, (q) => q(`select public.reorder_pipeline_steps($1, $2::uuid[])`, [id.pipeline, [id.offre, id.contact, id.commande]]))),
    ).toBe('55006');
  });

  it('une fois l’affaire close, la structure redevient modifiable', async () => {
    const state = await sqlState(
      as(alice, async (q) => {
        await q(`update deals set status = 'won', closed_on = '2026-10-10' where id = $1`, [id.deal]);
        await q(`update pipeline_steps set archived_at = now() where id = $1`, [id.commande]);
      }),
    );
    expect(state).toBeUndefined();
  });
});

describe('D02 : PDF figés avec la version validée', () => {
  it('la validation, puis l’enregistrement des PDF une seule fois', async () => {
    await asUser(
      db,
      alice,
      async (q) => {
        await q(`update report_versions set status = 'validated', validated_at = now(), no_signature_reason = 'not_required' where id = $1`, [id.report]);
        await q(`update report_versions set pdf_path = 'o/a.pdf', client_pdf_path = 'o/b.pdf' where id = $1`, [id.report]);
      },
      { commit: true },
    );
    expect(await sqlState(as(alice, (q) => q(`update report_versions set pdf_path = 'o/autre.pdf' where id = $1`, [id.report])))).toBe('55000');
  });

  it('on ne glisse pas une autre modification avec l’enregistrement des PDF', async () => {
    const other = await asUser(db, alice, async (q) =>
      (await q(`insert into report_versions (organization_id, visit_id, version, done_text, status, validated_at, no_signature_reason)
                values ($1, $2, 9, 'Fait', 'validated', now(), 'not_required') returning id`, [org, id.visit])).rows[0].id as string,
      { commit: true });
    expect(await sqlState(as(alice, (q) => q(`update report_versions set pdf_path = 'p.pdf', done_text = 'Autre' where id = $1`, [other])))).toBe('55000');
  });
});

describe('accès simultanés', () => {
  async function second(): Promise<pg.Client> {
    const c = connect();
    await c.connect();
    return c;
  }

  async function begin(c: pg.Client, user: string) {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })]);
  }

  it('deux propriétaires qui partent en même temps : il en reste un', async () => {
    const c2 = await second();
    try {
      // Les deux départs se croisent : le second attend le premier, puis est refusé.
      await begin(db, alice);
      await begin(c2, carla);
      await db.query(`delete from organization_members where organization_id = $1 and user_id = $2`, [org, alice]);
      const blocked = c2.query(`delete from organization_members where organization_id = $1 and user_id = $2`, [org, carla]).then(
        () => undefined,
        (e: { code?: string }) => e.code,
      );
      await db.query('commit');
      expect(await blocked).toBe('P0001');
      await c2.query('rollback');
      const owners = await as(carla, async (q) => (await q(`select count(*)::int as n from organization_members where organization_id = $1 and role = 'owner'`, [org])).rows[0].n);
      expect(owners).toBe(1);
    } finally {
      await c2.end();
    }
  });

  it('deux acceptations simultanées de la même invitation : un seul effet', async () => {
    const dan = await createUser(db, 'dan@r.test');
    const token = await asUser(db, carla, async (q) => (await q(`select public.invite_member($1, 'dan@r.test', 'member') as t`, [org])).rows[0].t, {
      commit: true,
    });
    const c2 = await second();
    try {
      await begin(db, dan);
      await begin(c2, dan);
      await db.query(`select public.accept_invitation($1)`, [token]);
      const late = c2.query(`select public.accept_invitation($1)`, [token]).then(
        () => undefined,
        (e: { code?: string }) => e.code,
      );
      await db.query('commit');
      expect(await late).toBe('P0001');
      await c2.query('rollback');
    } finally {
      await c2.end();
    }
  });

  it('deux validations simultanées du même brouillon : une seule version validée, un seul envoi', async () => {
    const c2 = await second();
    const validate = (c: pg.Client) =>
      c
        .query(`update report_versions set status = 'validated', validated_at = now(), no_signature_reason = 'not_required' where id = $1`, [id.draft])
        .then(() =>
          c.query(
            `insert into outbound_messages (organization_id, case_id, report_version_id, kind, recipient_label, idempotency_key)
             values ($1, $2, $3, 'report_email', 'Client', $4) on conflict (organization_id, idempotency_key) do nothing`,
            [org, id.case, id.draft, `report:${id.draft}:client`],
          ),
        );
    try {
      await begin(db, carla);
      await begin(c2, carla);
      await validate(db);
      const late = validate(c2).then(
        () => undefined,
        (e: { code?: string }) => e.code,
      );
      await db.query('commit');
      expect(await late).toBe('55000');
      await c2.query('rollback');
      const n = await as(carla, async (q) => (await q(`select count(*)::int as n from outbound_messages where report_version_id = $1`, [id.draft])).rows[0].n);
      expect(n).toBe(1);
    } finally {
      await c2.end();
    }
  });
});

describe('S03 : une connexion réutilisée après une erreur ne garde aucune identité', () => {
  it('withUser : erreur pour un compte, puis requêtes pour un autre sur la même connexion', async () => {
    // withUser lit DATABASE_URL : ici, la base de test jetable, et un seul client pour forcer la réutilisation.
    process.env.DATABASE_URL = inject('testDbUrl');
    (globalThis as unknown as { crmPool?: pg.Pool }).crmPool = new pg.Pool({ connectionString: inject('testDbUrl'), max: 1 });
    const { withUser, withService } = await import('../../src/server/db');
    await expect(
      withUser(alice, async (q) => {
        await q(`select 1`);
        throw new Error('panne au milieu');
      }),
    ).rejects.toThrow('panne au milieu');
    await expect(withUser(alice, (q) => q(`select 1/0`))).rejects.toThrow();
    const seen = await withUser(bob, async (q) => (await q(`select auth.uid()::text as uid, current_user as role`)).rows[0]);
    expect(seen).toEqual({ uid: bob, role: 'authenticated' });
    const service = await withService(async (q) => (await q(`select auth.uid()::text as uid, current_user as role`)).rows[0]);
    expect(service!.uid).toBeNull();
    expect(service!.role).not.toBe('authenticated');
    await (globalThis as unknown as { crmPool: pg.Pool }).crmPool.end();
  });
});
