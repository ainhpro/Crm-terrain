import { INDA_GROUPS, INDA_PIPELINES } from '../templates/inda';
import type { GroupTemplate, PipelineTemplate } from '../templates/types';
import type { MigratedAction } from './prototype-backup';

/**
 * Plan de reprise de l'ancien CRM : ce qui sera créé (groupes, parcours, clients, affaires,
 * actions), calculé avant tout enregistrement pour être montré à l'utilisateur.
 * Les parcours et groupes viennent du modèle de l'ancien CRM (templates/inda.ts) ; un groupe
 * inconnu est créé sans parcours, et ses actions deviennent des notes.
 */

export interface PlannedClient {
  key: string;
  name: string;
  city: string | null;
  groupCode: string;
}

export interface ReprisePlan {
  groups: GroupTemplate[];
  pipelines: PipelineTemplate[];
  clients: PlannedClient[];
  deals: { clientKey: string; pipelineCode: string }[];
  actions: (MigratedAction & { clientKey: string })[];
  withIssues: number;
  byGroup: Record<string, number>;
}

/** Nom du client : « FACQ Geel » pour un groupe à magasins, le nom du magasin seul sinon (comme l'ancien CRM). */
export function legacyClientName(groupCode: string, site: string): { name: string; city: string | null } {
  const s = site.trim();
  return groupCode === 'SAMO' ? { name: s, city: null } : { name: `${groupCode} ${s}`.trim(), city: s || null };
}

export function planPrototypeImport(actions: MigratedAction[]): ReprisePlan {
  const clients = new Map<string, PlannedClient>();
  const deals = new Map<string, { clientKey: string; pipelineCode: string }>();
  const groupCodes = new Set<string>();
  const pipelineCodes = new Set<string>();
  const byGroup: Record<string, number> = {};
  const planned = actions
    .filter((a) => a.groupCode && a.siteName)
    .map((a) => {
      const { name, city } = legacyClientName(a.groupCode, a.siteName);
      const key = `${a.groupCode}|${name.toLowerCase()}`;
      if (!clients.has(key)) clients.set(key, { key, name, city, groupCode: a.groupCode });
      groupCodes.add(a.groupCode);
      byGroup[a.groupCode] = (byGroup[a.groupCode] ?? 0) + 1;
      if (a.pipelineCode) {
        pipelineCodes.add(a.pipelineCode);
        deals.set(`${key}|${a.pipelineCode}`, { clientKey: key, pipelineCode: a.pipelineCode });
      }
      return { ...a, clientKey: key };
    });
  return {
    groups: [...groupCodes].map((code) => INDA_GROUPS.find((g) => g.code === code) ?? { code, name: code, color: '#667085', sites: [] }),
    pipelines: INDA_PIPELINES.filter((p) => pipelineCodes.has(p.code)),
    clients: [...clients.values()],
    deals: [...deals.values()],
    actions: planned,
    withIssues: planned.filter((a) => a.issues.length > 0).length,
    byGroup,
  };
}
