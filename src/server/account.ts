import 'server-only';
import type { Q } from './db';
import { readStored } from './storage';
import { type TarEntry } from './tar';

/**
 * Export complet d'une entreprise (règle 10) : une table par fichier JSON, et tous les fichiers
 * (photos, signatures, logo, PDF figés). Toujours sous RLS et filtré sur l'entreprise demandée.
 */

// Tables du compte, dans un ordre lisible. Les colonnes secrètes ne sont jamais exportées.
const TABLES: [string, string][] = [
  ['entreprise', `select * from organizations where id = $1`],
  ['membres', `select m.user_id, m.role, m.created_at, p.email, p.full_name, p.language
               from organization_members m join profiles p on p.id = m.user_id where m.organization_id = $1`],
  ['reglages_membres', `select * from member_settings where organization_id = $1`],
  ['invitations', `select id, email, role, invited_by, expires_at, accepted_at, accepted_by, created_at from invitations where organization_id = $1`],
  ['groupes', `select * from client_groups where organization_id = $1`],
  ['clients', `select * from clients where organization_id = $1`],
  ['contacts', `select * from contacts where organization_id = $1`],
  ['parcours', `select * from pipelines where organization_id = $1`],
  ['etapes', `select * from pipeline_steps where organization_id = $1`],
  ['affaires', `select * from deals where organization_id = $1`],
  ['actions', `select * from actions where organization_id = $1`],
  ['types_intervention', `select * from intervention_types where organization_id = $1`],
  ['donneurs_ordre', `select * from principals where organization_id = $1`],
  ['adresses_donneurs_ordre', `select * from principal_addresses where organization_id = $1`],
  ['dossiers', `select * from service_cases where organization_id = $1`],
  ['tickets', `select * from case_references where organization_id = $1`],
  ['passages', `select * from service_visits where organization_id = $1`],
  ['heures', `select * from visit_workers where organization_id = $1`],
  ['photos', `select * from visit_media where organization_id = $1`],
  ['pieces', `select * from part_needs where organization_id = $1`],
  ['commandes', `select * from part_orders where organization_id = $1`],
  ['receptions', `select * from part_receipts where organization_id = $1`],
  ['rapports', `select * from report_versions where organization_id = $1`],
  ['envois', `select * from outbound_messages where organization_id = $1`],
  ['emails_recus', `select * from inbound_messages where organization_id = $1`],
];

const README = `Export complet des données de votre entreprise
=============================================
donnees/   une table par fichier (JSON, UTF-8) : clients, contacts, affaires, actions, dossiers,
           passages, heures, pièces, rapports, envois, emails reçus, réglages, membres…
fichiers/  photos, signatures, logo et PDF des rapports, sous le nom indiqué dans les tables
           (colonnes storage_path, signature_path, pdf_path, client_pdf_path, logo_path).
Les montants sont en centimes, les durées en minutes, les dates au format ISO.

Volledige export van de gegevens van uw bedrijf
===============================================
donnees/   één tabel per bestand (JSON, UTF-8).
fichiers/  foto's, handtekeningen, logo en pdf's van de rapporten, onder de naam uit de tabellen.
Bedragen in cent, duur in minuten, datums in ISO-formaat.
`;

export async function buildExport(q: Q, orgId: string): Promise<{ entries: TarEntry[]; missing: string[] }> {
  const entries: TarEntry[] = [{ name: 'LISEZMOI.txt', data: Buffer.from(README) }];
  const paths = new Set<string>();
  for (const [name, sql] of TABLES) {
    const rows = (await q(sql, [orgId])).rows;
    entries.push({ name: `donnees/${name}.json`, data: Buffer.from(JSON.stringify(rows, null, 2)) });
    for (const r of rows) {
      for (const k of ['storage_path', 'signature_path', 'pdf_path', 'client_pdf_path', 'logo_path']) {
        const v = (r as Record<string, unknown>)[k];
        if (typeof v === 'string' && v) paths.add(v);
      }
    }
  }
  const missing: string[] = [];
  for (const p of [...paths].sort()) {
    try {
      entries.push({ name: `fichiers/${p}`, data: await readStored(p) });
    } catch {
      missing.push(p);
    }
  }
  if (missing.length) entries.push({ name: 'fichiers-manquants.txt', data: Buffer.from(missing.join('\n')) });
  return { entries, missing };
}
