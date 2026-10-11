/**
 * Configuration lue dans l'environnement, côté serveur uniquement (aucune clé en NEXT_PUBLIC_).
 * Deux façons de se connecter, jamais en même temps :
 * - « supabase » : Supabase Auth, lien ou code envoyé par email (preuve de possession de l'adresse) ;
 * - « dev » : email seul, sur un poste de développement uniquement (jamais en production ni sur Vercel).
 */

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

/** Adresse publique de l'application (liens des emails de connexion). */
export function appUrl(env: Env = process.env): string | null {
  const u = env.APP_URL?.trim().replace(/\/+$/, '');
  return u || null;
}
