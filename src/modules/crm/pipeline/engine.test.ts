import { describe, expect, it } from 'vitest';
import {
  clientProgress,
  computeStepStates,
  dealProgress,
  isActionImplied,
  isActionLate,
  isActionOpen,
} from './engine';
import { buildActionBuckets } from '../actions/buckets';
import type { Action, ActionStatus, Deal, DealStatus, Pipeline } from './types';

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

const deal = (pipeline: Pipeline, actions: Action[], status: DealStatus = 'open'): Deal => ({
  id: `d${++seq}`,
  pipeline,
  status,
  actions,
});

describe('dealProgress', () => {
  it('finished quand la dernière étape est faite ou déduite', () => {
    expect(dealProgress(deal(MAJ, [action('FACQ_MAJ.placement', 'done')]), TODAY)).toBe('finished');
  });
  it('late quand une action réellement ouverte est en retard', () => {
    expect(dealProgress(deal(MAJ, [action('FACQ_MAJ.rdv', 'todo', '2026-10-01')]), TODAY)).toBe('late');
  });
  it('in_progress quand une étape a démarré', () => {
    expect(dealProgress(deal(MAJ, [action('FACQ_MAJ.rdv', 'todo', '2026-10-20')]), TODAY)).toBe('in_progress');
  });
  it('not_started sans action', () => {
    expect(dealProgress(deal(MAJ, []), TODAY)).toBe('not_started');
  });
  it('SAMO avec seulement le tarif par défaut est en cours, formation terminée = finished', () => {
    expect(dealProgress(deal(SAMO, []), TODAY)).toBe('in_progress');
    expect(dealProgress(deal(SAMO, [action('SAMO.formation', 'done')]), TODAY)).toBe('finished');
  });
  it('gagnée = finished ; perdue ou abandonnée = closed, même avec un retard', () => {
    const late = [action('FACQ_MAJ.rdv', 'todo', '2026-09-01')];
    expect(dealProgress(deal(MAJ, late, 'won'), TODAY)).toBe('finished');
    expect(dealProgress(deal(MAJ, late, 'lost'), TODAY)).toBe('closed');
    expect(dealProgress(deal(MAJ, late, 'abandoned'), TODAY)).toBe('closed');
  });
});

describe('P01 : une seule définition de « réellement ouverte »', () => {
  it("RDV en retard puis offre faite : ni urgence, ni retard sur l'affaire", () => {
    const rdv = action('FACQ_MAJ.rdv', 'todo', '2026-10-01');
    const actions = [rdv, action('FACQ_MAJ.offre', 'done')];
    const d = deal(MAJ, actions);
    expect(computeStepStates(MAJ, actions)).toEqual(['implied', 'done', 'none', 'none']);
    expect(isActionOpen(rdv, MAJ, actions)).toBe(false);
    expect(buildActionBuckets(actions, TODAY, (a) => !isActionOpen(a, MAJ, actions)).late).toEqual([]);
    expect(dealProgress(d, TODAY)).toBe('in_progress');
  });
});

describe('P02 : affaires indépendantes chez un même client', () => {
  it("un placement terminé en 2025 ne termine pas l'affaire 2026", () => {
    const old = deal(MAJ, [action('FACQ_MAJ.placement', 'done')], 'won');
    const current = deal(MAJ, [action('FACQ_MAJ.rdv', 'appointment_set', '2026-10-20')]);
    expect(dealProgress(old, TODAY)).toBe('finished');
    expect(dealProgress(current, TODAY)).toBe('in_progress');
    expect(clientProgress([old, current], [], TODAY)).toBe('in_progress');
  });
});

describe('clientProgress', () => {
  it('finished seulement si toutes les affaires actives sont finies', () => {
    const maj = deal(MAJ, [action('FACQ_MAJ.placement', 'done')]);
    const tar = deal(TAR, []);
    expect(clientProgress([maj, tar], [], TODAY)).toBe('in_progress');
    const tarDone = deal(TAR, [action('FACQ_TAR.formation_parois', 'done')]);
    expect(clientProgress([maj, tarDone], [], TODAY)).toBe('finished');
  });
  it("late si une affaire est en retard, ou une action hors affaire", () => {
    expect(clientProgress([deal(TAR, [action('FACQ_TAR.formation_meubles', 'todo', '2026-09-01')])], [], TODAY)).toBe('late');
    expect(clientProgress([], [action(null, 'todo', '2026-09-01')], TODAY)).toBe('late');
  });
  it('les affaires closes sont ignorées', () => {
    const lost = deal(MAJ, [action('FACQ_MAJ.rdv', 'todo', '2026-09-01')], 'lost');
    expect(clientProgress([lost], [], TODAY)).toBe('closed');
    expect(clientProgress([lost, deal(TAR, [])], [], TODAY)).toBe('not_started');
  });
  it('not_started sans affaire ni action', () => {
    expect(clientProgress([], [], TODAY)).toBe('not_started');
  });
});

describe('isActionImplied', () => {
  it("vrai pour une action ouverte sur une étape validée par déduction", () => {
    const open = action('FACQ_MAJ.rdv', 'todo', '2026-09-01');
    const actions = [open, action('FACQ_MAJ.offre', 'done')];
    expect(isActionImplied(open, MAJ, actions)).toBe(true);
  });
  it('faux pour une action sans étape ou sur une étape non déduite', () => {
    const note = action(null, 'todo');
    const rdv = action('FACQ_MAJ.rdv', 'todo');
    expect(isActionImplied(note, MAJ, [note])).toBe(false);
    expect(isActionImplied(rdv, MAJ, [rdv])).toBe(false);
  });
});

describe('P03 : ordre stable', () => {
  it('deux étapes à la même position sont départagées par leur code, pas par l’ordre reçu', () => {
    const p1: Pipeline = { id: 'P', code: 'P', steps: [
      { id: 'P.b', code: 'b', order: 0 }, { id: 'P.a', code: 'a', order: 0 } ] };
    const p2: Pipeline = { ...p1, steps: [...p1.steps].reverse() };
    const acts = [action('P.b', 'done')];
    expect(computeStepStates(p1, acts)).toEqual(computeStepStates(p2, acts));
  });
});
