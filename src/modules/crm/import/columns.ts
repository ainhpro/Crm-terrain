/**
 * Import d'un fichier clients : reconnaissance des colonnes (version locale, sans IA),
 * normalisation, bilan complet des anomalies et doublons (E04). Rien n'est enregistré ici.
 */

export const TARGET_FIELDS = ['name', 'group', 'address', 'postalCode', 'city', 'contact', 'phone', 'email', 'category', 'notes'] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

// En-têtes reconnus (FR, NL, EN), comparés sans accents ni casse.
const SYNONYMS: Record<TargetField, string[]> = {
  name: ['nom', 'client', 'magasin', 'showroom', 'societe', 'entreprise', 'raison sociale', 'naam', 'klant', 'winkel', 'bedrijf', 'name', 'company', 'site'],
  group: ['groupe', 'enseigne', 'chaine', 'reseau', 'groep', 'keten', 'group', 'brand', 'client groupe'],
  address: ['adresse', 'adres', 'rue', 'straat', 'address', 'street'],
  postalCode: ['code postal', 'cp', 'postcode', 'postal code', 'zip'],
  city: ['ville', 'localite', 'commune', 'gemeente', 'stad', 'plaats', 'city', 'town'],
  contact: ['contact', 'responsable', 'personne de contact', 'contactpersoon', 'verantwoordelijke', 'contact person'],
  phone: ['telephone', 'tel', 'gsm', 'portable', 'telefoon', 'phone', 'mobile'],
  email: ['email', 'e-mail', 'mail', 'courriel'],
  category: ['categorie', 'cat', 'classe', 'abc', 'categorie abc', 'klasse', 'category'],
  notes: ['notes', 'remarque', 'remarques', 'commentaire', 'opmerking', 'opmerkingen', 'notities', 'comment'],
};

export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_.\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Mapping = (TargetField | null)[];

/** Propose un champ pour chaque colonne ; une colonne inconnue reste ignorée (null). Un champ n'est pris qu'une fois. */
export function proposeMapping(headers: string[]): Mapping {
  const used = new Set<TargetField>();
  return headers.map((h) => {
    const n = normalizeHeader(h);
    if (!n) return null;
    for (const field of TARGET_FIELDS) {
      if (used.has(field)) continue;
      if (SYNONYMS[field].some((s) => n === s || n.startsWith(`${s} `) || n.endsWith(` ${s}`))) {
        used.add(field);
        return field;
      }
    }
    return null;
  });
}

export interface ImportRow {
  line: number; // numéro de ligne dans le fichier (1 = en-tête)
  values: Partial<Record<TargetField, string>>;
  issues: string[];
  duplicateOf: number | 'existing' | null;
}

export interface ImportReport {
  rows: ImportRow[];
  valid: number;
  withIssues: number;
  duplicates: number;
  empty: number;
}

const MAX_ROWS = 5000;

export function dedupeKey(name: string, city?: string): string {
  return `${normalizeHeader(name)}|${normalizeHeader(city ?? '')}`;
}

/**
 * Applique la correspondance à toutes les lignes (pas seulement aux 10 premières) et dresse le bilan.
 * `existingKeys` : clés des clients déjà présents dans le compte.
 */
export function buildImport(rows: string[][], mapping: Mapping, existingKeys: Set<string> = new Set()): ImportReport {
  if (rows.length > MAX_ROWS) throw new Error(`Fichier trop volumineux : ${rows.length} lignes (maximum ${MAX_ROWS}).`);
  if (!mapping.includes('name')) throw new Error('Aucune colonne ne correspond au nom du client.');
  const seen = new Map<string, number>();
  const out: ImportRow[] = [];
  let empty = 0;
  rows.forEach((cells, i) => {
    const line = i + 2;
    const values: Partial<Record<TargetField, string>> = {};
    mapping.forEach((field, c) => {
      const v = (cells[c] ?? '').toString().trim();
      if (field && v) values[field] = v;
    });
    if (Object.keys(values).length === 0) {
      empty++;
      return;
    }
    const issues: string[] = [];
    if (!values.name) issues.push('nom manquant');
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) issues.push('email invalide');
    if (values.category) {
      const c = values.category.toUpperCase();
      if (['A', 'B', 'C'].includes(c)) values.category = c;
      else issues.push('catégorie différente de A, B ou C');
    }
    let duplicateOf: ImportRow['duplicateOf'] = null;
    if (values.name) {
      const key = dedupeKey(values.name, values.city);
      if (existingKeys.has(key)) duplicateOf = 'existing';
      else if (seen.has(key)) duplicateOf = seen.get(key)!;
      else seen.set(key, line);
    }
    out.push({ line, values, issues, duplicateOf });
  });
  return {
    rows: out,
    valid: out.filter((r) => r.issues.length === 0 && r.duplicateOf === null).length,
    withIssues: out.filter((r) => r.issues.length > 0).length,
    duplicates: out.filter((r) => r.duplicateOf !== null).length,
    empty,
  };
}

/** Lit un CSV (séparateur « ; » ou « , » détecté, guillemets gérés). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g) ?? []).length >= (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}
