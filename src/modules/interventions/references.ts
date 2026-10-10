/**
 * Numéros de tickets dans l'objet ou le corps d'un email.
 * Ne fait que proposer : le rattachement à un dossier reste validé par le technicien.
 */

const PATTERNS = [
  /\b(?:ticket|tkt|dossier|sav|réf(?:érence)?|ref|n°|no|nr|nummer|bon)\.?\s*(?:n°|no|nr|#|:)?\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,24}[A-Z0-9])/gi,
  /#\s*([A-Z0-9][A-Z0-9\-\/.]{2,24}[A-Z0-9])/g,
];

/** Numéros trouvés, sans doublon, dans l'ordre d'apparition ; uniquement ceux qui contiennent un chiffre. */
export function extractTicketNumbers(...texts: (string | null | undefined)[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) {
        const n = m[1]!.replace(/[.]+$/, '');
        if (/\d/.test(n) && !found.some((f) => f.toLowerCase() === n.toLowerCase())) found.push(n);
      }
    }
  }
  return found;
}

export function normalizeTicket(n: string): string {
  return n.trim().toLowerCase();
}
