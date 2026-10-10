import { extractTicketNumbers } from './references';

/**
 * Lecture d'une demande d'intervention reçue par email (version locale, sans IA).
 * Chaque champ garde sa source (l'extrait lu) pour que le technicien vérifie (E02).
 * L'IA pourra remplacer cette lecture plus tard, avec le même format de sortie.
 */

export interface Field<T> {
  value: T;
  source: string | null;
  confident: boolean;
}

export interface ParsedRequest {
  subject: Field<string>;
  tickets: Field<string[]>;
  phone: Field<string | null>;
  email: Field<string | null>;
  postalAddress: Field<string | null>;
  warranty: Field<'yes' | 'no' | 'unknown'>;
  problem: Field<string>;
  language: Field<'fr' | 'nl'>;
}

const PHONE = /(?:\+32|0032|0)\s?[1-9](?:[\s./-]?\d{2}){3,4}/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
// Rue + numéro, code postal belge à 4 chiffres + localité.
const ADDRESS = /([A-ZÀ-Ýa-zà-ÿ'’. -]{3,60}\s\d{1,4}[a-zA-Z]?(?:\s?(?:bte|bus|boîte)\s?\d+)?[,\s]+\d{4}\s+[A-ZÀ-Ýa-zà-ÿ'’ -]{2,40})/;

function line(text: string, re: RegExp): string | null {
  const l = text.split(/\r?\n/).find((x) => re.test(x));
  return l ? l.trim() : null;
}

export function parseRequestEmail(subjectRaw: string, bodyRaw: string): ParsedRequest {
  const subject = subjectRaw.trim();
  const body = bodyRaw.replace(/\r/g, '');
  const all = `${subject}\n${body}`;
  const tickets = extractTicketNumbers(subject, body);
  const phone = all.match(PHONE)?.[0] ?? null;
  const email = body.match(EMAIL)?.[0] ?? null;
  const address = body.match(ADDRESS)?.[1]?.trim() ?? null;

  let warranty: 'yes' | 'no' | 'unknown' = 'unknown';
  const wLine = line(all, /garantie|garantie|waarborg|warranty/i);
  if (wLine) {
    if (/(hors|pas|plus|niet|geen|buiten|expir)/i.test(wLine)) warranty = 'no';
    else warranty = 'yes';
  }

  // Mots propres à chaque langue (« de », « douche » existent dans les deux : exclus).
  const nlWords = (all.match(/\b(het|een|niet|graag|klant|lekt|met|voor|van|is|zijn|geen|meer|onder)\b/gi) ?? []).length;
  const frWords = (all.match(/\b(le|la|les|une|pas|et|merci|fuite|du|des|sa|est|sous|il|elle)\b/gi) ?? []).length;

  const problemLines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !EMAIL.test(l) && !PHONE.test(l) && !/^(bonjour|beste|hallo|cordialement|met vriendelijke|merci|bedankt)/i.test(l));

  return {
    subject: { value: subject, source: subject || null, confident: true },
    tickets: { value: tickets, source: tickets.length ? (line(all, new RegExp(escape(tickets[0]!))) ?? null) : null, confident: tickets.length === 1 },
    phone: { value: phone, source: phone ? line(all, new RegExp(escape(phone))) : null, confident: phone !== null },
    email: { value: email, source: email ? line(body, new RegExp(escape(email))) : null, confident: email !== null },
    postalAddress: { value: address, source: address, confident: false },
    warranty: { value: warranty, source: wLine, confident: false },
    problem: { value: problemLines.slice(0, 3).join(' ').slice(0, 400), source: problemLines[0] ?? null, confident: false },
    language: { value: nlWords > frWords ? 'nl' : 'fr', source: null, confident: Math.abs(nlWords - frWords) > 2 },
  };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
