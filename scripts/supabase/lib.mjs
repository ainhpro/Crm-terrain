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

const URL_FORM = 'postgresql://postgres.<référence>:MOT-DE-PASSE@<hôte>.pooler.supabase.com:5432/postgres';
const RESET_HINT = 'Supabase › Database › Settings › « Reset database password » : choisir un mot de passe en lettres et chiffres seulement, le coller dans DATABASE_URL, attendre une minute, relancer';
export const BAN_HINT = 'après plusieurs mots de passe refusés, Supabase bloque votre adresse internet environ 30 minutes : corriger d\'abord le mot de passe, puis attendre, ou Supabase › Database › Settings › « Network bans » pour débloquer tout de suite';

/** Adresse de base lisible ? Sinon, la piste à donner (un « # », « / » ou « ? » dans le mot de passe coupe l'adresse). */
export function dbUrlProblem(raw) {
  try {
    new URL(raw);
    return null;
  } catch {
    return `adresse illisible, souvent à cause d'un caractère spécial dans le mot de passe (# / ?). Forme attendue : ${URL_FORM}. ${RESET_HINT}`;
  }
}

/**
 * Pistes pour un mot de passe de base refusé, tirées de la seule forme de l'adresse.
 * Ne renvoie jamais le mot de passe, l'identifiant, ni un morceau de l'un ou de l'autre.
 */
export function dbPasswordHints(raw, supabaseUrl = '') {
  const u = new URL(raw);
  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s; // « % » isolé
    }
  };
  const user = decode(u.username);
  const pwd = decode(u.password);
  const typed = raw.slice(raw.indexOf('://') + 3, Math.max(raw.lastIndexOf('@'), 0)).split(':').slice(1).join(':');
  const ref = supabaseUrl.trim().match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  const pooler = /\.pooler\.supabase\.com$/.test(u.hostname);
  const hints = [];

  if (!pwd) hints.push(`l'adresse ne contient aucun mot de passe. Forme attendue : ${URL_FORM}`);
  else if (/YOUR-PASSWORD|VOTRE-MOT-DE-PASSE/i.test(pwd)) hints.push('le texte modèle est encore dans l\'adresse : remplacer [YOUR-PASSWORD], crochets compris, par votre mot de passe de base');
  else if (pwd.startsWith('[') || pwd.endsWith(']')) hints.push('les crochets [ ] sont restés autour du mot de passe : les supprimer, ils n\'en font pas partie');
  else if (pwd !== pwd.trim()) hints.push('il y a un espace au début ou à la fin du mot de passe : le supprimer');
  if (typed.includes('%')) hints.push('le mot de passe contient « % », lu comme un code dans une adresse : s\'il fait partie du mot de passe, l\'écrire %25');

  if (pooler && !user.startsWith('postgres.')) hints.push('avec l\'adresse « Session pooler », l\'identifiant est postgres.<référence du projet>, pas « postgres » seul : recopier l\'adresse entière depuis le bouton « Connect »');
  else if (ref && (pooler ? user !== `postgres.${ref}` : u.hostname.startsWith('db.') && u.hostname !== `db.${ref}.supabase.co`)) {
    hints.push('DATABASE_URL et SUPABASE_URL ne désignent pas le même projet Supabase : reprendre les deux dans le même projet');
  }

  if (!hints.length) hints.push(`l'adresse a la bonne forme : c'est le mot de passe lui-même qui est refusé. ${RESET_HINT}`);
  if (/^db\..+\.supabase\.co$/.test(u.hostname)) hints.push('au passage : c\'est l\'adresse « Direct connection » ; le guide demande celle de l\'onglet « Session pooler » (bouton « Connect »)');
  return hints;
}

/** Connexion à la base Supabase (SUPABASE_DB_URL, rôle postgres), TLS vérifié si DATABASE_SSL_CA est fourni. */
export async function connectDb() {
  // Adresse dédiée aux scripts, sinon celle de l'application (un seul fichier .env.local sur un PC).
  if (!process.env.SUPABASE_DB_URL?.trim() && process.env.DATABASE_URL?.trim()) process.env.SUPABASE_DB_URL = process.env.DATABASE_URL;
  const raw = need('SUPABASE_DB_URL');
  const unreadable = dbUrlProblem(raw);
  if (unreadable) {
    console.error(`SUPABASE_DB_URL / DATABASE_URL : ${unreadable}. Rien n'a été fait.`);
    process.exit(2);
  }
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
  try {
    await client.connect();
  } catch (e) {
    await client.end().catch(() => {});
    if (e.code === '28P01') {
      console.error('Mot de passe de la base refusé. Rien n\'a été fait.');
      for (const h of dbPasswordHints(raw, process.env.SUPABASE_URL)) console.error(`  → ${h}`);
    } else if (e.code === 'ECONNREFUSED' && !local) {
      console.error(`Connexion refusée par la base (${url.hostname}). Rien n'a été fait.\n  → ${BAN_HINT}`);
    } else console.error(`Base injoignable (${url.hostname}) : ${String(e.message || e.code || 'erreur réseau').slice(0, 200)}. Rien n'a été fait. Vérifier l'adresse « Session pooler », port 5432.`);
    process.exit(2);
  }
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
