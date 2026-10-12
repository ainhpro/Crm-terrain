/**
 * Supabase Auth (API REST GoTrue), appelée par le serveur uniquement (règle 2) : le téléphone ne parle
 * qu'à l'application. Connexion sans mot de passe : un email contient un lien et un code à 6 chiffres.
 * On ne garde pas les jetons Supabase : une fois l'identité prouvée, l'application pose sa propre
 * session signée (session.ts) et ferme aussitôt la session Supabase.
 */
import { keyHeaders } from './keys';

export interface AuthClientConfig {
  url: string;
  anonKey: string;
  fetch?: typeof fetch;
}

export interface VerifiedUser {
  id: string;
  email: string;
}

export type AuthErrorCode = 'rate_limited' | 'invalid' | 'expired' | 'unavailable';

export class AuthError extends Error {
  constructor(public code: AuthErrorCode, message?: string) {
    super(message ?? code);
  }
}

function headers(cfg: AuthClientConfig, token?: string): Record<string, string> {
  return { ...keyHeaders(cfg.anonKey, token), 'content-type': 'application/json' };
}

async function call(cfg: AuthClientConfig, path: string, body: unknown, token?: string): Promise<Response> {
  const f = cfg.fetch ?? fetch;
  try {
    return await f(`${cfg.url}/auth/v1/${path}`, { method: 'POST', headers: headers(cfg, token), body: JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new AuthError('unavailable');
  }
}

async function failure(res: Response): Promise<never> {
  let detail = '';
  try {
    const j = (await res.json()) as { error_code?: string; code?: string | number; msg?: string; message?: string };
    detail = String(j.error_code ?? j.code ?? j.msg ?? j.message ?? '');
  } catch {
    /* corps vide */
  }
  if (res.status === 429 || /rate/.test(detail)) throw new AuthError('rate_limited', detail);
  if (/expired/.test(detail)) throw new AuthError('expired', detail);
  if (res.status >= 500) throw new AuthError('unavailable', detail);
  throw new AuthError('invalid', detail);
}

/** Envoie l'email de connexion (lien + code). Crée le compte Auth au premier passage. */
export async function sendLoginEmail(cfg: AuthClientConfig, email: string): Promise<void> {
  const res = await call(cfg, 'otp', { email: email.trim().toLowerCase(), create_user: true });
  if (!res.ok) await failure(res);
}

async function verified(cfg: AuthClientConfig, res: Response): Promise<VerifiedUser> {
  if (!res.ok) await failure(res);
  const j = (await res.json()) as { access_token?: string; user?: { id?: string; email?: string; email_confirmed_at?: string | null } };
  const id = j.user?.id;
  const email = j.user?.email;
  if (!id || !email || !j.user?.email_confirmed_at) throw new AuthError('invalid', 'utilisateur non confirmé');
  // La session Supabase ne sert plus : on la ferme (au mieux) pour ne pas laisser de jeton actif.
  if (j.access_token) await call(cfg, 'logout?scope=local', {}, j.access_token).catch(() => undefined);
  return { id, email };
}

/** Code à 6 chiffres saisi par l'utilisateur. */
export async function verifyCode(cfg: AuthClientConfig, email: string, code: string): Promise<VerifiedUser> {
  const token = code.replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) throw new AuthError('invalid');
  return verified(cfg, await call(cfg, 'verify', { type: 'email', email: email.trim().toLowerCase(), token }));
}

/** Lien reçu par email (token_hash). Appelé après un clic sur un bouton, jamais à l'ouverture du lien. */
export async function verifyLink(cfg: AuthClientConfig, tokenHash: string): Promise<VerifiedUser> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash)) throw new AuthError('invalid');
  return verified(cfg, await call(cfg, 'verify', { type: 'email', token_hash: tokenHash }));
}

/** Suppression définitive d'un compte Auth (traitement serveur nommé « suppression de compte », clé service_role). */
export async function deleteAuthUser(cfg: { url: string; serviceRoleKey: string; fetch?: typeof fetch }, userId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new AuthError('invalid');
  let res: Response;
  try {
    res = await (cfg.fetch ?? fetch)(`${cfg.url}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: keyHeaders(cfg.serviceRoleKey),
      cache: 'no-store',
    });
  } catch {
    throw new AuthError('unavailable');
  }
  if (!res.ok && res.status !== 404) throw new AuthError(res.status >= 500 ? 'unavailable' : 'invalid', `HTTP ${res.status}`);
}
