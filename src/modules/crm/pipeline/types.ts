/** Date au format ISO "AAAA-MM-JJ", sans heure ni fuseau. */
export type IsoDate = string;

/**
 * Statuts d'une action. Les codes sont stables ; les libellés affichés
 * (« À faire », « RDV fixé »…) vivent dans les fichiers de langue.
 */
export const ACTION_STATUSES = [
  'todo', // À faire
  'appointment_to_set', // RDV à fixer
  'appointment_set', // RDV fixé
  'in_progress', // En cours
  'waiting', // En attente
  'follow_up', // Relance
  'done', // Terminé
  'blocked', // Bloqué
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface PipelineStep {
  id: string;
  /** Identifiant stable de l'étape : jamais le libellé. */
  code: string;
  order: number;
}

export interface Pipeline {
  id: string;
  code: string;
  steps: PipelineStep[];
  /** Codes d'étapes considérées faites par défaut (ex. tarif SAMO toujours livré). */
  impliedByDefault?: string[];
}

export interface Action {
  id: string;
  stepId: string | null;
  status: ActionStatus;
  date: IsoDate | null;
}

/**
 * État calculé d'une étape :
 * - done : une action de l'étape est terminée
 * - implied : validée par déduction (une étape plus avancée est terminée, ou validée par défaut)
 * - scheduled : RDV fixé
 * - active : action ouverte (à faire, en cours, en attente, relance)
 * - none : rien
 */
export type StepState = 'done' | 'implied' | 'scheduled' | 'active' | 'none';

export type ProgressStatus = 'finished' | 'late' | 'in_progress' | 'not_started';
