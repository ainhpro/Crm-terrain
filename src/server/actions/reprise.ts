'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { migratePrototypeBackup } from '@/modules/crm/import/prototype-backup';
import { planPrototypeImport, type ReprisePlan } from '@/modules/crm/import/prototype-plan';
import { requireCtx } from '../context';
import { type Q, withUser } from '../db';

/**
 * Reprise de l'ancien CRM : la sauvegarde (bouton BACKUP, format {"entries": [...]}) est collée ou
 * choisie en fichier, un bilan est montré, puis tout est créé en une transaction. Chaque entrée garde
 * son identifiant d'origine : réimporter la même sauvegarde n'ajoute rien en double.
 * Réservé au propriétaire (la reprise installe des parcours, règle S01).
 */

const MAX_BYTES = 5 * 1024 * 1024;

export interface ReprisePreview {
  error?: 'owner' | 'empty' | 'json' | 'format' | 'tooLarge';
  json?: string;
  entries?: number;
  clients?: number;
  deals?: number;
  pipelines?: string[];
  byGroup?: Record<string, number>;
  issues?: { id: number; label: string; problems: string[] }[];
  withIssues?: number;
}

async function readBackup(formData: FormData): Promise<{ text: string } | { error: ReprisePreview['error'] }> {
  const file = formData.get('file');
  let text = String(formData.get('backup') ?? '').trim();
  if (!text && file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { error: 'tooLarge' };
    text = (await file.text()).trim();
  }
  if (!text) return { error: 'empty' };
  if (text.length > MAX_BYTES) return { error: 'tooLarge' };
  return { text };
}

function parse(text: string): ReprisePlan | ReprisePreview['error'] {
  let json: unknown;
  try {
    // Les Notes d'iPhone peuvent remplacer les guillemets droits : on les rétablit.
    json = JSON.parse(text.replace(/[“”]/g, '"'));
  } catch {
    return 'json';
  }
  try {
    return planPrototypeImport(migratePrototypeBackup(json));
  } catch {
    return 'format';
  }
}

export async function previewReprise(_: ReprisePreview | null, formData: FormData): Promise<ReprisePreview> {
  const ctx = await requireCtx();
  if (ctx.role !== 'owner') return { error: 'owner' };
  const read = await readBackup(formData);
  if ('error' in read) return { error: read.error };
  const plan = parse(read.text);
  if (typeof plan === 'string' || !plan) return { error: plan ?? 'format' };
  if (!plan.actions.length) return { error: 'empty' };
  return {
    json: read.text,
    entries: plan.actions.length,
    clients: plan.clients.length,
    deals: plan.deals.length,
    pipelines: plan.pipelines.map((p) => p.label[ctx.locale === 'nl' ? 'nl' : 'fr']),
    byGroup: plan.byGroup,
    withIssues: plan.withIssues,
    issues: plan.actions.filter((a) => a.issues.length).slice(0, 50).map((a) => ({ id: a.legacyId, label: `${a.groupCode} ${a.siteName} · ${a.legacyType}`, problems: a.issues })),
  };
}

export async function runReprise(formData: FormData) {
  const ctx = await requireCtx();
  if (ctx.role !== 'owner') redirect('/clients/reprise?erreur=owner');
  const plan = parse(String(formData.get('json') ?? ''));
  if (typeof plan === 'string' || !plan) redirect('/clients/reprise?erreur=format');
  const lang = ctx.locale === 'nl' ? 'nl' : 'fr';
  const { created, skipped } = await withUser(ctx.userId, (q) => apply(q, ctx.orgId, plan, lang));
  revalidatePath('/clients');
  revalidatePath('/');
  redirect(`/clients?repris=${created}&ignores=${skipped}`);
}

