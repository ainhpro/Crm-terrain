'use server';

import { redirect } from 'next/navigation';
import { getLocale } from '@/i18n/server';
import { defaultOptions, type TypeKind } from '@/modules/interventions/options';
import { withUser } from '../db';
import { sessionUserId } from '../session';

const PROFILES = ['commercial', 'technician', 'both'] as const;

/** Création du compte : organisation, profil choisi une seule fois, types par défaut pour un technicien. */
export async function createAccount(formData: FormData) {
  const userId = await sessionUserId();
  if (!userId) redirect('/connexion');
  const name = String(formData.get('orgName') ?? '').trim();
  const profile = String(formData.get('profile') ?? '');
  if (!name || !PROFILES.includes(profile as (typeof PROFILES)[number])) redirect('/bienvenue?erreur=1');
  const locale = await getLocale();
  await withUser(userId, async (q) => {
    const org = (await q<{ id: string }>(`select public.create_organization($1, $2) as id`, [name, locale])).rows[0]!.id;
    await q(`update organizations set profile = $1 where id = $2`, [profile, org]);
    let typeIds: string[] = [];
    let kinds: TypeKind[] = [];
    if (profile !== 'commercial') {
      const defaults: [string, TypeKind][] =
        locale === 'nl'
          ? [['Dienst na verkoop', 'sav'], ['Opmeting', 'measure'], ['Plaatsing showroom', 'showroom']]
          : [['SAV', 'sav'], ['Prise de mesure', 'measure'], ['Placement showroom', 'showroom']];
      for (const [i, [typeName, kind]] of defaults.entries()) {
        const r = await q<{ id: string }>(
          `insert into intervention_types (organization_id, name, kind, position) values ($1, $2, $3, $4) returning id`,
          [org, typeName, kind, i],
        );
        typeIds.push(r.rows[0]!.id);
        kinds.push(kind);
      }
    }
    await q(`insert into member_settings (organization_id, user_id, profile, type_ids, options) values ($1, $2, $3, $4, $5)`, [
      org,
      userId,
      profile,
      typeIds,
      JSON.stringify(defaultOptions(kinds)),
    ]);
  });
  redirect('/demarrer');
}
