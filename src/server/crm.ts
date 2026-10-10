import 'server-only';
import { buildActionBuckets } from '@/modules/crm/actions/buckets';
import { dueFollowUps, type FollowUpDue } from '@/modules/crm/followups';
import { clientProgress, computeStepStates, dealProgress, isActionOpen } from '@/modules/crm/pipeline/engine';
import type { Action, ActionStatus, Deal, DealStatus, Pipeline, ProgressStatus, StepState } from '@/modules/crm/pipeline/types';
import type { Q } from './db';

/** Lecture des données commerciales et calculs (toujours via le moteur ; rien n'est stocké). */

export interface StepRow {
  id: string;
  code: string;
  label: string;
  short_label: string | null;
  position: number;
}
export interface PipelineRow {
  id: string;
  code: string;
  name: string;
  group_id: string | null;
  implied_by_default: string[];
  steps: StepRow[];
}
export interface ActionRow {
  id: string;
  client_id: string;
  deal_id: string | null;
  step_id: string | null;
  kind: string;
  status: ActionStatus;
  due_date: string | null;
  note: string | null;
  created_at: string;
  client_name?: string;
  step_label?: string | null;
}
export interface DealRow {
  id: string;
  client_id: string;
  pipeline_id: string;
  name: string;
  status: DealStatus;
  opened_on: string;
}

export async function loadPipelines(q: Q): Promise<PipelineRow[]> {
  const { rows } = await q<PipelineRow>(
    `select p.id, p.code, p.name, p.group_id, p.implied_by_default,
            coalesce(json_agg(json_build_object('id', s.id, 'code', s.code, 'label', s.label, 'short_label', s.short_label, 'position', s.position)
                     order by s.position) filter (where s.id is not null and s.archived_at is null), '[]') as steps
     from pipelines p left join pipeline_steps s on s.pipeline_id = p.id
     where p.archived_at is null
     group by p.id order by p.position, p.name`,
  );
  return rows;
}

export function toPipeline(p: PipelineRow): Pipeline {
  return {
    id: p.id,
    code: p.code,
    steps: p.steps.map((s) => ({ id: s.id, code: s.code, order: s.position })),
    impliedByDefault: p.implied_by_default,
  };
}

const toAction = (a: ActionRow): Action => ({ id: a.id, stepId: a.step_id, status: a.status, date: a.due_date });

export interface DealView {
  row: DealRow;
  pipeline: PipelineRow;
  deal: Deal;
  states: StepState[];
  progress: ProgressStatus;
  /** Index (base 0) de l'étape la plus avancée faite ou déduite, -1 si aucune. */
  reached: number;
}

export function dealView(row: DealRow, pipeline: PipelineRow, actions: ActionRow[], today: string): DealView {
  const deal: Deal = { id: row.id, pipeline: toPipeline(pipeline), status: row.status, actions: actions.filter((a) => a.deal_id === row.id).map(toAction) };
  const states = computeStepStates(deal.pipeline, deal.actions);
  let reached = -1;
  states.forEach((s, i) => {
    if (s === 'done' || s === 'implied') reached = i;
  });
  return { row, pipeline, deal, states, progress: dealProgress(deal, today), reached };
}

