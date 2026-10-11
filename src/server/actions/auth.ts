'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseConfig } from '../config';
import { withService } from '../db';
import { clearSession, devAuthEnabled, setSession } from '../session';
import { AuthError, sendLoginEmail, verifyCode, verifyLink } from '../supabase/auth';

const PENDING = 'crm_login_email';
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

/** Connexion de développement (AUTH_MODE=dev) : l'email seul suffit. Refusée dès que Supabase est configuré. */
export async function devLogin(formData: FormData) {
  if (!devAuthEnabled()) redirect('/connexion?erreur=disabled');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!isEmail(email)) redirect('/connexion?erreur=email');
  const userId = await withService(async (q) => {
    const found = await q<{ id: string }>(`select id from auth.users where lower(email) = $1`, [email]);
    if (found.rows[0]) return found.rows[0].id;
    const id = randomUUID();
    await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, email]);
    return id;
  });
  await setSession(userId, 'd');
  redirect('/');
}

function authFailure(e: unknown): never {
  const code = e instanceof AuthError ? e.code : 'unavailable';
  redirect(`/connexion?erreur=${code}`);
}

/** Étape 1 : envoie l'email de connexion (lien + code). L'adresse est gardée dans un cookie court, pas dans l'URL. */
export async function sendLoginLink(formData: FormData) {
  const cfg = supabaseConfig();
  if (!cfg) redirect('/connexion?erreur=disabled');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!isEmail(email)) redirect('/connexion?erreur=email');
  try {
    await sendLoginEmail(cfg, email);
  } catch (e) {
    authFailure(e);
  }
  (await cookies()).set(PENDING, email, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 });
  redirect('/connexion?envoye=1');
}

/** Étape 2, au choix : le code à 6 chiffres reçu par email… */
export async function verifyLoginCode(formData: FormData) {
  const cfg = supabaseConfig();
  if (!cfg) redirect('/connexion?erreur=disabled');
  const jar = await cookies();
  const email = jar.get(PENDING)?.value ?? '';
  if (!isEmail(email)) redirect('/connexion?erreur=expired');
  let userId = '';
  try {
    userId = (await verifyCode(cfg, email, String(formData.get('code') ?? ''))).id;
  } catch (e) {
    redirect(`/connexion?envoye=1&erreur=${e instanceof AuthError ? e.code : 'unavailable'}`);
  }
  jar.delete(PENDING);
  await setSession(userId, 's');
  redirect('/');
}

/** … ou le lien de l'email, confirmé par un bouton (un lien ouvert par un antivirus ne consomme rien). */
export async function confirmLoginLink(formData: FormData) {
  const cfg = supabaseConfig();
  if (!cfg) redirect('/connexion?erreur=disabled');
  let userId = '';
  try {
    userId = (await verifyLink(cfg, String(formData.get('token_hash') ?? ''))).id;
  } catch (e) {
    authFailure(e);
  }
  (await cookies()).delete(PENDING);
  await setSession(userId, 's');
  redirect('/');
}

export async function logout() {
  await clearSession();
  redirect('/connexion');
}
