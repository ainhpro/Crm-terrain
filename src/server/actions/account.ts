'use server';

import { redirect } from 'next/navigation';
import { authMode, supabaseConfig } from '../config';
import { requireCtx } from '../context';
import { withService, withUser } from '../db';
import { clearSession } from '../session';
import { deleteOrgFiles } from '../storage';
import { deleteAuthUser } from '../supabase/auth';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** Supprime une entreprise et toutes ses données, puis ses fichiers (propriétaire, confirmation par le nom). */
export async function deleteOrganization(formData: FormData) {
  const ctx = await requireCtx();
  if (ctx.role !== 'owner') redirect('/reglages?erreur=owner#donnees');
  if (str(formData, 'confirmName') !== ctx.orgName.trim() || formData.get('confirm') !== 'on') redirect('/reglages?erreur=confirm#donnees');
  await withUser(ctx.userId, (q) => q(`select public.delete_organization($1)`, [ctx.orgId]));
  const filesOk = await deleteOrgFiles(ctx.orgId).then(() => true, () => false);
  redirect(`/bienvenue?supprime=${filesOk ? '1' : 'fichiers'}`);
}

/**
 * Supprime le compte de l'utilisateur (règle 10). Les entreprises dont il est le seul membre sont
 * supprimées avec lui ; s'il est le seul propriétaire d'une entreprise qui a d'autres membres, il doit
 * d'abord nommer un autre propriétaire. Les heures déjà enregistrées gardent son nom (rapports intacts).
 */
export async function deleteMyAccount(formData: FormData) {
  const ctx = await requireCtx();
  if (str(formData, 'confirmEmail').toLowerCase() !== ctx.email.toLowerCase() || formData.get('confirm') !== 'on') {
    redirect('/reglages?erreur=confirm#donnees');
  }
  const mode = authMode();
  const supa = supabaseConfig();
  if (mode === 'supabase' && !supa?.serviceRoleKey) redirect('/reglages?erreur=x#donnees');

  const orgs = await withUser(ctx.userId, async (q) =>
    (await q<{ id: string; role: string; others: number; other_owners: number }>(
      `select m.organization_id as id, m.role,
              (select count(*)::int from organization_members o where o.organization_id = m.organization_id and o.user_id <> m.user_id) as others,
              (select count(*)::int from organization_members o where o.organization_id = m.organization_id and o.user_id <> m.user_id and o.role = 'owner') as other_owners
       from organization_members m where m.user_id = $1`,
      [ctx.userId],
    )).rows,
  );
  if (orgs.some((o) => o.role === 'owner' && o.others > 0 && o.other_owners === 0)) redirect('/reglages?erreur=lastOwner#donnees');

  const alone = orgs.filter((o) => o.others === 0).map((o) => o.id);
  for (const org of alone) {
    await withUser(ctx.userId, (q) => q(`select public.delete_organization($1)`, [org]));
    await deleteOrgFiles(org).catch(() => undefined);
  }
  // Traitement serveur nommé « suppression de compte » : seul endroit où le compte Auth est supprimé.
  if (mode === 'supabase') await deleteAuthUser({ url: supa!.url, serviceRoleKey: supa!.serviceRoleKey! }, ctx.userId);
  else await withService((q) => q(`delete from auth.users where id = $1`, [ctx.userId]));
  await clearSession();
  redirect('/connexion?compte=supprime');
}
