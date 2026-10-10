import { describe, expect, it } from 'vitest';
import {
  clientProgress,
  computeStepStates,
  isActionImplied,
  isActionLate,
  pipelineProgress,
} from './engine';
import type { Action, ActionStatus, Pipeline } from './types';

const TODAY = '2026-10-10';

function pipeline(code: string, stepCodes: string[], impliedByDefault?: string[]): Pipeline {
  return {
    id: code,
    code,
    steps: stepCodes.map((c, i) => ({ id: `${code}.${c}`, code: c, order: i })),
    impliedByDefault,
  };
}

let seq = 0;
function action(stepId: string | null, status: ActionStatus, date: string | null = null): Action {
  return { id: `a${++seq}`, stepId, status, date };
}

const MAJ = pipeline('FACQ_MAJ', ['rdv', 'offre', 'commande', 'placement']);
const TAR = pipeline('FACQ_TAR', ['formation_meubles', 'formation_parois']);
const SAMO = pipeline('SAMO', ['tarif', 'formation'], ['tarif']);

describe('computeStepStates', () => {
  it('renvoie none pour un client sans action', () => {
    expect(computeStepStates(MAJ, [])).toEqual(['none', 'none', 'none', 'none']);
  });

  it('une étape avancée terminée valide les étapes précédentes', () => {
    const states = computeStepStates(MAJ, [action('FACQ_MAJ.commande', 'done')]);
    expect(states).toEqual(['implied', 'implied', 'done', 'none']);
  });

  it('valide aussi une étape précédente restée ouverte', () => {
    const states = computeStepStates(MAJ, [
      action('FACQ_MAJ.rdv', 'todo'),
      action('FACQ_MAJ.offre', 'done'),
    ]);
    expect(states).toEqual(['implied', 'done', 'none', 'none']);
  });

  it('distingue RDV fixé et action ouverte', () => {
    const states = computeStepStates(MAJ, [
      action('FACQ_MAJ.rdv', 'appointment_set'),
      action('FACQ_MAJ.offre', 'follow_up'),
    ]);
    expect(states).toEqual(['scheduled', 'active', 'none', 'none']);
  });

  it("l'action la plus avancée d'une étape l'emporte", () => {
    const states = computeStepStates(MAJ, [
      action('FACQ_MAJ.rdv', 'todo'),
      action('FACQ_MAJ.rdv', 'done'),
    ]);
    expect(states[0]).toBe('done');
  });

  it('RDV à fixer et bloqué ne démarrent pas une étape (comme le prototype)', () => {
    const states = computeStepStates(MAJ, [
      action('FACQ_MAJ.rdv', 'appointment_to_set'),
      action('FACQ_MAJ.offre', 'blocked'),
    ]);
    expect(states).toEqual(['none', 'none', 'none', 'none']);
  });

  it("respecte l'ordre des étapes, pas l'ordre du tableau", () => {
    const shuffled: Pipeline = { ...MAJ, steps: [...MAJ.steps].reverse() };
    expect(computeStepStates(shuffled, [action('FACQ_MAJ.offre', 'done')])).toEqual([
      'implied',
      'done',
      'none',
      'none',
    ]);
  });

  it('applique les étapes validées par défaut (tarif SAMO)', () => {
    expect(computeStepStates(SAMO, [])).toEqual(['implied', 'none']);
  });

  it("ignore les actions d'un autre pipeline", () => {
    expect(computeStepStates(MAJ, [action('FACQ_TAR.formation_meubles', 'done')])).toEqual([
      'none',
      'none',
      'none',
      'none',
    ]);
  });
});

describe('isActionLate', () => {
  it('en retard si date passée et non terminée', () => {
    expect(isActionLate(action(null, 'todo', '2026-10-09'), TODAY)).toBe(true);
  });
  it("pas en retard le jour même, ni terminée, ni sans date", () => {
    expect(isActionLate(action(null, 'todo', TODAY), TODAY)).toBe(false);
    expect(isActionLate(action(null, 'done', '2026-01-01'), TODAY)).toBe(false);
    expect(isActionLate(action(null, 'todo', null), TODAY)).toBe(false);
  });
});

describe('pipelineProgress', () => {
  it('finished quand la dernière étape est faite ou déduite', () => {
    expect(pipelineProgress(MAJ, [action('FACQ_MAJ.placement', 'done')], TODAY)).toBe('finished');
  });
  it('late quand une action du client est en retard', () => {
    expect(pipelineProgress(MAJ, [action('FACQ_MAJ.rdv', 'todo', '2026-10-01')], TODAY)).toBe('late');
  });
  it('in_progress quand une étape a démarré', () => {
    expect(pipelineProgress(MAJ, [action('FACQ_MAJ.rdv', 'todo', '2026-10-20')], TODAY)).toBe('in_progress');
  });
  it('not_started sans action', () => {
    expect(pipelineProgress(MAJ, [], TODAY)).toBe('not_started');
  });
  it('SAMO avec seulement le tarif par défaut est en cours, formation terminée = finished', () => {
    expect(pipelineProgress(SAMO, [], TODAY)).toBe('in_progress');
    expect(pipelineProgress(SAMO, [action('SAMO.formation', 'done')], TODAY)).toBe('finished');
  });
});

describe('clientProgress (pipelines indépendants)', () => {
  it('finished seulement si tous les pipelines sont finis', () => {
    const actions = [action('FACQ_MAJ.placement', 'done')];
    expect(clientProgress([MAJ, TAR], actions, TODAY)).toBe('in_progress');
    actions.push(action('FACQ_TAR.formation_parois', 'done'));
    expect(clientProgress([MAJ, TAR], actions, TODAY)).toBe('finished');
  });
  it('late si un pipeline est en retard', () => {
    expect(clientProgress([MAJ, TAR], [action('FACQ_TAR.formation_meubles', 'todo', '2026-09-01')], TODAY)).toBe(
      'late',
    );
  });
  it('not_started si aucun pipeline démarré', () => {
    expect(clientProgress([MAJ, TAR], [], TODAY)).toBe('not_started');
  });
});

describe('isActionImplied', () => {
  it("vrai pour une action ouverte sur une étape validée par déduction", () => {
    const open = action('FACQ_MAJ.rdv', 'todo', '2026-09-01');
    const actions = [open, action('FACQ_MAJ.offre', 'done')];
    expect(isActionImplied(open, [MAJ, TAR], actions)).toBe(true);
  });
  it('faux pour une action sans étape ou sur une étape non déduite', () => {
    const note = action(null, 'todo');
    const rdv = action('FACQ_MAJ.rdv', 'todo');
    expect(isActionImplied(note, [MAJ], [note])).toBe(false);
    expect(isActionImplied(rdv, [MAJ], [rdv])).toBe(false);
  });
});
