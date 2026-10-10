'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ACTION_STATUSES, DEAL_STATUSES, type ActionStatus } from '@/modules/crm/pipeline/types';
import { buildImport, type CrmSource, dedupeKey, type Mapping, TARGET_FIELDS, type TargetField } from '@/modules/crm/import/columns';
import { loadClient } from '../crm';
import { requireCtx } from '../context';
import { pgCode, withUser } from '../db';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const opt = (f: FormData, k: string) => str(f, k) || null;
const isDate = (s: string | null) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);

async function findOrCreateGroup(q: Parameters<Parameters<typeof withUser>[1]>[0], orgId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const found = await q<{ id: string }>(`select id from client_groups where lower(name) = lower($1)`, [name]);
  if (found.rows[0]) return found.rows[0].id;
  return (await q<{ id: string }>(`insert into client_groups (organization_id, name) values ($1, $2) returning id`, [orgId, name])).rows[0]!.id;
}

export async function createClient(formData: FormData) {
  const ctx = await requireCtx();
  const name = str(formData, 'name');
  if (!name) redirect('/clients/nouveau?erreur=1');
  const category = opt(formData, 'category');
  const id = await withUser(ctx.userId, async (q) => {
    const groupId = await findOrCreateGroup(q, ctx.orgId, opt(formData, 'group'));
    const client = (
      await q<{ id: string }>(
        `insert into clients (organization_id, group_id, name, address, postal_code, city, category, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [ctx.orgId, groupId, name, opt(formData, 'address'), opt(formData, 'postalCode'), opt(formData, 'city'), category && ['A', 'B', 'C'].includes(category) ? category : null, opt(formData, 'notes')],
      )
    ).rows[0]!.id;
    const contact = opt(formData, 'contact');
    if (contact || opt(formData, 'phone') || opt(formData, 'email')) {
      await q(`insert into contacts (organization_id, client_id, name, phone, email) values ($1, $2, $3, $4, $5)`, [
        ctx.orgId,
        client,
        contact ?? name,
        opt(formData, 'phone'),
        opt(formData, 'email'),
      ]);
    }
    return client;
  });
  revalidatePath('/clients');
  if (formData.get('another')) redirect('/clients/nouveau?ok=1');
  redirect(`/clients/${id}`);
}

export async function createDeal(formData: FormData) {
  const ctx = await requireCtx();
  const clientId = str(formData, 'clientId');
  const pipelineId = str(formData, 'pipelineId');
  const name = str(formData, 'name');
  try {
    await withUser(ctx.userId, (q) =>
      q(`insert into deals (organization_id, client_id, pipeline_id, name, opened_on) values ($1, $2, $3, $4, $5)`, [ctx.orgId, clientId, pipelineId, name, ctx.today]),
    );
  } catch (e) {
    redirect(`/clients/${clientId}?erreur=${pgCode(e) ?? 'x'}`);
  }
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

export async function closeDeal(formData: FormData) {
  const ctx = await requireCtx();
  const clientId = str(formData, 'clientId');
  const status = str(formData, 'status');
  if (!(DEAL_STATUSES as readonly string[]).includes(status)) redirect(`/clients/${clientId}?erreur=1`);
  await withUser(ctx.userId, (q) =>
    q(`update deals set status = $1, closed_on = case when $1 = 'open' then null else $2::date end where id = $3`, [status, ctx.today, str(formData, 'dealId')]),
  );
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

export async function addAction(formData: FormData) {
  const ctx = await requireCtx();
  const clientId = str(formData, 'clientId');
  // « dealId:stepId » ou vide (action libre).
  const [dealId, stepId] = (str(formData, 'target') || ':').split(':');
  const status = str(formData, 'status') as ActionStatus;
  const date = opt(formData, 'date');
  if (!ACTION_STATUSES.includes(status) || !isDate(date)) redirect(`/clients/${clientId}?erreur=1`);
  try {
    await withUser(ctx.userId, (q) =>
      q(
        `insert into actions (organization_id, client_id, deal_id, step_id, kind, status, due_date, note) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ctx.orgId, clientId, dealId || null, stepId || null, stepId ? 'step' : 'note', status, date, opt(formData, 'note')],
      ),
    );
  } catch (e) {
    redirect(`/clients/${clientId}?erreur=${pgCode(e) ?? 'x'}`);
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/');
  redirect(`/clients/${clientId}`);
}

export async function markActionDone(formData: FormData) {
  const ctx = await requireCtx();
  const back = str(formData, 'back') || '/';
  await withUser(ctx.userId, (q) => q(`update actions set status = 'done' where id = $1`, [str(formData, 'actionId')]));
  revalidatePath(back);
  revalidatePath('/');
  redirect(back);
}

// ── Import ─────────────────────────────────────────────────────────────

export interface ImportPreview {
  headers: string[];
  rows: string[][];
  mapping: Mapping;
  /** Clés des clients déjà présents, pour annoncer les doublons dès le bilan. */
  existing: string[];
  /** Export d'un CRM reconnu à ses en-têtes. */
  source?: CrmSource | null;
  error?: string;
}

/** Lit un fichier Excel ou CSV et propose la correspondance des colonnes. Rien n'est enregistré. */
export async function readImportFile(_: ImportPreview | null, formData: FormData): Promise<ImportPreview> {
  const ctx = await requireCtx();
  const file = formData.get('file');
  const empty: ImportPreview = { headers: [], rows: [], mapping: [], existing: [] };
  if (!(file instanceof File) || file.size === 0) return { ...empty, error: 'unreadable' };
  if (file.size > 5 * 1024 * 1024) return { ...empty, error: 'tooLarge' };
  const { detectSource, proposeMapping, parseCsv } = await import('@/modules/crm/import/columns');
  let table: string[][] = [];
  try {
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
      table = parseCsv(await file.text());
    } else if (/\.xlsx$/i.test(file.name)) {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      ws?.eachRow({ includeEmpty: false }, (row) => {
        const values = (row.values as unknown[]).slice(1).map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text);
          if (typeof v === 'object' && v && 'result' in v) return String((v as { result: unknown }).result ?? '');
          if (v instanceof Date) return v.toISOString().slice(0, 10);
          return String(v);
        });
        table.push(values);
      });
    } else {
      return { ...empty, error: 'unsupported' };
    }
  } catch {
    return { ...empty, error: 'unreadable' };
  }
  if (table.length < 2) return { ...empty, error: 'unreadable' };
  if (table.length > 5001) return { ...empty, error: 'tooLarge' };
  const [headers, ...rows] = table as [string[], ...string[][]];
  const existing = await withUser(ctx.userId, async (q) =>
    (await q<{ name: string; city: string | null }>(`select name, city from clients`)).rows.map((c) => dedupeKey(c.name, c.city ?? undefined)),
  );
  return { headers, rows, mapping: proposeMapping(headers), existing, source: detectSource(headers) };
}