/** Tout ce qu'il faut pour les écrans du jour et la liste des clients : 4 requêtes, calcul en mémoire. */
export async function loadPortfolio(q: Q, today: string) {
  const [pipelines, deals, actions, clients] = await Promise.all([
    loadPipelines(q),
    q<DealRow>(`select id, client_id, pipeline_id, name, status, opened_on::text from deals`).then((r) => r.rows),
    q<ActionRow>(
      `select a.id, a.client_id, a.deal_id, a.step_id, a.kind, a.status, a.due_date::text, a.note, a.created_at::text,
              c.name as client_name, s.label as step_label
       from actions a join clients c on c.id = a.client_id left join pipeline_steps s on s.id = a.step_id`,
    ).then((r) => r.rows),
    q<{ id: string; name: string; city: string | null; category: 'A' | 'B' | 'C' | null; group_id: string | null; group_name: string | null; created_on: string }>(
      `select c.id, c.name, c.city, c.category, c.group_id, g.name as group_name, c.created_at::date::text as created_on
       from clients c left join client_groups g on g.id = c.group_id
       where not exists (select 1 from service_cases sc where sc.client_id = c.id) or exists (select 1 from deals d where d.client_id = c.id)
       order by c.name`,
    ).then((r) => r.rows),
  ]);
  const pipelineById = new Map(pipelines.map((p) => [p.id, p]));
  const dealViews = deals.filter((d) => pipelineById.has(d.pipeline_id)).map((d) => dealView(d, pipelineById.get(d.pipeline_id)!, actions, today));
  const dealViewById = new Map(dealViews.map((d) => [d.row.id, d]));

  const isOpen = (a: ActionRow) => {
    const dv = a.deal_id ? dealViewById.get(a.deal_id) : undefined;
    return isActionOpen(toAction(a), dv ? dv.deal.pipeline : null, dv ? dv.deal.actions : []);
  };

  const clientStatus = new Map<string, ProgressStatus>();
  for (const c of clients) {
    const cd = dealViews.filter((d) => d.row.client_id === c.id).map((d) => d.deal);
    const loose = actions.filter((a) => a.client_id === c.id && !a.deal_id).map(toAction);
    clientStatus.set(c.id, clientProgress(cd, loose, today));
  }

  const lastVisit = new Map<string, string>();
  for (const a of actions) {
    if (a.status === 'done' && a.due_date && a.due_date <= today && (!lastVisit.get(a.client_id) || lastVisit.get(a.client_id)! < a.due_date)) {
      lastVisit.set(a.client_id, a.due_date);
    }
  }
  const followUps: FollowUpDue[] = dueFollowUps(
    clients.map((c) => ({ id: c.id, category: c.category, lastVisit: lastVisit.get(c.id) ?? null, createdOn: c.created_on })),
    today,
  );

  const buckets = buildActionBuckets(
    actions.map((a) => ({ ...toAction(a), row: a })),
    today,
    (x) => !isOpen(x.row),
  );

  return { pipelines, dealViews, actions, clients, clientStatus, followUps, buckets, lastVisit };
}

export async function loadClient(q: Q, clientId: string, today: string) {
  const client = (
    await q<{
      id: string; name: string; address: string | null; postal_code: string | null; city: string | null; category: string | null;
      notes: string | null; group_id: string | null; group_name: string | null;
    }>(
      `select c.id, c.name, c.address, c.postal_code, c.city, c.category, c.notes, c.group_id, g.name as group_name
       from clients c left join client_groups g on g.id = c.group_id where c.id = $1`,
      [clientId],
    )
  ).rows[0];
  if (!client) return null;
  const [pipelines, deals, actions, contacts] = await Promise.all([
    loadPipelines(q),
    q<DealRow>(`select id, client_id, pipeline_id, name, status, opened_on::text from deals where client_id = $1 order by opened_on desc, name`, [clientId]).then((r) => r.rows),
    q<ActionRow>(
      `select a.id, a.client_id, a.deal_id, a.step_id, a.kind, a.status, a.due_date::text, a.note, a.created_at::text, s.label as step_label
       from actions a left join pipeline_steps s on s.id = a.step_id where a.client_id = $1
       order by coalesce(a.due_date, a.created_at::date) desc, a.created_at desc`,
      [clientId],
    ).then((r) => r.rows),
    q<{ id: string; name: string; job_title: string | null; email: string | null; phone: string | null }>(
      `select id, name, job_title, email, phone from contacts where client_id = $1 order by name`,
      [clientId],
    ).then((r) => r.rows),
  ]);
  const pipelineById = new Map(pipelines.map((p) => [p.id, p]));
  const dealViews = deals.filter((d) => pipelineById.has(d.pipeline_id)).map((d) => dealView(d, pipelineById.get(d.pipeline_id)!, actions, today));
  // Pipelines proposés pour une nouvelle affaire : communs ou du groupe du client (P04).
  const available = pipelines.filter((p) => p.group_id === null || p.group_id === client.group_id);
  return { client, dealViews, actions, contacts, available };
}
