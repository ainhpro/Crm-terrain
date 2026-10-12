import type { Field, ParsedRequest } from './request';

/**
 * Contrôle, par le code, de la lecture d'un email de demande faite par l'IA. Même format que la
 * lecture par règles (request.ts). Rien d'inventé ne passe : un numéro de ticket, un téléphone ou
 * un email doit figurer tel quel dans l'email ; chaque champ n'est « sûr » que si sa citation y figure.
 */

interface Q<T> {
  value: T;
  quote: string | null;
}

export interface AiRequestDraft {
  tickets: Q<string[]>;
  phone: Q<string | null>;
  email: Q<string | null>;
  postal_address: Q<string | null>;
  warranty: Q<'yes' | 'no' | 'unknown'>;
  problem: Q<string>;
  language: 'fr' | 'nl';
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const inText = (all: string, s: string | null | undefined) => !!s && s.trim().length >= 2 && norm(all).includes(norm(s));
const digits = (s: string) => s.replace(/\D/g, '');

export function checkAiRequest(draft: AiRequestDraft, subject: string, body: string): ParsedRequest {
  const all = `${subject}\n${body}`;
  const field = <T>(value: T, quote: string | null, sure: boolean): Field<T> => ({
    value,
    source: inText(all, quote) ? quote!.trim() : null,
    confident: sure && inText(all, quote),
  });
  const tickets = draft.tickets.value.map((t) => t.trim()).filter((t) => t && inText(all, t));
  // Téléphone : les chiffres doivent se retrouver dans l'email (mise en forme libre).
  const phone = draft.phone.value && digits(all).includes(digits(draft.phone.value)) && digits(draft.phone.value).length >= 8 ? draft.phone.value.trim() : null;
  const email = draft.email.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.value) && inText(all, draft.email.value) ? draft.email.value.trim().toLowerCase() : null;
  const address = draft.postal_address.value && inText(all, draft.postal_address.quote) ? draft.postal_address.value.trim() : null;
  return {
    subject: { value: subject.trim(), source: subject.trim() || null, confident: true },
    tickets: field(tickets, draft.tickets.quote, tickets.length === 1),
    phone: field(phone, phone ? draft.phone.quote : null, phone !== null),
    email: field(email, email ? draft.email.quote : null, email !== null),
    postalAddress: field(address, address ? draft.postal_address.quote : null, false),
    warranty: field(['yes', 'no', 'unknown'].includes(draft.warranty.value) ? draft.warranty.value : 'unknown', draft.warranty.quote, false),
    problem: field(draft.problem.value.trim().slice(0, 400), draft.problem.quote, false),
    language: { value: draft.language === 'nl' ? 'nl' : 'fr', source: null, confident: true },
  };
}
