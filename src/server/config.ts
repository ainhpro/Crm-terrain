/**
 * Configuration lue dans l'environnement, côté serveur uniquement (aucune clé en NEXT_PUBLIC_).
 * Deux façons de se connecter, jamais en même temps :
 * - « supabase » : Supabase Auth, lien ou code envoyé par email (preuve de possession de l'adresse) ;
 * - « dev » : email seul, sur un poste de développement uniquement (jamais en production ni sur Vercel).
 */

import type { ReceptionScheme } from '@/modules/interventions/inbound';

export type AuthMode = 'supabase' | 'dev' | 'none';
export type StorageMode = 'supabase' | 'local';

type Env = Record<string, string | undefined>;

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string | null;
  bucket: string;
}

export function supabaseConfig(env: Env = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    throw new Error('SUPABASE_URL invalide : https://<projet>.supabase.co attendu.');
  }
  return { url, anonKey, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null, bucket: env.SUPABASE_STORAGE_BUCKET?.trim() || 'fichiers' };
}

/** Le mode développement n'existe que sur un poste de développement. */
export function devAuthAllowed(env: Env = process.env): boolean {
  return env.AUTH_MODE === 'dev' && env.NODE_ENV !== 'production' && !env.VERCEL && !env.VERCEL_ENV;
}

export function authMode(env: Env = process.env): AuthMode {
  // Supabase configuré : seule la connexion vérifiée est possible, même si AUTH_MODE=dev traîne.
  if (supabaseConfig(env)) return 'supabase';
  return devAuthAllowed(env) ? 'dev' : 'none';
}

/** Fichiers : Supabase Storage (bucket privé) dès que la clé serveur est là, sinon disque local (développement). */
export function storageMode(env: Env = process.env): StorageMode {
  const s = supabaseConfig(env);
  return s?.serviceRoleKey ? 'supabase' : 'local';
}

/** Envoi réel des emails (Brevo) : clé et adresse d'expédition d'un domaine authentifié. */
export function brevoConfig(env: Env = process.env): { apiKey: string; senderEmail: string; senderName: string; apiUrl: string } | null {
  const apiKey = env.BREVO_API_KEY?.trim();
  const senderEmail = env.BREVO_SENDER_EMAIL?.trim();
  if (!apiKey || !senderEmail) return null;
  // Adresse de l'API : Brevo, ou un service de test local (jamais un autre hôte).
  const apiUrl = env.BREVO_API_URL?.trim() || 'https://api.brevo.com';
  if (!/^https:\/\/api\.brevo\.com$|^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(apiUrl)) throw new Error('BREVO_API_URL invalide');
  return { apiKey, senderEmail, senderName: env.BREVO_SENDER_NAME?.trim() || 'Sitôt', apiUrl };
}

/** Adresse publique de l'application (liens des emails de connexion). */
export function appUrl(env: Env = process.env): string | null {
  const u = env.APP_URL?.trim().replace(/\/+$/, '');
  return u || null;
}

/**
 * Réception des emails par transfert (Brevo) : domaine de réception (enregistrements MX vers Brevo) et
 * clé secrète de l'adresse d'appel (?cle=…), 24 caractères au moins. Sans les deux, rien n'est reçu.
 */
export function inboundConfig(env: Env = process.env): { domain: string; secret: string } | null {
  const domain = env.INBOUND_DOMAIN?.trim().toLowerCase();
  const secret = env.INBOUND_SECRET?.trim();
  if (!domain || !secret || secret.length < 24) return null;
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) return null;
  return { domain, secret };
}

/**
 * Relève d'une boîte mail par IMAP (réception sans domaine ni mise en ligne) : la boîte IMAP_USER reçoit
 * les emails transférés à « <boîte>+<jeton>@<domaine> ». Hors poste local, connexion chiffrée (port 993)
 * obligatoire. Gmail : mot de passe d'application (les espaces affichés par Google sont retirés).
 */
export function imapConfig(env: Env = process.env): { host: string; port: number; user: string; password: string } | null {
  const host = env.IMAP_HOST?.trim().toLowerCase();
  const user = env.IMAP_USER?.trim().toLowerCase();
  let password = env.IMAP_PASSWORD ?? '';
  if (!host || !user || !password) return null;
  if (!/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(user)) return null;
  const port = Number(env.IMAP_PORT?.trim() || 993);
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  if (!Number.isInteger(port) || (!local && port !== 993)) return null;
  if (host === 'imap.gmail.com') password = password.replace(/\s+/g, '');
  return { host, port, user, password };
}

/** Forme des adresses de réception affichées : domaine à soi (Brevo) si configuré, sinon boîte IMAP. */
export function receptionScheme(env: Env = process.env): ReceptionScheme | null {
  const inbound = inboundConfig(env);
  if (inbound) return { kind: 'domain', domain: inbound.domain };
  const imap = imapConfig(env);
  return imap ? { kind: 'plus', mailbox: imap.user } : null;
}
