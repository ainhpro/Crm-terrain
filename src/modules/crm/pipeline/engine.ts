import type { Action, IsoDate, Pipeline, PipelineStep, ProgressStatus, StepState } from './types';

// Le statut de pipeline n'est jamais stocké : tout est recalculé à partir des actions.

const ACTIVE_STATUSES = new Set(['todo', 'in_progress', 'waiting', 'follow_up']);

function sortedSteps(pipeline: Pipeline): PipelineStep[] {
  return [...pipeline.steps].sort((a, b) => a.order - b.order);
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
 * `actions` = les actions d'un seul client.
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

/**
 * Avancement d'un client sur un pipeline.
 * Comme dans le prototype, le retard se mesure sur toutes les actions du client.
 */
export function pipelineProgress(pipeline: Pipeline, actions: Action[], today: IsoDate): ProgressStatus {
  const states = computeStepStates(pipeline, actions);
  if (states.length > 0 && isStepCompleted(states[states.length - 1])) return 'finished';
  if (actions.some((a) => isActionLate(a, today))) return 'late';
  if (states.some((s) => s !== 'none')) return 'in_progress';
  return 'not_started';
}

/**
 * Avancement global d'un client suivi sur plusieurs pipelines indépendants
 * (ex. FACQ : « MAJ showroom » et « Tarifs & formations »).
 */
export function clientProgress(pipelines: Pipeline[], actions: Action[], today: IsoDate): ProgressStatus {
  if (pipelines.length === 0) return 'not_started';
  const all = pipelines.map((p) => pipelineProgress(p, actions, today));
  if (all.every((s) => s === 'finished')) return 'finished';
  if (all.some((s) => s === 'late')) return 'late';
  if (all.every((s) => s === 'not_started')) return 'not_started';
  return 'in_progress';
}

/** Vrai si l'action porte sur une étape validée par déduction : elle ne doit plus apparaître dans les urgences. */
export function isActionImplied(action: Action, pipelines: Pipeline[], actions: Action[]): boolean {
  if (action.stepId === null) return false;
  for (const p of pipelines) {
    const state = stepState(p, action.stepId, actions);
    if (state !== null) return state === 'implied';
  }
  return false;
}
