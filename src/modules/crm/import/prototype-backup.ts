import type { ActionStatus } from '../pipeline/types';

/**
 * Reprise des données du prototype INDA 2026 (bouton BACKUP → JSON {"entries": [...]}).
 * Le prototype reconnaissait les étapes en cherchant du texte dans le libellé ;
 * ici on convertit une seule fois chaque libellé historique en code d'étape.
 */

export interface PrototypeEntry {
  id: number;
  client: string;
  showroom: string;
  type: string;
  statut: string;
  date?: string;
  note?: string;
}

export interface MigratedAction {
  legacyId: number;
  groupCode: string;
  siteName: string;
  pipelineCode: string | null;
  stepCode: string | null;
  status: ActionStatus;
  date: string | null;
  note: string;
  /** Libellé d'origine, conservé pour contrôle et pour les actions non classées. */
  legacyType: string;
}

const STATUS_MAP: Record<string, ActionStatus> = {
  'À faire': 'todo',
  'RDV à fixer': 'appointment_to_set',
  'RDV fixé': 'appointment_set',
  'En cours': 'in_progress',
  'En attente': 'waiting',
  Relance: 'follow_up',
  Terminé: 'done',
  Bloqué: 'blocked',
};

type Rule = { pipeline: string; step: string; patterns: string[] };

// Même ordre et mêmes motifs que les « matchers » du prototype.
const RULES: Record<string, Rule[]> = {
  FACQ: [
    { pipeline: 'FACQ_MAJ', step: 'rdv', patterns: ['RDV Mise à jour', 'MAJ — RDV', 'MAU — RDV', 'Mise à jour Showroom'] },
    { pipeline: 'FACQ_MAJ', step: 'offre', patterns: ['Offre Showroom', 'MAJ — Offre', 'MAU — Offre'] },
    { pipeline: 'FACQ_MAJ', step: 'commande', patterns: ['Commande'] },
    { pipeline: 'FACQ_MAJ', step: 'placement', patterns: ['Placement'] },
    { pipeline: 'FACQ_TAR', step: 'formation_meubles', patterns: ['Formation Meubles'] },
    { pipeline: 'FACQ_TAR', step: 'formation_parois', patterns: ['Formation Parois'] },
  ],
  STG: [
    { pipeline: 'STG_PLACE', step: 'rdv', patterns: ['RDV Responsable', 'PLACEMENT — RDV', 'RDV showroom'] },
    {
      pipeline: 'STG_PLACE',
      step: 'proposition',
      patterns: ['Proposition', 'Étude Projet', 'Offre Showroom', 'Offre showroom'],
    },
    { pipeline: 'STG_PLACE', step: 'commande', patterns: ['Commande'] },
    { pipeline: 'STG_PLACE', step: 'placement', patterns: ['Placement'] },
    {
      pipeline: 'STG_FORM',
      step: 'formation',
      patterns: ['Formation Meubles', 'FORMATION — Formation', 'Formation Parois'],
    },
  ],
  SAMO: [
    // Le prototype ne rattachait aucune action au tarif (toujours implicite) ;
    // « Livraison Tarifs SAMO » y est désormais rattachée.
    { pipeline: 'SAMO', step: 'tarif', patterns: ['Livraison Tarifs'] },
    { pipeline: 'SAMO', step: 'formation', patterns: ['Formation'] },
  ],
};

export function matchLegacyType(client: string, type: string): { pipelineCode: string; stepCode: string } | null {
  const rule = (RULES[client] ?? []).find((r) => r.patterns.some((p) => type.includes(p)));
  return rule ? { pipelineCode: rule.pipeline, stepCode: rule.step } : null;
}

export function mapLegacyStatus(statut: string): ActionStatus {
  return STATUS_MAP[statut] ?? 'todo';
}

export function migratePrototypeBackup(backup: { entries?: PrototypeEntry[] }): MigratedAction[] {
  return (backup.entries ?? [])
    // Le prototype supprimait déjà les entrées de l'ancien client CUIS.
    .filter((e) => e.client !== 'CUIS')
    .map((e) => {
      const match = matchLegacyType(e.client, e.type);
      return {
        legacyId: e.id,
        groupCode: e.client,
        siteName: e.showroom,
        pipelineCode: match?.pipelineCode ?? null,
        stepCode: match?.stepCode ?? null,
        status: mapLegacyStatus(e.statut),
        date: e.date ? e.date : null,
        note: e.note ?? '',
        legacyType: e.type,
      };
    });
}