function parseMapping(raw: string, width: number): Mapping {
  const arr = JSON.parse(raw) as unknown[];
  return Array.from({ length: width }, (_, i) => {
    const v = arr[i];
    return typeof v === 'string' && (TARGET_FIELDS as readonly string[]).includes(v) ? (v as TargetField) : null;
  });
}

/** Importe les lignes valides en une seule transaction ; renvoie vers la liste avec le nombre importé. */
export async function runImport(formData: FormData) {
  const ctx = await requireCtx();
  const rows = JSON.parse(String(formData.get('rows') ?? '[]')) as string[][];
  const mapping = parseMapping(String(formData.get('mapping') ?? '[]'), Math.max(0, ...rows.map((r) => r.length)));
  let imported = 0;
  await withUser(ctx.userId, async (q) => {
    const existing = await q<{ name: string; city: string | null }>(`select name, city from clients`);
    const report = buildImport(rows, mapping, new Set(existing.rows.map((c) => dedupeKey(c.name, c.city ?? undefined))));
    const created = new Map<number, string>(); // ligne du fichier → client créé
    for (const r of report.rows) {
      const v = r.values;
      if (r.extraContact && typeof r.duplicateOf === 'number' && created.has(r.duplicateOf)) {
        await q(`insert into contacts (organization_id, client_id, name, phone, email) values ($1, $2, $3, $4, $5)`, [
          ctx.orgId, created.get(r.duplicateOf), v.contact ?? v.name, v.phone ?? null, v.email ?? null,
        ]);
        continue;
      }
      if (r.issues.length || r.duplicateOf !== null) continue;
      const groupId = await findOrCreateGroup(q, ctx.orgId, v.group ?? null);
      const id = (
        await q<{ id: string }>(
          `insert into clients (organization_id, group_id, name, address, postal_code, city, category, notes) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [ctx.orgId, groupId, v.name, v.address ?? null, v.postalCode ?? null, v.city ?? null, v.category ?? null, v.notes ?? null],
        )
      ).rows[0]!.id;
      created.set(r.line, id);
      if (v.contact || v.phone || v.email) {
        await q(`insert into contacts (organization_id, client_id, name, phone, email) values ($1, $2, $3, $4, $5)`, [ctx.orgId, id, v.contact ?? v.name, v.phone ?? null, v.email ?? null]);
      }
      imported++;
    }
  });
  revalidatePath('/clients');
  redirect(`/clients?importes=${imported}`);
}

// ── Compte rendu dicté ───────────────────────────────────────────────

export interface ReportProposal {
  text: string;
  summary: string;
  step: { value: string; label: string; source: string | null } | null;
  tasks: { text: string; dueOn: string | null; source: string }[];
}

export async function prepareReport(_: ReportProposal | null, formData: FormData): Promise<ReportProposal | null> {
  const ctx = await requireCtx();
  const text = str(formData, 'text');
  if (!text) return null;
  const { structureReport } = await import('@/modules/crm/report/structure');
  const data = await withUser(ctx.userId, (q) => loadClient(q, str(formData, 'clientId'), ctx.today));
  if (!data) return null;
  // Étapes des affaires ouvertes, dans l'ordre ; la valeur garde l'affaire et l'étape.
  const options = data.dealViews
    .filter((d) => d.row.status === 'open')
    .flatMap((d) => d.pipeline.steps.map((s) => ({ id: `${d.row.id}:${s.id}`, code: s.code, label: `${s.label} (${d.row.name})` })));
  const r = structureReport(text, options, ctx.today);
  return {
    text,
    summary: r.summary,
    step: r.stepDone ? { value: r.stepDone.id, label: r.stepDone.label, source: r.stepSource } : null,
    tasks: r.tasks,
  };
}

/** Applique ce que l'utilisateur a coché, en une transaction. */
export async function applyReport(formData: FormData) {
  const ctx = await requireCtx();
  const clientId = str(formData, 'clientId');
  const text = str(formData, 'text');
  await withUser(ctx.userId, async (q) => {
    await q(`insert into actions (organization_id, client_id, kind, status, due_date, note) values ($1, $2, 'report', 'done', $3, $4)`, [
      ctx.orgId,
      clientId,
      ctx.today,
      text,
    ]);
    const step = str(formData, 'step');
    if (step) {
      const [dealId, stepId] = step.split(':');
      await q(`insert into actions (organization_id, client_id, deal_id, step_id, kind, status, due_date) values ($1, $2, $3, $4, 'step', 'done', $5)`, [
        ctx.orgId,
        clientId,
        dealId,
        stepId,
        ctx.today,
      ]);
      // L'utilisateur a validé que l'étape est faite : les actions encore ouvertes sur cette étape le sont aussi.
      await q(`update actions set status = 'done' where deal_id = $1 and step_id = $2 and status <> 'done'`, [dealId, stepId]);
    }
    const tasks = formData.getAll('task').map(String);
    const dues = formData.getAll('taskDue').map(String);
    const keep = new Set(formData.getAll('taskKeep').map(String));
    for (const [i, task] of tasks.entries()) {
      if (!keep.has(String(i)) || !task.trim()) continue;
      const due = dues[i] && isDate(dues[i]!) ? dues[i] : null;
      await q(`insert into actions (organization_id, client_id, kind, status, due_date, note) values ($1, $2, 'task', 'todo', $3, $4)`, [ctx.orgId, clientId, due, task.trim()]);
    }
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/');
  redirect(`/clients/${clientId}?ok=1`);
}
