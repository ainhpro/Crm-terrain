/**
 * Temps et prix d'un passage. Tout est calculé ici, par le code, jamais par l'IA.
 * Montants en centimes (entiers) ; durées en minutes.
 */

export interface WorkerTime {
  arrivedAt: Date | null;
  leftAt: Date | null;
  breakMinutes: number;
}

export type PricingMode = 'none' | 'hourly' | 'flat';

export interface PricingInput {
  mode: PricingMode;
  hourlyRateCents?: number | null;
  flatCents?: number | null;
  /** TVA en points de base : 2100 = 21 %. */
  vatRateBp: number;
  /** Arrondi au multiple supérieur (minutes). */
  roundingMinutes: number;
}

export interface PricingResult {
  /** Présence cumulée des intervenants (départ − arrivée). */
  presenceMinutes: number;
  /** Pauses déduites. */
  breakMinutes?: number;
  /** Temps travaillé réel (présence − pauses), avant arrondi. */
  workedMinutes?: number;
  /** Durée retenue : le temps travaillé total, arrondi une seule fois. */
  billableMinutes: number;
  amountExclCents: number | null;
  amountInclCents: number | null;
}

/** Présence d'un intervenant, en minutes entières (départ − arrivée, pauses non déduites). */
export function presenceMinutes(t: WorkerTime): number {
  if (!t.arrivedAt || !t.leftAt) return 0;
  const ms = t.leftAt.getTime() - t.arrivedAt.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 60000);
}

/** Durée facturable d'un intervenant : présence moins pauses, jamais négative. */
export function workedMinutes(t: WorkerTime): number {
  return Math.max(0, presenceMinutes(t) - Math.max(0, t.breakMinutes));
}

export function roundUp(minutes: number, step: number): number {
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / step) * step;
}

/** Montant TVA comprise, arrondi au centime le plus proche (demi vers le haut). */
export function withVat(exclCents: number, vatRateBp: number): number {
  return exclCents + Math.round((exclCents * vatRateBp) / 10000);
}

/**
 * Calcule le prix d'un passage. Plusieurs intervenants : leurs temps travaillés s'additionnent
 * (deux personnes = deux fois le temps), puis le total est arrondi UNE fois au multiple supérieur
 * (relecture M04 : deux séquences de 7 min font 14 min, retenues 15 min au quart d'heure, pas 30).
 */
export function priceVisit(workers: WorkerTime[], input: PricingInput): PricingResult {
  const presence = workers.reduce((s, w) => s + presenceMinutes(w), 0);
  const worked = workers.reduce((s, w) => s + workedMinutes(w), 0);
  const billable = roundUp(worked, input.roundingMinutes);
  let excl: number | null = null;
  if (input.mode === 'hourly') {
    const rate = input.hourlyRateCents ?? 0;
    excl = Math.round((rate * billable) / 60);
  } else if (input.mode === 'flat') {
    excl = input.flatCents ?? 0;
  }
  return {
    presenceMinutes: presence,
    breakMinutes: presence - worked,
    workedMinutes: worked,
    billableMinutes: billable,
    amountExclCents: excl,
    amountInclCents: excl === null ? null : withVat(excl, input.vatRateBp),
  };
}

export type RecipientKind = 'principal' | 'client' | 'internal';

/**
 * Ce qu'un destinataire voit du prix (R02) : le donneur d'ordre voit le montant HTVA ;
 * un particulier ne voit un montant que s'il paie, et alors TVA comprise ; jamais le tarif négocié.
 */
export function priceForRecipient(
  result: PricingResult,
  recipient: RecipientKind,
  payer: 'principal' | 'client' | 'other',
): { label: 'excl' | 'incl'; cents: number } | null {
  if (result.amountExclCents === null) return null;
  if (recipient === 'internal' || recipient === 'principal') return { label: 'excl', cents: result.amountExclCents };
  if (payer === 'client') return { label: 'incl', cents: result.amountInclCents ?? result.amountExclCents };
  return null;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function formatEuro(cents: number, locale = 'fr-BE'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/** Lit un montant saisi (« 50 », « 50,5 », « 1.234,56 ») en centimes ; null si illisible. */
export function parseEuroToCents(input: string): number | null {
  const s = input.replace(/\s|€/g, '');
  if (!/^\d{1,3}([.]\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(s)) return null;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}
