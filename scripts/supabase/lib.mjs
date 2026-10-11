// Outils partagés des scripts Supabase. Les secrets viennent de l'environnement (jamais du dépôt).
import pg from 'pg';

export function need(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Variable manquante : ${name} (voir docs/supabase.md).`);
    process.exit(2);
  }
  return v;
}

/** Référence du projet, tirée de SUPABASE_URL (https://<ref>.supabase.co). */
export function projectRef() {
  const m = need('SUPABASE_URL').match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/);
  if (!m) {
    console.error('SUPABASE_URL doit être de la forme https://<ref>.supabase.co');
    process.exit(2);
  }
  return m[1];
}

/** Connexion à la base Supabase (SUPABASE_DB_URL, rôle postgres), TLS vérifié si DATABASE_SSL_CA est fourni. */
export async function connectDb() {
  const raw = need('SUPABASE_DB_URL');
  const url = new URL(raw);
  if (!/(\.supabase\.(co|com)|pooler\.supabase\.com)$/.test(url.hostname) && process.env.ALLOW_NON_SUPABASE_DB !== '1') {
    console.error(`Hôte inattendu pour SUPABASE_DB_URL : ${url.hostname}. Rien n'a été fait.`);
    process.exit(2);
  }
  for (const k of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(k);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname); // essai sur une copie locale
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, '\n').trim();
  if (!ca && !local) console.warn('Attention : DATABASE_SSL_CA absent, certificat du serveur non vérifié.');
  const ssl = local ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url.toString(), ssl });
  await client.connect();
  return client;
}

export async function http(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* réponse non JSON */
  }
  return { status: res.status, ok: res.ok, json, text };
}

export const serviceHeaders = () => {
  const k = need('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: k, authorization: `Bearer ${k}` };
};
export const managementHeaders = () => ({ authorization: `Bearer ${need('SUPABASE_ACCESS_TOKEN')}` });

export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'fichiers';
