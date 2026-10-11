import 'server-only';
import pg from 'pg';

/**
 * Accès à la base. Les opérations ordinaires passent par withUser : transaction avec le rôle
 * `authenticated` et l'identifiant de l'utilisateur dans les claims, exactement comme l'API Supabase,
 * donc la RLS s'applique (règle n°2). withService est réservé aux traitements serveur nommés.
 */

const globalForPool = globalThis as unknown as { crmPool?: pg.Pool };

/**
 * TLS vers Supabase : certificat vérifié avec l'autorité de Supabase (DATABASE_SSL_CA, contenu PEM
 * téléchargé dans Project Settings › Database). Sans elle, une base distante est refusée en production
 * plutôt que d'accepter une connexion non vérifiée. Base locale : sans TLS.
 */
export function sslOptions(connectionString: string, env: Record<string, string | undefined> = process.env): pg.ConnectionConfig['ssl'] {
  const host = new URL(connectionString).hostname;
  if (['localhost', '127.0.0.1', '::1', ''].includes(host)) return undefined;
  const ca = env.DATABASE_SSL_CA?.replace(/\\n/g, '\n').trim();
  if (ca) return { ca, rejectUnauthorized: true };
  if (env.NODE_ENV === 'production') throw new Error('DATABASE_SSL_CA manquant : connexion à la base distante non vérifiée refusée.');
  return { rejectUnauthorized: false }; // poste de développement relié à une base de test distante
}

function pool(): pg.Pool {
  if (!globalForPool.crmPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL manquant (voir .env.example et npm run db:start).');
    // Les paramètres sslmode de l'adresse remplaceraient les options TLS ci-dessous : on les retire.
    const url = new URL(connectionString);
    for (const k of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(k);
    globalForPool.crmPool = new pg.Pool({ connectionString: url.toString(), ssl: sslOptions(connectionString), max: Number(process.env.DB_POOL_MAX) || 10 });
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
