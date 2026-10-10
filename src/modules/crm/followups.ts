import { addDays } from './actions/buckets';
import type { IsoDate } from './pipeline/types';

/**
 * Relances par catégorie (proposition par défaut, réglable) : délai en jours depuis la dernière
 * visite réalisée, sinon depuis l'ajout du client. Une relance est un rappel interne au commercial.
 */

export const DEFAULT_FOLLOW_UP_DAYS: Record<'A' | 'B' | 'C', number> = { A: 42, B: 60, C: 90 };

export interface FollowUpClient {
  id: string;
  category: 'A' | 'B' | 'C' | null;
  lastVisit: IsoDate | null;
  createdOn: IsoDate;
}

export interface FollowUpDue {
  clientId: string;
  dueOn: IsoDate;
  daysLate: number;
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** Clients à relancer au plus tard dans `horizonDays` jours, les plus en retard d'abord. */
export function dueFollowUps(
  clients: FollowUpClient[],
  today: IsoDate,
  rules: Record<'A' | 'B' | 'C', number> = DEFAULT_FOLLOW_UP_DAYS,
  horizonDays = 7,
): FollowUpDue[] {
  const limit = addDays(today, horizonDays);
  return clients
    .filter((c) => c.category !== null)
    .map((c) => {
      const dueOn = addDays(c.lastVisit ?? c.createdOn, rules[c.category!]);
      return { clientId: c.id, dueOn, daysLate: Math.max(0, daysBetween(dueOn, today)) };
    })
    .filter((d) => d.dueOn <= limit)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}
