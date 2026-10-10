import 'server-only';
import pg from 'pg';

/**
 * Accès à la base. Les opérations ordinaires passent par withUser : transaction avec le rôle
 * `authenticated` et l'identifiant de l'utilisateur dans les claims, exactement comme l'API Supabase,
 * donc la RLS s'applique (règle n°2). withService est réservé aux traitements serveur nommés.
 */

const globalForPool = globalThis as unknown as { crmPool?: pg.Pool };

function pool(): pg.Pool {
  if (!globalForPool.crmPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL manquant (voir .env.example et npm run db:start).');
    globalForPool.crmPool = new pg.Pool({ connectionString, max: 10 });
  }
  return globalForPool.crmPool;
}

export type Q = <R extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<pg.QueryResult<R>>;

async function inTransaction<T>(setup: (c: pg.PoolClient) => Promise<void>, fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('begin');
    await setup(client);
    const result = await fn((sql, params) => client.query(sql, params as unknown[]));
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function withUser<T>(userId: string, fn: (q: Q) => Promise<T>): Promise<T> {
  return inTransaction(async (c) => {
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  }, fn);
}

/** Traitement serveur sans RLS (connexion, file d'envoi). Doit vérifier lui-même l'organisation. */
export function withService<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return inTransaction(async () => undefined, fn);
}

/** Code SQLSTATE d'une erreur Postgres. */
export function pgCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code;
}
