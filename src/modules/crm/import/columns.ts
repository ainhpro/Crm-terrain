/**
 * Import d'un fichier clients : reconnaissance des colonnes (version locale, sans IA),
 * normalisation, bilan complet des anomalies et doublons (E04). Rien n'est enregistré ici.
 */

export const TARGET_FIELDS = [
  'name', 'group', 'address', 'streetNumber', 'postalCode', 'city', 'contact', 'firstName', 'lastName', 'phone', 'email', 'category', 'notes',
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

/**
 * En-têtes reconnus (FR, NL, EN), comparés sans accents ni casse, y compris ceux des exports
 * des CRM courants (Teamleader, Pipedrive, HubSpot, Odoo, Salesforce, Zoho, Sellsy, Axonaut).
 * Premier passage : en-tête identique à un synonyme. Second passage (champs `fuzzy`) : le synonyme
 * apparaît en mots entiers dans l'en-tête (« Billing City », « Person - Email - Work »).
 */
const SYNONYMS: Record<TargetField, string[]> = {
  name: [
    'nom', 'client', 'magasin', 'showroom', 'societe', 'entreprise', 'raison sociale', 'naam', 'klant', 'winkel', 'bedrijf', 'name', 'company', 'site',
    'nom de la societe', 'nom de l entreprise', 'nom du client', 'nom d affichage', 'bedrijfsnaam', 'klantnaam', 'organisatie', 'organisation',
    'company name', 'account name', 'organization name', 'organisation name', 'organization', 'display name', 'account', 'customer', 'customer name',
  ],
  group: ['groupe', 'enseigne', 'chaine', 'reseau', 'groep', 'keten', 'group', 'brand', 'client groupe', 'parent account', 'societe mere', 'moederbedrijf'],
  address: [
    'adresse', 'adres', 'rue', 'straat', 'address', 'street', 'adresse ligne 1', 'address line 1', 'street address', 'billing street', 'rue 1', 'straat 1',
    'organization address', 'primary address', 'adresse principale',
  ],
  streetNumber: ['numero', 'n', 'no', 'nr', 'huisnummer', 'house number', 'street number', 'numero de rue'],
  postalCode: ['code postal', 'cp', 'postcode', 'postal code', 'zip', 'zip code', 'npa', 'billing zip postal code', 'billing postal code'],
  city: ['ville', 'localite', 'commune', 'gemeente', 'stad', 'plaats', 'city', 'town', 'billing city', 'woonplaats'],
  contact: [
    'contact', 'responsable', 'personne de contact', 'contactpersoon', 'verantwoordelijke', 'contact person', 'contact name', 'person name',
    'full name', 'nom du contact', 'nom complet', 'volledige naam', 'person', 'primary contact', 'contact principal',
  ],
  firstName: ['prenom', 'voornaam', 'first name', 'firstname', 'given name', 'prenom du contact', 'contact first name', 'person first name'],
  lastName: ['nom de famille', 'achternaam', 'familienaam', 'last name', 'lastname', 'surname', 'family name', 'contact last name', 'person last name'],
  phone: ['telephone', 'tel', 'gsm', 'portable', 'telefoon', 'phone', 'mobile', 'phone number', 'telefoonnummer', 'mobiel', 'mobile phone', 'work phone'],
  email: ['email', 'e mail', 'mail', 'courriel', 'email address', 'adresse email', 'e mailadres', 'primary email', 'work email'],
  category: ['categorie', 'cat', 'classe', 'abc', 'categorie abc', 'klasse', 'category'],
  notes: ['notes', 'note', 'remarque', 'remarques', 'commentaire', 'opmerking', 'opmerkingen', 'notities', 'comment', 'comments', 'description', 'beschrijving'],
};

// Champs acceptés au second passage (mots entiers). Le numéro de rue n'y est pas : « Numéro de TVA » n'est pas un numéro de rue.
const FUZZY: TargetField[] = ['name', 'address', 'postalCode', 'city', 'phone', 'email', 'firstName', 'lastName', 'notes'];

// En-têtes jamais associés au second passage, même s'ils contiennent un mot reconnu.
const NEVER = ['tva', 'btw', 'vat', 'ondernemingsnummer', 'numero d entreprise', 'id', 'owner', 'proprietaire', 'eigenaar', 'domain', 'website', 'site web', 'pays', 'country', 'land'];

export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[°'’]/g, ' ')
    .replace(/[_.\-/:()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Mapping = (TargetField | null)[];

const hasWords = (header: string, words: string) => ` ${header} `.includes(` ${words} `);

/** Propose un champ pour chaque colonne ; une colonne inconnue reste ignorée (null). Un champ n'est pris qu'une fois. */
export function proposeMapping(headers: string[]): Mapping {
  const used = new Set<TargetField>();
  const norm = headers.map(normalizeHeader);
  const out: Mapping = norm.map(() => null);
  // 1. Correspondances exactes, prioritaires (« First Name » ne doit pas devenir le nom du client).
  norm.forEach((n, i) => {
    if (!n) return;
    const field = TARGET_FIELDS.find((f) => !used.has(f) && SYNONYMS[f].includes(n));
    if (field) {
      used.add(field);
      out[i] = field;
    }
  });
  // 2. Mots entiers, pour les en-têtes composés des exports de CRM.
  norm.forEach((n, i) => {
    if (!n || out[i] || NEVER.some((w) => hasWords(n, w))) return;
    // Le synonyme le plus long l'emporte : « ZIP/Postal code of Address » est un code postal, pas une adresse.
    let field: TargetField | null = null;
    let best = 0;
    for (const f of FUZZY) {
      if (used.has(f)) continue;
      for (const s of SYNONYMS[f]) {
        if (s.length > 2 && s.length > best && hasWords(n, s)) {
          field = f;
          best = s.length;
        }
      }
    }
    if (field) {
      used.add(field);
      out[i] = field;
    }
  });
  return out;
}

export type CrmSource = 'pipedrive' | 'hubspot' | 'salesforce' | 'odoo' | 'teamleader' | 'zoho';

/** Noms de marque, identiques dans toutes les langues. */
export const CRM_SOURCE_NAMES: Record<CrmSource, string> = {
  pipedrive: 'Pipedrive', hubspot: 'HubSpot', salesforce: 'Salesforce', odoo: 'Odoo', teamleader: 'Teamleader', zoho: 'Zoho',
};

/** Reconnaît l'export d'un CRM courant à ses en-têtes (indication affichée ; la correspondance reste vérifiable). */
export function detectSource(headers: string[]): CrmSource | null {
  const n = headers.map(normalizeHeader);
  const has = (...hs: string[]) => hs.some((h) => n.includes(h));
  if (n.some((h) => /^(organization|organisation|person|deal) /.test(h))) return 'pipedrive';
  if (has('record id', 'company domain name', 'associated company', 'hubspot owner', 'lifecycle stage')) return 'hubspot';
  if (has('account name', 'account owner') && n.some((h) => h.startsWith('billing '))) return n.includes('account owner') && has('account site') ? 'zoho' : 'salesforce';
  if (has('is a company', 'est une societe', 'is een bedrijf', 'nom d affichage', 'display name')) return 'odoo';
  if (has('ondernemingsnummer', 'numero d entreprise') && has('bedrijfsnaam', 'naam', 'nom de l entreprise', 'nom')) return 'teamleader';
  return null;
}

export interface ImportRow {
  line: number; // numéro de ligne dans le fichier (1 = en-tête)
  values: Partial<Record<TargetField, string>>;
  issues: string[];
  duplicateOf: number | 'existing' | null;
  /**
   * Même client qu'une ligne précédente, mais avec une autre personne de contact (export « personnes »
   * d'un CRM : une ligne par contact) : la personne est ajoutée au client de cette ligne.
   */
  extraContact: boolean;
}

export interface ImportReport {
  rows: ImportRow[];
  valid: number;
  withIssues: number;
  duplicates: number;
  extraContacts: number;
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
  const peopleByClient = new Map<string, Set<string>>();
  const out: ImportRow[] = [];
  let empty = 0;
  rows.forEach((cells, i) => {
    const line = i + 2;
    const values: Partial<Record<TargetField, string>> = {};
    mapping.forEach((field, c) => {
      const v = (cells[c] ?? '').toString().trim();
      if (field && v) values[field] = v;
    });
    // Champs d'appoint fusionnés : prénom + nom → contact, numéro → adresse.
    const person = [values.firstName, values.lastName].filter(Boolean).join(' ');
    if (person && !values.contact) values.contact = person;
    if (values.streetNumber) values.address = values.address ? `${values.address} ${values.streetNumber}` : undefined;
    delete values.firstName;
    delete values.lastName;
    delete values.streetNumber;
    if (!values.address) delete values.address;
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
    // Personne déjà vue pour ce client (première ligne ou contact ajouté) : vrai doublon.
    const who = [values.contact, values.email, values.phone].map((x) => normalizeHeader(x ?? '')).join('|');
    let extraContact = false;
    if (values.name && issues.length === 0 && (values.contact || values.email || values.phone)) {
      const key = dedupeKey(values.name, values.city);
      const people = peopleByClient.get(key) ?? new Set<string>();
      extraContact = typeof duplicateOf === 'number' && !people.has(who);
      people.add(who);
      peopleByClient.set(key, people);
    }
    out.push({ line, values, issues, duplicateOf, extraContact });
  });
  return {
    rows: out,
    valid: out.filter((r) => r.issues.length === 0 && r.duplicateOf === null).length,
    withIssues: out.filter((r) => r.issues.length > 0).length,
    duplicates: out.filter((r) => r.duplicateOf !== null && !r.extraContact).length,
    extraContacts: out.filter((r) => r.extraContact).length,
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
