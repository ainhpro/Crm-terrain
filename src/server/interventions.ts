import 'server-only';
import { needStatus, type NeedStatus, readyForReturn } from '@/modules/interventions/parts';
import { priceVisit, type PricingMode } from '@/modules/interventions/pricing';
import type { Ctx } from './context';
import type { Q } from './db';

/** Lectures du module interventions (toujours sous RLS, via withUser). */

export type CaseStatus = 'new' | 'planned' | 'in_progress' | 'waiting_parts' | 'return_to_plan' | 'closed' | 'cancelled';
export type VisitStatus = 'planned' | 'in_progress' | 'done' | 'cancelled' | 'client_absent' | 'no_access' | 'postponed';

export interface DayVisit {
  id: string;
  case_id: string;
  scheduled_at: string;
  client_name: string;
  type_name: string;
  problem: string | null;
  warranty: 'yes' | 'no' | 'unknown';
  case_status: CaseStatus;
  tickets: string | null;
}

/** Bornes de la journée locale du compte, en UTC. */
function dayBounds(ctx: Pick<Ctx, 'today' | 'timezone'>) {
  return [ctx.today, ctx.timezone] as const;
}

export async function loadTechDay(q: Q, ctx: Pick<Ctx, 'today' | 'timezone' | 'typeIds'>) {
  const [day, tz] = dayBounds(ctx);
  const visits = (
    await q<DayVisit>(
      `select v.id, v.case_id, v.scheduled_at, c.name as client_name, it.name as type_name, sc.problem, sc.warranty, sc.status as case_status,
              (select string_agg(r.number, ', ') from case_references r where r.case_id = sc.id) as tickets
       from service_visits v
       join service_cases sc on sc.id = v.case_id
       join clients c on c.id = sc.client_id
       join intervention_types it on it.id = sc.type_id
       where (v.scheduled_at at time zone $2)::date = $1::date and v.status in ('planned', 'in_progress')
         and (cardinality($3::uuid[]) = 0 or sc.type_id = any($3::uuid[]))
       order by v.scheduled_at`,
      [day, tz, ctx.typeIds],
    )
  ).rows;
  const waitingParts = Number(
    (await q<{ n: string }>(`select count(*) as n from service_cases where status = 'waiting_parts'`)).rows[0]?.n ?? 0,
  );
  return { visits, waitingParts };
}

export interface CaseListItem {
  id: string;
  status: CaseStatus;
  client_name: string;
  type_name: string;
  principal_name: string | null;
  problem: string | null;
  tickets: string | null;
  next_visit: string | null;
  created_at: string;
}

export async function searchCases(q: Q, needle: string, status: string | null) {
  const like = `%${needle.trim().toLowerCase()}%`;
  return (
    await q<CaseListItem>(
      `select sc.id, sc.status, c.name as client_name, it.name as type_name, p.name as principal_name, sc.problem,
              (select string_agg(r.number, ', ') from case_references r where r.case_id = sc.id) as tickets,
              (select min(v.scheduled_at) from service_visits v where v.case_id = sc.id and v.status = 'planned') as next_visit,
              sc.created_at
       from service_cases sc
       join clients c on c.id = sc.client_id
       join intervention_types it on it.id = sc.type_id
       left join principals p on p.id = sc.principal_id
       where ($1 = '%%' or lower(c.name) like $1 or lower(coalesce(sc.site_address, '')) like $1 or lower(coalesce(sc.problem, '')) like $1
              or exists (select 1 from case_references r where r.case_id = sc.id and lower(r.number) like $1))
         and ($2::text is null or sc.status = $2)
       order by (sc.status in ('closed', 'cancelled')), coalesce((select min(v.scheduled_at) from service_visits v where v.case_id = sc.id and v.status = 'planned'), sc.created_at) desc
       limit 200`,
      [like, status],
    )
  ).rows;
}

export interface PartNeedView {
  id: string;
  reference: string | null;
  designation: string;
  quantity: number;
  remark: string | null;
  media_id: string | null;
  cancelled: boolean;
  ordered: number;
  received: number;
  status: NeedStatus;
}

