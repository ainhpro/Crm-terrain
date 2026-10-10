import type { Action, Deal, IsoDate, Pipeline, PipelineStep, ProgressStatus, StepState } from './types';

// Le statut de pipeline n'est jamais stocké : tout est recalculé, par affaire, à partir de ses actions.

const ACTIVE_STATUSES = new Set(['todo', 'in_progress', 'waiting', 'follow_up']);

// Ordre stable même si deux étapes partageaient une position (la base l'interdit désormais).
function sortedSteps(pipeline: Pipeline): PipelineStep[] {
  return [...pipeline.steps].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
}

/** État brut d'une étape d'après ses propres actions (la plus avancée l'emporte). */
function rawStepState(stepId: string, actions: Action[]): StepState {
  const own = actions.filter((a) => a.stepId === stepId);
  if (own.some((a) => a.status === 'done')) return 'done';
  if (own.some((a) => a.status === 'appointment_set')) return 'scheduled';
  if (own.some((a) => ACTIVE_STATUSES.has(a.status))) return 'active';
  return 'none';
}

/**
 * États des étapes d'un pipeline, dans l'ordre des étapes.
 * Règle métier : une étape avancée terminée valide toutes les étapes précédentes.
 * `actions` = les actions d'une seule affaire.
 */
export function computeStepStates(pipeline: Pipeline, actions: Action[]): StepState[] {
  const steps = sortedSteps(pipeline);
  const states = steps.map((s) => rawStepState(s.id, actions));

  const lastDone = states.lastIndexOf('done');
  for (let i = 0; i < lastDone; i++) {
    if (states[i] !== 'done') states[i] = 'implied';
  }

  const byDefault = new Set(pipeline.impliedByDefault ?? []);
  steps.forEach((s, i) => {
    if (byDefault.has(s.code) && states[i] === 'none') states[i] = 'implied';
  });

  return states;
}

/** État d'une étape précise, ou null si l'étape n'appartient pas au pipeline. */
export function stepState(pipeline: Pipeline, stepId: string, actions: Action[]): StepState | null {
  const idx = sortedSteps(pipeline).findIndex((s) => s.id === stepId);
  if (idx < 0) return null;
  return computeStepStates(pipeline, actions)[idx] ?? null;
}

export function isStepCompleted(state: StepState | null | undefined): boolean {
  return state === 'done' || state === 'implied';
}

export function isActionLate(action: Action, today: IsoDate): boolean {
  return action.status !== 'done' && action.date !== null && action.date < today;
}

/** Vrai si l'action porte sur une étape validée par déduction : elle ne doit plus apparaître dans les urgences. */
export function isActionImplied(action: Action, pipeline: Pipeline, actions: Action[]): boolean {
  if (action.stepId === null) return false;
  return stepState(pipeline, action.stepId, actions) === 'implied';
}

/**
 * Définition unique d'une action « réellement ouverte », utilisée pour les urgences,
 * les retards et les statuts : pas terminée, et son étape n'est pas déjà validée par déduction.
 */
export function isActionOpen(action: Action, pipeline: Pipeline | null, actions: Action[]): boolean {
  if (action.status === 'done') return false;
  return pipeline === null || !isActionImplied(action, pipeline, actions);
}

export function isOpenAndLate(action: Action, pipeline: Pipeline | null, actions: Action[], today: IsoDate): boolean {
  return isActionLate(action, today) && isActionOpen(action, pipeline, actions);
}

/** Avancement d'une affaire. Une affaire gagnée est finie ; perdue ou abandonnée, elle est close. */
export function dealProgress(deal: Deal, today: IsoDate): ProgressStatus {
  if (deal.status === 'lost' || deal.status === 'abandoned') return 'closed';
  if (deal.status === 'won') return 'finished';
  const states = computeStepStates(deal.pipeline, deal.actions);
  if (states.length > 0 && isStepCompleted(states[states.length - 1])) return 'finished';
  if (deal.actions.some((a) => isOpenAndLate(a, deal.pipeline, deal.actions, today))) return 'late';
  if (states.some((s) => s !== 'none')) return 'in_progress';
  return 'not_started';
}

/**
 * Avancement global d'un client : ses affaires (hors affaires closes) et ses actions hors affaire
 * (notes, suivis). Fini si toutes les affaires sont finies ; en retard si une affaire est en retard
 * ou si une action hors affaire réellement ouverte est en retard.
 */
export function clientProgress(deals: Deal[], looseActions: Action[], today: IsoDate): ProgressStatus {
  const active = deals.map((d) => dealProgress(d, today)).filter((s) => s !== 'closed');
  const looseLate = looseActions.some((a) => isOpenAndLate(a, null, looseActions, today));
  if (active.includes('late') || looseLate) return 'late';
  if (active.length === 0) return deals.length > 0 ? 'closed' : 'not_started';
  if (active.every((s) => s === 'finished')) return 'finished';
  if (active.every((s) => s === 'not_started')) return 'not_started';
  return 'in_progress';
}
