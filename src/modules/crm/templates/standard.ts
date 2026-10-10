/**
 * Modèle neutre : ce que reçoit tout nouveau compte, quel que soit son métier.
 * Aucun nom de client, de marque ou de secteur ; chacun l'adapte ensuite dans Réglages › Étapes de vente.
 */
import type { PipelineTemplate } from './types';

export const STANDARD_PIPELINE: PipelineTemplate = {
  code: 'VENTE',
  label: { fr: 'Vente', nl: 'Verkoop' },
  steps: [
    { code: 'contact', short: { fr: 'CONTACT', nl: 'CONTACT' }, label: { fr: 'Premier contact', nl: 'Eerste contact' } },
    { code: 'rdv', short: { fr: 'RDV', nl: 'AFSPR' }, label: { fr: 'Rendez-vous', nl: 'Afspraak' } },
    { code: 'offre', short: { fr: 'OFFRE', nl: 'OFFERTE' }, label: { fr: 'Offre envoyée', nl: 'Offerte verstuurd' } },
    { code: 'commande', short: { fr: 'CMD', nl: 'BEST' }, label: { fr: 'Commande', nl: 'Bestelling' } },
  ],
};

/**
 * Code stable d'une étape créée par l'utilisateur, tiré de son libellé au moment de la création
 * (renommer l'étape ensuite ne change pas son code). Unique dans le pipeline.
 */
export function stepCodeFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'etape';
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** Code d'un nouveau pipeline, unique dans le compte. */
export function pipelineCodeFromName(name: string, taken: Iterable<string>): string {
  return stepCodeFromLabel(name, [...taken].map((c) => c.toLowerCase())).toUpperCase();
}
