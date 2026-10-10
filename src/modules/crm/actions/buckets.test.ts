import { describe, expect, it } from 'vitest';
import type { Action, ActionStatus } from '../pipeline/types';
import { addDays, buildActionBuckets } from './buckets';

const TODAY = '2026-10-10';
let seq = 0;
const a = (status: ActionStatus, date: string | null): Action => ({ id: `a${++seq}`, stepId: null, status, date });

describe('addDays', () => {
  it('franchit les fins de mois et le changement d’heure sans décalage', () => {
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
    expect(addDays('2026-03-27', 3)).toBe('2026-03-30');
  });
});

describe('buildActionBuckets', () => {
  it('classe les actions comme l’écran Actions du prototype', () => {
    const late = a('todo', '2026-10-01');
    const today = a('in_progress', TODAY);
    const soon = a('todo', '2026-10-17');
    const tooFar = a('todo', '2026-10-18');
    const followUp = a('follow_up', null);
    const toSet = a('appointment_to_set', null);
    const done = a('done', '2026-10-01');

    const b = buildActionBuckets([soon, late, today, tooFar, followUp, toSet, done], TODAY);
    expect(b.late).toEqual([late]);
    expect(b.today).toEqual([today]);
    expect(b.next7Days).toEqual([soon]);
    expect(b.followUps).toEqual([followUp]);
    expect(b.appointmentsToSet).toEqual([toSet]);
  });

  it('trie les retards du plus ancien au plus récent', () => {
    const x = a('todo', '2026-10-05');
    const y = a('todo', '2026-09-01');
    expect(buildActionBuckets([x, y], TODAY).late).toEqual([y, x]);
  });

  it('écarte les actions validées par déduction', () => {
    const implied = a('todo', '2026-10-01');
    expect(buildActionBuckets([implied], TODAY, (x) => x === implied).late).toEqual([]);
  });
});