async function apply(q: Q, orgId: string, plan: ReprisePlan, lang: 'fr' | 'nl'): Promise<{ created: number; skipped: number }> {
  const groupId = new Map<string, string>();
  for (const g of plan.groups) {
    const found = (await q<{ id: string }>(`select id from client_groups where lower(name) = lower($1)`, [g.name])).rows[0];
    groupId.set(g.code, found?.id ?? (await q<{ id: string }>(
      `insert into client_groups (organization_id, name, color) values ($1, $2, $3) returning id`, [orgId, g.name, g.color],
    )).rows[0]!.id);
  }

  const pipelineId = new Map<string, string>();
  const stepId = new Map<string, string>(); // « PIPELINE|code » → étape
  for (const p of plan.pipelines) {
    let id = (await q<{ id: string }>(`select id from pipelines where code = $1`, [p.code])).rows[0]?.id;
    if (!id) {
      id = (await q<{ id: string }>(
        `insert into pipelines (organization_id, code, name, position, group_id, implied_by_default)
         values ($1, $2, $3, (select coalesce(max(position), 0) + 1 from pipelines), $4, $5) returning id`,
        [orgId, p.code, p.label[lang], p.groupCode ? groupId.get(p.groupCode) ?? null : null, p.impliedByDefault ?? []],
      )).rows[0]!.id;
      for (const [i, s] of p.steps.entries()) {
        await q(`insert into pipeline_steps (organization_id, pipeline_id, code, label, short_label, position) values ($1, $2, $3, $4, $5, $6)`, [
          orgId, id, s.code, s.label[lang], s.short[lang], i,
        ]);
      }
    }
    pipelineId.set(p.code, id);
    for (const s of (await q<{ id: string; code: string }>(`select id, code from pipeline_steps where pipeline_id = $1`, [id])).rows) {
      stepId.set(`${p.code}|${s.code}`, s.id);
    }
  }

  const clientId = new Map<string, string>();
  for (const c of plan.clients) {
    const gid = groupId.get(c.groupCode) ?? null;
    const found = (await q<{ id: string }>(`select id from clients where lower(name) = lower($1) and group_id is not distinct from $2`, [c.name, gid])).rows[0];
    clientId.set(c.key, found?.id ?? (await q<{ id: string }>(
      `insert into clients (organization_id, group_id, name, city) values ($1, $2, $3, $4) returning id`, [orgId, gid, c.name, c.city],
    )).rows[0]!.id);
  }

  const dealId = new Map<string, string>();
  for (const d of plan.deals) {
    const cid = clientId.get(d.clientKey)!;
    const pid = pipelineId.get(d.pipelineCode)!;
    const label = plan.pipelines.find((p) => p.code === d.pipelineCode)!.label[lang];
    const found = (await q<{ id: string }>(`select id from deals where client_id = $1 and pipeline_id = $2 and status = 'open' order by opened_on limit 1`, [cid, pid])).rows[0];
    dealId.set(`${d.clientKey}|${d.pipelineCode}`, found?.id ?? (await q<{ id: string }>(
      `insert into deals (organization_id, client_id, pipeline_id, name) values ($1, $2, $3, $4) returning id`, [orgId, cid, pid, label],
    )).rows[0]!.id);
  }

  let created = 0;
  for (const a of plan.actions) {
    const step = a.pipelineCode && a.stepCode ? stepId.get(`${a.pipelineCode}|${a.stepCode}`) ?? null : null;
    const deal = step ? dealId.get(`${a.clientKey}|${a.pipelineCode}`) ?? null : null;
    // Une entrée sans étape reconnue reste une note, avec son libellé d'origine.
    const note = step ? a.note || null : [a.legacyType, a.note].filter(Boolean).join(' — ') || null;
    const r = await q(
      `insert into actions (organization_id, client_id, deal_id, step_id, kind, status, due_date, note, legacy_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (organization_id, legacy_id) where legacy_id is not null do nothing`,
      [orgId, clientId.get(a.clientKey), deal, step, step ? 'step' : 'note', a.status, a.date, note, a.legacyId],
    );
    created += r.rowCount ?? 0;
  }
  return { created, skipped: plan.actions.length - created };
}
