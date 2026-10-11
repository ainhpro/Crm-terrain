import 'server-only';
import { cookies } from 'next/headers';
import { authMode, devAuthAllowed } from './config';
import { decodeSession, encodeSession, type SessionKind } from './session-token';

/**
 * Session de l'application : cookie httpOnly signé, posé seulement après une preuve d'identité
 * (Supabase Auth en production ; email seul en développement). Voir session-token.ts.
 */

const COOKIE = 'crm_session';
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET manquant ou trop court (32 caractères minimum).');
  return s;
}

/** Modes de session acceptés par ce serveur. */
function allowedKinds(): SessionKind[] {
  const mode = authMode();
  if (mode === 'supabase') return ['s'];
  if (mode === 'dev') return ['d'];
  return [];
}

export async function setSession(userId: string, kind: SessionKind): Promise<void> {
  if (!allowedKinds().includes(kind)) throw new Error('mode de connexion refusé sur ce serveur');
  (await cookies()).set(COOKIE, encodeSession(kind, userId, secret()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function sessionUserId(): Promise<string | null> {
  const kinds = allowedKinds();
  if (!kinds.length) return null;
  return decodeSession((await cookies()).get(COOKIE)?.value, secret(), kinds);
}

/** Connexion de développement (email seul) possible sur ce serveur ? */
export function devAuthEnabled(): boolean {
  return authMode() === 'dev' && devAuthAllowed();
}
