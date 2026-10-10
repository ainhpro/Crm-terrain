import { isActionLate } from '../pipeline/engine';
import type { Action, IsoDate } from '../pipeline/types';

export interface ActionBuckets<A extends Action> {
  late: A[];
  today: A[];
  followUps: A[];
  next7Days: A[];
  appointmentsToSet: A[];
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const byDate = (a: Action, b: Action) => (a.date ?? '').localeCompare(b.date ?? '');

/**
 * Regroupe les actions de l'écran « Actions » (repris du prototype).
 * Une action peut apparaître dans plusieurs groupes (ex. en retard et relance).
 * `isImplied` écarte les actions dont l'étape est déjà validée par déduction.
 */
export function buildActionBuckets<A extends Action>(
  actions: A[],
  today: IsoDate,
  isImplied: (action: A) => boolean = () => false,
): ActionBuckets<A> {
  const open = actions.filter((a) => a.status !== 'done' && !isImplied(a));
  const in7 = addDays(today, 7);

  return {
    late: open.filter((a) => isActionLate(a, today)).sort(byDate),
    today: open.filter((a) => a.date === today),
    followUps: open.filter((a) => a.status === 'follow_up'),
    next7Days: open.filter((a) => a.date !== null && a.date > today && a.date <= in7).sort(byDate),
    appointmentsToSet: open.filter((a) => a.status === 'appointment_to_set'),
  };
}
