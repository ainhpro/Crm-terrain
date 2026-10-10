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
  let broken: Error | undefined;
  try {
    await client.query('begin');
    await setup(client);
    // Une connexion n'exécute qu'une requête à la fois : les appels lancés en parallèle (Promise.all)
    // sont mis en file, dans l'ordre, au lieu d'être superposés sur la même connexion.
    let queue: Promise<unknown> = Promise.resolve();
    const q = (<R extends pg.QueryResultRow>(sql: string, params?: unknown[]) => {
      const run = queue.then(() => client.query<R>(sql, params));
      queue = run.catch(() => undefined);
      return run;
    }) as Q;
    const result = await fn(q);
    await client.query('commit');
    return result;
  } catch (err) {
    // Rôle et claims sont « set local » : l'annulation les efface. Si l'annulation elle-même échoue,
    // la connexion est détruite au lieu de retourner dans le groupe (relecture S03).
    await client.query('rollback').catch((e: Error) => {
      broken = e;
    });
    throw err;
  } finally {
    client.release(broken);
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
