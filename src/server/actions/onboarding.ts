'use server';

import { redirect } from 'next/navigation';
import { getLocale } from '@/i18n/server';
import { effectiveProfile, isProfile } from '@/modules/crm/formule';
import { STANDARD_PIPELINE } from '@/modules/crm/templates/standard';
import { defaultOptions, type TypeKind } from '@/modules/interventions/options';
import { STANDARD_INTERVENTION_TYPES } from '@/modules/interventions/standard';
import { withUser } from '../db';
import { sessionUserId } from '../session';

/**
 * Création du compte : organisation, profil choisi une seule fois, et un point de départ neutre
 * (étapes de vente génériques ; types d'intervention génériques pour un technicien), modifiable dans Réglages.
 * Les modules viennent de la formule de l'installation, fixés par la base : le profil s'y plie
 * (formule technicien : profil technicien, aucune étape de vente).
 */
export async function createAccount(formData: FormData) {
  const userId = await sessionUserId();
  if (!userId) redirect('/connexion');
  const name = String(formData.get('orgName') ?? '').trim();
  const requested = String(formData.get('profile') ?? '');
  if (!name || !isProfile(requested)) redirect('/bienvenue?erreur=1');
  const locale = await getLocale();
  await withUser(userId, async (q) => {
    const org = (await q<{ id: string }>(`select public.create_organization($1, $2) as id`, [name, locale])).rows[0]!.id;
    const modules = (await q<{ modules: string[] }>(`select modules from organizations where id = $1`, [org])).rows[0]!.modules;
    const profile = effectiveProfile(requested, modules);
    await q(`update organizations set profile = $1 where id = $2`, [profile, org]);
    const lang = locale === 'nl' ? 'nl' : 'fr';
    if (modules.includes('crm')) {
      const pipeline = (
        await q<{ id: string }>(`insert into pipelines (organization_id, code, name, position) values ($1, $2, $3, 0) returning id`, [
          org, STANDARD_PIPELINE.code, STANDARD_PIPELINE.label[lang],
        ])
      ).rows[0]!.id;
      for (const [i, step] of STANDARD_PIPELINE.steps.entries()) {
        await q(`insert into pipeline_steps (organization_id, pipeline_id, code, label, short_label, position) values ($1, $2, $3, $4, $5, $6)`, [
          org, pipeline, step.code, step.label[lang], step.short[lang], i,
        ]);
      }
    }
    const typeIds: string[] = [];
    const kinds: TypeKind[] = [];
    if (profile !== 'commercial') {
      for (const [i, type] of STANDARD_INTERVENTION_TYPES.entries()) {
        const r = await q<{ id: string }>(
          `insert into intervention_types (organization_id, name, kind, position) values ($1, $2, $3, $4) returning id`,
          [org, type.label[lang], type.kind, i],
        );
        typeIds.push(r.rows[0]!.id);
        kinds.push(type.kind);
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
