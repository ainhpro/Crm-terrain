/** Suivi d'une pièce : besoin → commandes → réceptions (éventuellement partielles). */

export type NeedStatus = 'needed' | 'ordered' | 'partially_received' | 'received' | 'cancelled';

export interface NeedState {
  quantity: number;
  cancelled: boolean;
  orderedQuantity: number;
  receivedQuantity: number;
}

export function needStatus(n: NeedState): NeedStatus {
  if (n.cancelled) return 'cancelled';
  if (n.receivedQuantity >= n.quantity) return 'received';
  if (n.receivedQuantity > 0) return 'partially_received';
  if (n.orderedQuantity > 0) return 'ordered';
  return 'needed';
}

/** Le retour chez le client n'est proposé que quand toutes les pièces non annulées sont reçues. */
export function readyForReturn(needs: NeedState[]): boolean {
  const active = needs.filter((n) => !n.cancelled);
  return active.length > 0 && active.every((n) => needStatus(n) === 'received');
}

/** Un email annonce-t-il une réception (« pièce disponible », « machine livrée », « beschikbaar ») ? */
export function looksLikeArrival(text: string): boolean {
  return /\b(disponible|arriv[ée]e?s?|re[çc]ue?s?|livr[ée]e?s?|exp[ée]di[ée]e?s?|en stock|beschikbaar|geleverd|aangekomen|ontvangen|binnen)\b/i.test(
    text,
  );
}
