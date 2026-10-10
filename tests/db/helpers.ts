import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

export type Query = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

export function connect(): pg.Client {
  return new pg.Client({ connectionString: inject('testDbUrl') });
}

/** Crée un utilisateur dans auth.users (email confirmé par défaut ; le déclencheur crée son profil). */
export async function createUser(db: pg.Client, email: string, { confirmed = true } = {}): Promise<string> {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [
    id,
    email,
    confirmed ? new Date() : null,
  ]);
  return id;
}

/**
 * Exécute fn comme l'API Supabase pour un utilisateur connecté (rôle authenticated + identifiant
 * dans les claims JWT) ou un visiteur (rôle anon), dans une transaction annulée à la fin
 * sauf si commit = true.
 */
export async function asUser<T>(
  db: pg.Client,
  userId: string | null,
  fn: (q: Query) => Promise<T>,
  { commit = false } = {},
): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    if (userId) {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ]);
    }
    const result = await fn((sql, params) => db.query(sql, params as unknown[]));
    await db.query(commit ? 'commit' : 'rollback');
    return result;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}

/** Code SQLSTATE d'une erreur Postgres, pour distinguer un refus de droit (42501) d'une clé étrangère (23503). */
export async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  }
}

/** Crée une organisation et en fait l'utilisateur propriétaire. */
export async function createOrg(db: pg.Client, ownerId: string, name: string): Promise<string> {
  return asUser(db, ownerId, async (q) => (await q(`select public.create_organization($1) as id`, [name])).rows[0].id, {
    commit: true,
  });
}

export interface OrgRows {
  group: string;
  client: string;
  contact: string;
  pipeline: string;
  step: string;
  action: string;
}

/** Remplit une organisation d'une ligne par table métier, en tant que son propriétaire. */
export async function seedOrg(db: pg.Client, ownerId: string, orgId: string, label: string): Promise<OrgRows> {
  return asUser(
    db,
    ownerId,
    async (q) => {
      const one = async (sql: string, params: unknown[]) => (await q(sql, params)).rows[0].id as string;
      const group = await one(`insert into client_groups (organization_id, name) values ($1, $2) returning id`, [
        orgId,
        `Groupe ${label}`,
      ]);
      const client = await one(
        `insert into clients (organization_id, group_id, name, category) values ($1, $2, $3, 'A') returning id`,
        [orgId, group, `Client ${label}`],
      );
      const contact = await one(
        `insert into contacts (organization_id, client_id, name) values ($1, $2, 'Responsable') returning id`,
        [orgId, client],
      );
      const pipeline = await one(
        `insert into pipelines (organization_id, code, name, group_id) values ($1, 'MAJ', 'MAJ showroom', $2) returning id`,
        [orgId, group],
      );
      const step = await one(
        `insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, 'rdv', 'RDV', 0) returning id`,
        [orgId, pipeline],
      );
      const action = await one(
        `insert into actions (organization_id, client_id, step_id, status, due_date) values ($1, $2, $3, 'todo', '2026-10-20') returning id`,
        [orgId, client, step],
      );
      return { group, client, contact, pipeline, step, action };
    },
    { commit: true },
  );
}

/** Invite puis fait accepter : chemin normal pour ajouter un membre. */
export async function addMember(
  db: pg.Client,
  ownerId: string,
  orgId: string,
  memberId: string,
  email: string,
  role: 'owner' | 'member' = 'member',
): Promise<void> {
  const token = await asUser(
    db,
    ownerId,
    async (q) => (await q(`select public.invite_member($1, $2, $3) as token`, [orgId, email, role])).rows[0].token,
    { commit: true },
  );
  await asUser(db, memberId, (q) => q(`select public.accept_invitation($1)`, [token]), { commit: true });
}
