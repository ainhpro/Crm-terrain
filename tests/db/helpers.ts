import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { testDbUrl } from './global-setup';

export function connect(): pg.Client {
  return new pg.Client({ connectionString: testDbUrl(process.env.DATABASE_URL!) });
}

/** Crée un utilisateur dans auth.users (le déclencheur crée son profil). */
export async function createUser(db: pg.Client, email: string): Promise<string> {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  return id;
}

/**
 * Exécute fn comme le ferait l'API Supabase pour un utilisateur connecté :
 * rôle authenticated + identifiant dans les claims JWT, le tout dans une transaction annulée à la fin
 * sauf si commit = true.
 */
export async function asUser<T>(
  db: pg.Client,
  userId: string | null,
  fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
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
