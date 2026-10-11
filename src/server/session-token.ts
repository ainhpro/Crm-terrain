import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Jeton de session signé (HMAC-SHA256) : « mode.utilisateur.signature ».
 * Le mode dit comment l'identité a été prouvée : « s » = Supabase Auth (lien ou code reçu par email),
 * « d » = connexion de développement. Un jeton n'est accepté que si son mode est autorisé sur ce serveur :
 * un jeton de développement ne vaut rien en production, même signé avec le même secret (relecture S02).
 */

export type SessionKind = 's' | 'd';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeSession(kind: SessionKind, userId: string, secret: string): string {
  if (!UUID.test(userId)) throw new Error('identifiant invalide');
  const payload = `${kind}.${userId}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeSession(raw: string | undefined, secret: string, allowed: SessionKind[]): string | null {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [kind, userId, sig] = parts as [string, string, string];
  if (!allowed.includes(kind as SessionKind) || !UUID.test(userId)) return null;
  const expected = Buffer.from(sign(`${kind}.${userId}`, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}