export async function loadCase(q: Q, caseId: string) {
  const c = (
    await q<{
      id: string; status: CaseStatus; type_id: string; type_name: string; principal_id: string | null; principal_name: string | null;
      client_id: string; client_name: string; client_email: string | null; site_address: string | null; payer: 'principal' | 'client' | 'other';
      onsite_contact: string | null; equipment: string | null; request_subject: string | null; request_text: string | null; problem: string | null;
      warranty: 'yes' | 'no' | 'unknown'; recipient_language: 'fr' | 'nl' | 'it'; created_at: string;
    }>(
      `select sc.*, it.name as type_name, p.name as principal_name, c.name as client_name,
              (select ct.email from contacts ct where ct.client_id = c.id and ct.email is not null order by ct.created_at limit 1) as client_email
       from service_cases sc join intervention_types it on it.id = sc.type_id join clients c on c.id = sc.client_id
       left join principals p on p.id = sc.principal_id where sc.id = $1`,
      [caseId],
    )
  ).rows[0];
  if (!c) return null;
  const [refs, visits, needs, inbound, outbound, addresses] = await Promise.all([
    q<{ id: string; number: string; issuer_name: string | null }>(
      `select r.id, r.number, p.name as issuer_name from case_references r left join principals p on p.id = r.issuer_id where r.case_id = $1 order by r.created_at`,
      [caseId],
    ).then((r) => r.rows),
    q<{ id: string; scheduled_at: string | null; status: VisitStatus; outcome_reason: string | null; validated_versions: number }>(
      `select v.id, v.scheduled_at, v.status, v.outcome_reason,
              (select count(*)::int from report_versions rv where rv.visit_id = v.id and rv.status = 'validated') as validated_versions
       from service_visits v where v.case_id = $1 order by v.scheduled_at nulls last, v.created_at`,
      [caseId],
    ).then((r) => r.rows),
    q<Omit<PartNeedView, 'status' | 'cancelled'> & { cancelled_at: string | null }>(
      `select n.id, n.reference, n.designation, n.quantity, n.remark, n.media_id, n.cancelled_at,
              coalesce((select sum(o.quantity) from part_orders o where o.need_id = n.id), 0)::int as ordered,
              coalesce((select sum(r.quantity) from part_receipts r where r.need_id = n.id), 0)::int as received
       from part_needs n where n.case_id = $1 order by n.created_at`,
      [caseId],
    ).then((r) =>
      r.rows.map((n) => {
        const state = { quantity: n.quantity, cancelled: n.cancelled_at !== null, orderedQuantity: n.ordered, receivedQuantity: n.received };
        return { ...n, cancelled: state.cancelled, status: needStatus(state) } as PartNeedView;
      }),
    ),
    q<{ id: string; subject: string | null; from_address: string | null; received_at: string; status: string }>(
      `select id, subject, from_address, received_at, status from inbound_messages where attached_case_id = $1 or suggested_case_id = $1 order by received_at desc`,
      [caseId],
    ).then((r) => r.rows),
    q<{ id: string; kind: string; recipient_label: string; recipient_email: string | null; status: 'queued' | 'sent' | 'failed'; created_at: string }>(
      `select id, kind, recipient_label, recipient_email, status, created_at from outbound_messages where case_id = $1 order by created_at desc`,
      [caseId],
    ).then((r) => r.rows),
    c.principal_id
      ? q<{ id: string; label: string; email: string }>(`select id, label, email from principal_addresses where principal_id = $1 order by label`, [c.principal_id]).then((r) => r.rows)
      : Promise.resolve([]),
  ]);
  const ready = readyForReturn(needs.map((n) => ({ quantity: n.quantity, cancelled: n.cancelled, orderedQuantity: n.ordered, receivedQuantity: n.received })));
  return { case: c, refs, visits, needs, inbound, outbound, addresses, readyForReturn: ready };
}

export interface ReportVersionRow {
  id: string;
  version: number;
  status: 'draft' | 'validated';
  done_text: string | null;
  todo_text: string | null;
  remarks: string | null;
  pricing_mode: PricingMode;
  hourly_rate_cents: number | null;
  flat_cents: number | null;
  vat_rate_bp: number;
  rounding_minutes: number;
  presence_minutes: number | null;
  billable_minutes: number | null;
  amount_excl_cents: number | null;
  amount_incl_cents: number | null;
  signature_path: string | null;
  no_signature_reason: string | null;
  language: 'fr' | 'nl' | 'it';
  validated_at: string | null;
}

export async function loadVisit(q: Q, visitId: string, userId: string) {
  const v = (
    await q<{ id: string; case_id: string; scheduled_at: string | null; status: VisitStatus; outcome_reason: string | null }>(
      `select id, case_id, scheduled_at, status, outcome_reason from service_visits where id = $1`,
      [visitId],
    )
  ).rows[0];
  if (!v) return null;
  const [workers, media, versions] = await Promise.all([
    q<{ id: string; user_id: string; name: string | null; arrived_at: string | null; left_at: string | null; break_minutes: number }>(
      `select w.id, w.user_id, coalesce(w.worker_name, p.full_name, p.email) as name, w.arrived_at, w.left_at, w.break_minutes
       from visit_workers w left join profiles p on p.id = w.user_id where w.visit_id = $1 order by w.arrived_at nulls last`,
      [visitId],
    ).then((r) => r.rows),
    q<{ id: string; kind: string; created_at: string }>(`select id, kind, created_at from visit_media where visit_id = $1 order by created_at`, [visitId]).then((r) => r.rows),
    q<ReportVersionRow>(`select * from report_versions where visit_id = $1 order by version desc`, [visitId]).then((r) => r.rows),
  ]);
  const me = workers.find((w) => w.user_id === userId) ?? null;
  const pricing = (rv: Pick<ReportVersionRow, 'pricing_mode' | 'hourly_rate_cents' | 'flat_cents' | 'vat_rate_bp' | 'rounding_minutes'>) =>
    priceVisit(
      workers.map((w) => ({ arrivedAt: w.arrived_at ? new Date(w.arrived_at) : null, leftAt: w.left_at ? new Date(w.left_at) : null, breakMinutes: w.break_minutes })),
      {
        mode: rv.pricing_mode,
        hourlyRateCents: rv.hourly_rate_cents,
        flatCents: rv.flat_cents,
        vatRateBp: rv.vat_rate_bp,
        roundingMinutes: rv.rounding_minutes,
      },
    );
  return { visit: v, workers, me, media, versions, draft: versions.find((x) => x.status === 'draft') ?? null, latestValidated: versions.find((x) => x.status === 'validated') ?? null, pricing };
}

export async function loadOrgIdentity(q: Q, orgId: string) {
  return (
    await q<{
      name: string; company_name: string | null; address: string | null; phone: string | null; email: string | null;
      vat_number: string | null; iban: string | null; payment_terms: string | null; logo_path: string | null; timezone: string;
    }>(`select name, company_name, address, phone, email, vat_number, iban, payment_terms, logo_path, timezone from organizations where id = $1`, [orgId])
  ).rows[0]!;
}
