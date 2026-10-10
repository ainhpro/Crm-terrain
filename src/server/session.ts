import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * Session signée (HMAC) de la connexion de DÉVELOPPEMENT uniquement (AUTH_MODE=dev) : l'email seul
 * suffit, sans preuve de possession de l'adresse. Elle ne vaut rien ailleurs : hors développement,
 * aucun cookie n'est accepté, même correctement signé (relecture S02). En production, la connexion
 * passera par Supabase Auth (lien envoyé par email), qui remplacera ce fichier.
 */

const COOKIE = 'crm_session';
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET manquant ou trop court (32 caractères minimum).');
  return s;
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

export async function setSession(userId: string): Promise<void> {
  const value = `${userId}.${sign(userId)}`;
  (await cookies()).set(COOKIE, value, {
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
  if (!devAuthEnabled()) return null;
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return null;
  const id = raw.slice(0, dot);
  const sig = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * Connexion de développement : seulement sur un poste de développement. Refusée en production
 * (next start / build), sur Vercel (y compris les prévisualisations) et sur tout environnement exposé.
 */
export function devAuthEnabled(): boolean {
  return process.env.AUTH_MODE === 'dev' && process.env.NODE_ENV !== 'production' && !process.env.VERCEL && !process.env.VERCEL_ENV;
}
