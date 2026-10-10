'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { withService } from '../db';
import { clearSession, devAuthEnabled, setSession } from '../session';

/** Connexion de développement (AUTH_MODE=dev) : l'email seul suffit. Remplacée par Supabase Auth en production. */
export async function devLogin(formData: FormData) {
  if (!devAuthEnabled()) redirect('/connexion?erreur=disabled');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect('/connexion?erreur=email');
  const userId = await withService(async (q) => {
    const found = await q<{ id: string }>(`select id from auth.users where lower(email) = $1`, [email]);
    if (found.rows[0]) return found.rows[0].id;
    const id = randomUUID();
    await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, email]);
    return id;
  });
  await setSession(userId);
  redirect('/');
}

export async function logout() {
  await clearSession();
  redirect('/connexion');
}
