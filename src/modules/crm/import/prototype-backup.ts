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
  /** Statut d'origine, tel quel. */
  legacyStatus: string;
  /** Anomalies à montrer à l'utilisateur avant import (statut inconnu, date invalide, doublon…). */
  issues: string[];
}

// Map (et non objet) : « constructor » ou « __proto__ » ne doivent rien renvoyer.
const STATUS_MAP = new Map<string, ActionStatus>([
  ['À faire', 'todo'],
  ['RDV à fixer', 'appointment_to_set'],
  ['RDV fixé', 'appointment_set'],
  ['En cours', 'in_progress'],
  ['En attente', 'waiting'],
  ['Relance', 'follow_up'],
  ['Terminé', 'done'],
  ['Bloqué', 'blocked'],
]);

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

/** Statut reconnu, ou null s'il est inconnu (jamais réinterprété en silence). */
export function mapLegacyStatus(statut: unknown): ActionStatus | null {
  if (typeof statut !== 'string') return null;
  return STATUS_MAP.get(statut.normalize('NFC').trim()) ?? null;
}

/** Vrai pour une vraie date du calendrier au format AAAA-MM-JJ (refuse 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function migratePrototypeBackup(backup: unknown): MigratedAction[] {
  const entries = (backup as { entries?: unknown })?.entries ?? [];
  if (!Array.isArray(entries)) throw new Error('Sauvegarde invalide : « entries » doit être une liste.');

  const seen = new Set<number>();
  return (entries as PrototypeEntry[])
    // Le prototype supprimait déjà les entrées de l'ancien client CUIS.
    .filter((e) => e?.client !== 'CUIS')
    .map((e) => {
      const issues: string[] = [];
      const type = typeof e.type === 'string' ? e.type : '';
      const match = matchLegacyType(e.client, type);
      const status = mapLegacyStatus(e.statut);
      if (status === null) issues.push(`statut inconnu : « ${String(e.statut)} »`);
      let date: string | null = null;
      if (e.date) {
        if (isValidIsoDate(e.date)) date = e.date;
        else issues.push(`date invalide : « ${e.date} »`);
      }
      if (seen.has(e.id)) issues.push(`identifiant en double : ${e.id}`);
      seen.add(e.id);
      if (!match && !type.includes('Suivi')) issues.push('étape non reconnue');
      return {
        legacyId: e.id,
        groupCode: e.client,
        siteName: e.showroom,
        pipelineCode: match?.pipelineCode ?? null,
        stepCode: match?.stepCode ?? null,
        status: status ?? 'todo',
        date,
        note: e.note ?? '',
        legacyType: type,
        legacyStatus: String(e.statut ?? ''),
        issues,
      };
    });
}
