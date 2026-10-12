'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { looksLikeArrival } from '@/modules/interventions/parts';
import { parseEuroToCents } from '@/modules/interventions/pricing';
import { extractTicketNumbers, normalizeTicket } from '@/modules/interventions/references';
import { parseRequestEmail, type ParsedRequest } from '@/modules/interventions/request';
import { getMessages, isLocale } from '@/i18n';
import { requireCtx } from '../context';
import { pgCode, type Q, withService, withUser } from '../db';
import { loadVisit } from '../interventions';
import { scheduleOutbox } from '../outbox-run';
import { renderReportPdf, SIGNATURE_NOT_REQUIRED } from '../pdf';
import { saveBytes, saveFile } from '../storage';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const opt = (f: FormData, k: string) => str(f, k) || null;

function back(path: string, extra = ''): never {
  revalidatePath(path);
  redirect(`${path}${extra}`);
}

// ── Nouvelle intervention ─────────────────────────────────────────────

export interface RequestDraft {
  subject: string;
  body: string;
  parsed: ParsedRequest;
  matchingCases: { id: string; label: string }[];
}

/** Lit l'email collé et propose les champs, chacun avec sa source. Rien n'est enregistré. */
export async function readRequest(_: RequestDraft | null, formData: FormData): Promise<RequestDraft | null> {
  const ctx = await requireCtx();
  const subject = str(formData, 'subject');
  const body = str(formData, 'body');
  if (!subject && !body) return null;
  const parsed = parseRequestEmail(subject, body);
  // Un dossier existe-t-il déjà pour ce numéro ? Rattachement proposé, jamais automatique (M03).
  const matchingCases = parsed.tickets.value.length
    ? await withUser(ctx.userId, async (q) =>
        (
          await q<{ id: string; label: string }>(
            `select distinct sc.id, c.name || ' · ' || r.number as label from case_references r
             join service_cases sc on sc.id = r.case_id join clients c on c.id = sc.client_id
             where lower(trim(r.number)) = any($1::text[])`,
            [parsed.tickets.value.map(normalizeTicket)],
          )
        ).rows,
      )
    : [];
  return { subject, body, parsed, matchingCases };
}

/** Crée le client si besoin, le dossier, ses tickets et le premier passage, en une transaction. */
export async function createCase(formData: FormData) {
  const ctx = await requireCtx();
  const typeId = str(formData, 'typeId');
  const principalId = opt(formData, 'principalId');
  const when = opt(formData, 'when');
  let caseId = '';
  try {
    caseId = await withUser(ctx.userId, async (q) => {
      let clientId = opt(formData, 'clientId');
      if (!clientId) {
        const name = str(formData, 'clientName');
        if (!name) throw Object.assign(new Error('client'), { code: 'client' });
        clientId = (
          await q<{ id: string }>(`insert into clients (organization_id, name, address, notes) values ($1, $2, $3, $4) returning id`, [
            ctx.orgId,
            name,
            opt(formData, 'site'),
            null,
          ])
        ).rows[0]!.id;
        if (opt(formData, 'clientPhone') || opt(formData, 'clientEmail')) {
          await q(`insert into contacts (organization_id, client_id, name, phone, email) values ($1, $2, $3, $4, $5)`, [
            ctx.orgId,
            clientId,
            name,
            opt(formData, 'clientPhone'),
            opt(formData, 'clientEmail'),
          ]);
        }
      }
      const id = (
        await q<{ id: string }>(
          `insert into service_cases (organization_id, type_id, principal_id, client_id, site_address, payer, onsite_contact, equipment,
                                      request_subject, request_text, problem, warranty, recipient_language, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
          [
            ctx.orgId, typeId, principalId, clientId, opt(formData, 'site'), str(formData, 'payer') || 'client', opt(formData, 'contact'),
            opt(formData, 'equipment'), opt(formData, 'subject'), opt(formData, 'body'), opt(formData, 'problem'),
            str(formData, 'warranty') || 'unknown', str(formData, 'language') || 'fr', when ? 'planned' : 'new',
          ],
        )
      ).rows[0]!.id;
      for (const n of formData.getAll('ticket').map(String).map((s) => s.trim()).filter(Boolean)) {
        await q(`insert into case_references (organization_id, case_id, issuer_id, number) values ($1, $2, $3, $4)`, [ctx.orgId, id, principalId, n]);
      }
      if (when) {
        await q(`insert into service_visits (organization_id, case_id, scheduled_at) values ($1, $2, ($3::timestamp at time zone $4))`, [ctx.orgId, id, when, ctx.timezone]);
      }
      return id;
    });
  } catch (e) {
    redirect(`/interventions/nouvelle?erreur=${pgCode(e) ?? 'x'}`);
  }
  revalidatePath('/interventions');
  redirect(`/interventions/${caseId}?cree=1`);
}

export async function addTicket(formData: FormData) {
  const ctx = await requireCtx();
  const caseId = str(formData, 'caseId');
  const number = str(formData, 'number');
  if (number) {
    try {
      await withUser(ctx.userId, (q) =>
        q(`insert into case_references (organization_id, case_id, issuer_id, number) select $1, id, principal_id, $3 from service_cases where id = $2`, [ctx.orgId, caseId, number]),
      );
    } catch (e) {
      back(`/interventions/${caseId}`, `?erreur=${pgCode(e) ?? 'x'}`);
    }
  }
  back(`/interventions/${caseId}`);
}

export async function scheduleVisit(formData: FormData) {
  const ctx = await requireCtx();
  const caseId = str(formData, 'caseId');
  const when = str(formData, 'when');
  await withUser(ctx.userId, async (q) => {
    await q(`insert into service_visits (organization_id, case_id, scheduled_at) values ($1, $2, ($3::timestamp at time zone $4))`, [ctx.orgId, caseId, when, ctx.timezone]);
    await q(`update service_cases set status = 'planned' where id = $1 and status in ('new', 'return_to_plan')`, [caseId]);
  });
  back(`/interventions/${caseId}`);
}

export async function setCaseStatus(formData: FormData) {
  const ctx = await requireCtx();
  const caseId = str(formData, 'caseId');
  const status = str(formData, 'status');
  if (!['closed', 'cancelled', 'planned'].includes(status)) back(`/interventions/${caseId}`, '?erreur=1');
  await withUser(ctx.userId, (q) =>
    q(`update service_cases set status = $1, closed_at = case when $1 in ('closed', 'cancelled') then now() else null end where id = $2`, [status, caseId]),
  );
  back(`/interventions/${caseId}`);
}

// ── Passage : heures, photos, issue ───────────────────────────────────

function visitPath(f: FormData) {
  return `/interventions/${str(f, 'caseId')}/passages/${str(f, 'visitId')}`;
}

export async function markArrival(formData: FormData) {
  const ctx = await requireCtx();
  const visitId = str(formData, 'visitId');
  await withUser(ctx.userId, async (q) => {
    await q(
      `insert into visit_workers (organization_id, visit_id, user_id, arrived_at) values ($1, $2, $3, now())
       on conflict (visit_id, user_id) do update set arrived_at = coalesce(visit_workers.arrived_at, now())`,
      [ctx.orgId, visitId, ctx.userId],
    );
    await q(`update service_visits set status = 'in_progress' where id = $1 and status = 'planned'`, [visitId]);
    await q(`update service_cases set status = 'in_progress' where id = (select case_id from service_visits where id = $1) and status in ('new', 'planned', 'return_to_plan')`, [visitId]);
  });
  back(visitPath(formData));
}

export async function markDeparture(formData: FormData) {
  const ctx = await requireCtx();
  await withUser(ctx.userId, (q) =>
    q(`update visit_workers set left_at = now() where visit_id = $1 and user_id = $2 and left_at is null and arrived_at is not null`, [str(formData, 'visitId'), ctx.userId]),
  );
  back(visitPath(formData));
}

/** Correction des heures (horaires réels, avec trace dans la version du rapport). */
export async function setTimes(formData: FormData) {
  const ctx = await requireCtx();
  const toTs = (v: string | null) => v;
  try {
    await withUser(ctx.userId, (q) =>
      q(
        `update visit_workers set arrived_at = ($1::timestamp at time zone $5), left_at = ($2::timestamp at time zone $5), break_minutes = $3
         where id = $4`,
        [toTs(opt(formData, 'arrived')), toTs(opt(formData, 'left')), Math.max(0, Number(str(formData, 'breaks')) || 0), str(formData, 'workerId'), ctx.timezone],
      ),
    );
  } catch (e) {
    back(visitPath(formData), `?erreur=${pgCode(e) ?? 'x'}`);
  }
  back(visitPath(formData));
}

export async function setVisitOutcome(formData: FormData) {
  const ctx = await requireCtx();
  const status = str(formData, 'status');
  if (!['cancelled', 'client_absent', 'no_access', 'postponed', 'done'].includes(status)) back(visitPath(formData), '?erreur=1');
  const reason = opt(formData, 'reason');
  if (status !== 'done' && !reason) back(visitPath(formData), '?erreur=reason');
  await withUser(ctx.userId, async (q) => {
    await q(`update service_visits set status = $1, outcome_reason = $2 where id = $3`, [status, reason, str(formData, 'visitId')]);
    if (status !== 'done') await q(`update service_cases set status = 'return_to_plan' where id = $1 and status not in ('closed', 'cancelled')`, [str(formData, 'caseId')]);
  });
  back(visitPath(formData));
}

export async function uploadPhoto(formData: FormData) {
  const ctx = await requireCtx();
  const file = formData.get('photo');
  const kind = str(formData, 'kind') || 'other';
  if (!(file instanceof File) || file.size === 0) back(visitPath(formData), '?erreur=photo');
  let stored: { path: string; contentType: string };
  try {
    stored = await saveFile(ctx.orgId, file as File);
  } catch {
    back(visitPath(formData), '?erreur=photo');
  }
  await withUser(ctx.userId, (q) =>
    q(`insert into visit_media (organization_id, visit_id, kind, storage_path, content_type) values ($1, $2, $3, $4, $5)`, [
      ctx.orgId,
      str(formData, 'visitId'),
      kind,
      stored!.path,
      stored!.contentType,
    ]),
  );
  back(visitPath(formData));
}

// ── Pièces ────────────────────────────────────────────────────────────

export async function addPartNeed(formData: FormData) {
  const ctx = await requireCtx();
  const caseId = str(formData, 'caseId');
  const designation = str(formData, 'designation') || str(formData, 'reference');
  const returnTo = str(formData, 'visitId') ? visitPath(formData) : `/interventions/${caseId}`;
  if (!designation) back(returnTo, '?erreur=part');
  let mediaId: string | null = null;
  const file = formData.get('photo');
  await withUser(ctx.userId, async (q) => {
    if (file instanceof File && file.size > 0 && str(formData, 'visitId')) {
      const stored = await saveFile(ctx.orgId, file);
      mediaId = (
        await q<{ id: string }>(`insert into visit_media (organization_id, visit_id, kind, storage_path, content_type) values ($1, $2, $3, $4, $5) returning id`, [
          ctx.orgId,
          str(formData, 'visitId'),
          str(formData, 'photoKind') === 'damaged' ? 'damaged' : 'notice',
          stored.path,
          stored.contentType,
        ])
      ).rows[0]!.id;
    }
    await q(`insert into part_needs (organization_id, case_id, reference, designation, quantity, remark, media_id) values ($1, $2, $3, $4, $5, $6, $7)`, [
      ctx.orgId,
      caseId,
      opt(formData, 'reference'),
      designation,
      Math.max(1, Number(str(formData, 'quantity')) || 1),
      opt(formData, 'remark'),
      mediaId,
    ]);
  });
  back(returnTo);
}

/** Commande : notée, et mise en file d'envoi si une adresse est choisie (une seule fois par besoin et quantité). */
export async function orderPart(formData: FormData) {
  const ctx = await requireCtx();
  const caseId = str(formData, 'caseId');
  const needId = str(formData, 'needId');
  const supplier = str(formData, 'supplier') || '—';
  const supplierEmail = opt(formData, 'supplierEmail');
  await withUser(ctx.userId, async (q) => {
    const need = (await q<{ quantity: number; reference: string | null; designation: string; ordered: number }>(
      `select quantity, reference, designation, coalesce((select sum(quantity) from part_orders where need_id = n.id), 0)::int as ordered from part_needs n where id = $1`,
      [needId],
    )).rows[0];
    if (!need || need.ordered >= need.quantity) return;
    const qty = need.quantity - need.ordered;
    await q(`insert into part_orders (organization_id, need_id, supplier_label, quantity) values ($1, $2, $3, $4)`, [ctx.orgId, needId, supplier, qty]);
    const tickets = (await q<{ t: string | null }>(`select string_agg(number, ', ') as t from case_references where case_id = $1`, [caseId])).rows[0]?.t;
    // Sans adresse choisie, la commande est seulement notée (passée par téléphone, au comptoir…) : aucun email.
    if (supplierEmail) await q(
      `insert into outbound_messages (organization_id, case_id, kind, recipient_label, recipient_email, subject, body, idempotency_key)
       values ($1, $2, 'part_order', $3, $4, $5, $6, $7) on conflict (organization_id, idempotency_key) do nothing`,
      [
        ctx.orgId, caseId, supplier, supplierEmail,
        `${tickets ? `Ticket ${tickets} — ` : ''}${need.reference ?? need.designation}`,
        `${need.designation}${need.reference ? ` (réf. ${need.reference})` : ''} × ${qty}`,
        `order:${needId}:${need.ordered}`,
      ],
    );
    await q(`update service_cases set status = 'waiting_parts' where id = $1 and status not in ('closed', 'cancelled')`, [caseId]);
  });
  scheduleOutbox();
  back(`/interventions/${caseId}`, '?commande=1');
}

/** Réception d'une ligne : la quantité réellement reçue (par défaut, le reste attendu). */
export async function receivePart(formData: FormData) {
  const ctx = await requireCtx();
  const caseId = str(formData, 'caseId');
  const needId = str(formData, 'needId');
  await withUser(ctx.userId, async (q) => {
    await receiveNeeds(q, ctx.orgId, caseId, [{ needId, quantity: Number(str(formData, 'quantity')) || null }], 'manual');
  });
  back(`/interventions/${caseId}`);
}

/**
 * Enregistre des réceptions confirmées ligne par ligne (relecture M03) : jamais plus que le reste
 * attendu ; « quantity » absente = tout le reste. Le dossier ne revient « à planifier » que lorsque
 * toutes les lignes actives sont entièrement reçues.
 */
async function receiveNeeds(q: Q, orgId: string, caseId: string, items: { needId: string; quantity: number | null }[], source: 'manual' | 'email') {
  for (const { needId, quantity } of items) {
    const n = (await q<{ quantity: number; received: number }>(
      `select quantity, coalesce((select sum(quantity) from part_receipts where need_id = n.id), 0)::int as received from part_needs n where id = $1 and case_id = $2 and cancelled_at is null`,
      [needId, caseId],
    )).rows[0];
    if (!n || n.received >= n.quantity) continue;
    const qty = Math.min(n.quantity - n.received, quantity && quantity > 0 ? Math.floor(quantity) : n.quantity - n.received);
    await q(`insert into part_receipts (organization_id, need_id, quantity, source) values ($1, $2, $3, $4)`, [orgId, needId, qty, source]);
  }
  // Toutes les pièces actives reçues → retour à planifier (M06).
  const pending = (await q<{ n: number }>(
    `select count(*)::int as n from part_needs n where n.case_id = $1 and n.cancelled_at is null
       and coalesce((select sum(quantity) from part_receipts r where r.need_id = n.id), 0) < n.quantity`,
    [caseId],
  )).rows[0]!.n;
  if (pending === 0) await q(`update service_cases set status = 'return_to_plan' where id = $1 and status = 'waiting_parts'`, [caseId]);
}

export async function cancelPartNeed(formData: FormData) {
  const ctx = await requireCtx();
  const caseId = str(formData, 'caseId');
  await withUser(ctx.userId, (q) => q(`update part_needs set cancelled_at = now() where id = $1`, [str(formData, 'needId')]));
  back(`/interventions/${caseId}`);
}

// ── Rapport : brouillon, validation figée, file d'envoi ───────────────

function readPricing(formData: FormData) {
  const mode = ['none', 'hourly', 'flat'].includes(str(formData, 'pricingMode')) ? str(formData, 'pricingMode') : 'none';
  const vat = Number(str(formData, 'vat').replace(',', '.'));
  return {
    mode,
    hourly: mode === 'hourly' ? parseEuroToCents(str(formData, 'rate')) : null,
    flat: mode === 'flat' ? parseEuroToCents(str(formData, 'flat')) : null,
    vatBp: Number.isFinite(vat) && vat >= 0 && vat <= 100 ? Math.round(vat * 100) : 2100,
    rounding: [1, 5, 10, 15, 30, 60].includes(Number(str(formData, 'rounding'))) ? Number(str(formData, 'rounding')) : 15,
  };
}

async function upsertDraft(q: Q, orgId: string, visitId: string, formData: FormData) {
  const p = readPricing(formData);
  const values = [
    opt(formData, 'done'), opt(formData, 'todo'), opt(formData, 'remarks'), p.mode, p.hourly, p.flat, p.vatBp, p.rounding,
    str(formData, 'language') || 'fr',
  ];
  const draft = (await q<{ id: string }>(`select id from report_versions where visit_id = $1 and status = 'draft'`, [visitId])).rows[0];
  if (draft) {
    await q(
      `update report_versions set done_text = $1, todo_text = $2, remarks = $3, pricing_mode = $4, hourly_rate_cents = $5, flat_cents = $6,
              vat_rate_bp = $7, rounding_minutes = $8, language = $9 where id = $10`,
      [...values, draft.id],
    );
    return draft.id;
  }
  const next = (await q<{ v: number }>(`select coalesce(max(version), 0) + 1 as v from report_versions where visit_id = $1`, [visitId])).rows[0]!.v;
  return (
    await q<{ id: string }>(
      `insert into report_versions (organization_id, visit_id, version, done_text, todo_text, remarks, pricing_mode, hourly_rate_cents, flat_cents, vat_rate_bp, rounding_minutes, language)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [orgId, visitId, next, ...values],
    )
  ).rows[0]!.id;
}

export async function saveReportDraft(formData: FormData) {
  const ctx = await requireCtx();
  await withUser(ctx.userId, (q) => upsertDraft(q, ctx.orgId, str(formData, 'visitId'), formData));
  back(visitPath(formData), '?brouillon=1');
}

/**
 * Valide la version : calcule et fige durées et montants (par le code), enregistre la signature,
 * produit et stocke les PDF (donneur d'ordre et client final), puis met en file un envoi par
 * destinataire coché (clé d'idempotence = version + destinataire). Tout dans une transaction.
 */
export async function validateReport(formData: FormData) {
  const ctx = await requireCtx();
  const visitId = str(formData, 'visitId');
  const caseId = str(formData, 'caseId');
  const signature = str(formData, 'signature');
  const noSigReason = opt(formData, 'noSignatureReason');
  if (!signature.startsWith('data:image/png;base64,') && !noSigReason && ctx.options.signature) back(visitPath(formData), '?erreur=signature');
  let sigPath: string | null = null;
  if (signature.startsWith('data:image/png;base64,')) {
    const bytes = Buffer.from(signature.slice('data:image/png;base64,'.length), 'base64');
    if (bytes.length > 0 && bytes.length < 2_000_000) sigPath = await saveBytes(ctx.orgId, bytes, 'image/png');
  }
  try {
    await withUser(ctx.userId, async (q) => {
      const id = await upsertDraft(q, ctx.orgId, visitId, formData);
      const data = await loadVisit(q, visitId, ctx.userId);
      const rv = data!.versions.find((v) => v.id === id)!;
      const price = data!.pricing(rv);
      await q(
        `update report_versions set status = 'validated', validated_at = now(), validated_by = $2, presence_minutes = $3, billable_minutes = $4,
                amount_excl_cents = $5, amount_incl_cents = $6, signature_path = $7, no_signature_reason = $8,
                pdf_path = null, client_pdf_path = null
         where id = $1`,
        [
          id, ctx.userId, price.presenceMinutes, price.billableMinutes, price.amountExclCents, price.amountInclCents, sigPath,
          // Option « signature » désactivée : motif fidèle, imposé par le serveur, sans inventer un refus
          // du client (relecture U01) ; sinon, le motif saisi par le technicien.
          sigPath ? null : !ctx.options.signature ? SIGNATURE_NOT_REQUIRED : noSigReason,
        ],
      );
      // PDF figés : une modification ultérieure (heures, tarif, logo, pièces) ne change plus ce rapport (D02).
      const t = getMessages(isLocale(rv.language) ? rv.language : 'fr');
      const paths: string[] = [];
      for (const audience of ['principal', 'client'] as const) {
        const pdf = await renderReportPdf(q, id, t, audience);
        if (!pdf) throw new Error('pdf');
        paths.push(await saveBytes(ctx.orgId, pdf, 'application/pdf'));
      }
      await q(`update report_versions set pdf_path = $2, client_pdf_path = $3 where id = $1`, [id, paths[0], paths[1]]);
      await q(`update service_visits set status = 'done' where id = $1 and status in ('planned', 'in_progress')`, [visitId]);
      // Destinataires cochés : « addr:<id> » (bureau du donneur d'ordre) ou « client ».
      const c = (await q<{ client_name: string; client_email: string | null; tickets: string | null; type_name: string }>(
        `select cl.name as client_name, (select ct.email from contacts ct where ct.client_id = cl.id and ct.email is not null limit 1) as client_email,
                (select string_agg(number, ', ') from case_references where case_id = sc.id) as tickets, it.name as type_name
         from service_cases sc join clients cl on cl.id = sc.client_id join intervention_types it on it.id = sc.type_id where sc.id = $1`,
        [caseId],
      )).rows[0]!;
      const subject = `${c.tickets ? `Ticket ${c.tickets} — ` : ''}${c.type_name} — ${c.client_name}`;
      for (const r of formData.getAll('recipient').map(String)) {
        let label = '';
        let email: string | null = null;
        const audience = r === 'client' ? 'client' : 'principal';
        if (r === 'client') {
          label = c.client_name;
          email = c.client_email;
        } else if (r.startsWith('addr:')) {
          const a = (await q<{ label: string; email: string; principal: string }>(
            `select a.label, a.email, p.name as principal from principal_addresses a join principals p on p.id = a.principal_id where a.id = $1`,
            [r.slice(5)],
          )).rows[0];
          if (!a) continue;
          label = `${a.principal} · ${a.label}`;
          email = a.email;
        } else continue;
        await q(
          `insert into outbound_messages (organization_id, case_id, report_version_id, kind, recipient_label, recipient_email, subject, body, idempotency_key, audience)
           values ($1, $2, $3, 'report_email', $4, $5, $6, $7, $8, $9) on conflict (organization_id, idempotency_key) do nothing`,
          [
            ctx.orgId, caseId, id, label, email, subject,
            // Les remarques du technicien vont au donneur d'ordre, jamais au client final (R02).
            [rv.done_text, rv.todo_text, audience === 'principal' ? rv.remarks : null].filter(Boolean).join('\n\n'),
            `report:${id}:${r}`, audience,
          ],
        );
      }
      // Le dossier : en attente de pièces s'il en reste à recevoir, sinon prêt à clôturer.
      const pending = (await q<{ n: number }>(
        `select count(*)::int as n from part_needs n where n.case_id = $1 and n.cancelled_at is null
           and coalesce((select sum(quantity) from part_receipts r where r.need_id = n.id), 0) < n.quantity`,
        [caseId],
      )).rows[0]!.n;
      await q(`update service_cases set status = $2 where id = $1 and status not in ('closed', 'cancelled')`, [caseId, pending > 0 ? 'waiting_parts' : 'in_progress']);
    });
  } catch (e) {
    back(visitPath(formData), `?erreur=${pgCode(e) ?? 'x'}`);
  }
  scheduleOutbox();
  back(visitPath(formData), '?valide=1');
}

/** Correction d'un rapport validé : nouvelle version (brouillon) reprenant le contenu ; l'ancienne reste figée. */
export async function newReportVersion(formData: FormData) {
  const ctx = await requireCtx();
  const visitId = str(formData, 'visitId');
  await withUser(ctx.userId, (q) =>
    q(
      `insert into report_versions (organization_id, visit_id, version, done_text, todo_text, remarks, pricing_mode, hourly_rate_cents, flat_cents, vat_rate_bp, rounding_minutes, language)
       select organization_id, visit_id, version + 1, done_text, todo_text, remarks, pricing_mode, hourly_rate_cents, flat_cents, vat_rate_bp, rounding_minutes, language
       from report_versions where visit_id = $1 and status = 'validated' order by version desc limit 1
       on conflict (visit_id, version) do nothing`,
      [visitId],
    ),
  );
  back(visitPath(formData));
}

// ── Emails reçus ──────────────────────────────────────────────────────

export interface InboundDraft {
  subject: string;
  body: string;
  /** Dossiers proposés, avec les lignes encore attendues (à confirmer une par une). */
  matches: { id: string; label: string; needs: { id: string; label: string; remaining: number }[] }[];
  arrival: boolean;
  duplicate: boolean;
}

/** Intègre un email (collé ou transféré) : le compte est celui de l'utilisateur ; le dossier est seulement proposé (E03). */
export async function integrateEmail(_: InboundDraft | null, formData: FormData): Promise<InboundDraft | null> {
  const ctx = await requireCtx();
  const subject = str(formData, 'subject');
  const body = str(formData, 'body');
  if (!subject && !body) return null;
  const tickets = extractTicketNumbers(subject, body).map(normalizeTicket);
  const fingerprint = createHash('sha256').update(`${str(formData, 'from')}\n${subject}\n${body}`).digest('hex');
  return withUser(ctx.userId, async (q) => {
    const matches = tickets.length
      ? (await q<{ id: string; label: string; needs: { id: string; label: string; remaining: number }[] }>(
          `select sc.id, min(c.name || ' · ' || r.number) as label,
                  coalesce((select json_agg(json_build_object('id', n.id, 'label', n.designation || coalesce(' · ' || n.reference, ''),
                                    'remaining', n.quantity - coalesce((select sum(quantity) from part_receipts pr where pr.need_id = n.id), 0)) order by n.created_at)
                            from part_needs n where n.case_id = sc.id and n.cancelled_at is null
                              and coalesce((select sum(quantity) from part_receipts pr where pr.need_id = n.id), 0) < n.quantity), '[]') as needs
           from case_references r join service_cases sc on sc.id = r.case_id
           join clients c on c.id = sc.client_id where lower(trim(r.number)) = any($1::text[]) group by sc.id`,
          [tickets],
        )).rows
      : [];
    const ins = await q(
      `insert into inbound_messages (organization_id, from_address, subject, body_text, fingerprint, suggested_case_id)
       values ($1, $2, $3, $4, $5, $6) on conflict (organization_id, fingerprint) do nothing`,
      [ctx.orgId, opt(formData, 'from'), subject, body, fingerprint, matches.length === 1 ? matches[0]!.id : null],
    );
    return { subject, body, matches, arrival: looksLikeArrival(`${subject} ${body}`), duplicate: ins.rowCount === 0 };
  });
}

export async function attachEmail(formData: FormData) {
  const ctx = await requireCtx();
  const caseId = str(formData, 'caseId');
  const subject = str(formData, 'subject');
  const body = str(formData, 'body');
  const fingerprint = createHash('sha256').update(`${str(formData, 'from')}\n${subject}\n${body}`).digest('hex');
  await withUser(ctx.userId, async (q) => {
    await q(`update inbound_messages set status = 'attached', attached_case_id = $1 where fingerprint = $2`, [caseId, fingerprint]);
    // « Pièce disponible » n'est pas « pièce reçue » : seules les lignes cochées, avec leur quantité (M03).
    const items = formData
      .getAll('receive')
      .map(String)
      .map((needId) => ({ needId, quantity: Number(str(formData, `qty:${needId}`)) || null }));
    if (items.length) await receiveNeeds(q, ctx.orgId, caseId, items, 'email');
  });
  back(`/interventions/${caseId}`);
}

// ── Envois incertains ou en échec : l'utilisateur décide ─────────────

/**
 * Renvoyer, ou confirmer qu'un message est bien parti (relecture D03). Le message doit être visible
 * par l'utilisateur (RLS) et appartenir à son entreprise ; l'état n'est changé que par le serveur.
 */
export async function decideMessage(formData: FormData) {
  const ctx = await requireCtx();
  const caseId = str(formData, 'caseId');
  const id = str(formData, 'messageId');
  const decision = str(formData, 'decision');
  const msg = await withUser(ctx.userId, async (q) =>
    (await q<{ organization_id: string; status: string }>(`select organization_id, status from outbound_messages where id = $1`, [id])).rows[0],
  );
  if (!msg || msg.organization_id !== ctx.orgId || !['failed', 'uncertain'].includes(msg.status)) back(`/interventions/${caseId}`);
  if (decision === 'resend') {
    await withService((q) =>
      q(`update outbound_messages set status = 'queued', attempts = 0, last_error = null, locked_until = null, updated_at = now()
         where id = $1 and organization_id = $2 and status in ('failed', 'uncertain')`, [id, ctx.orgId]),
    );
    scheduleOutbox();
  } else if (decision === 'sent') {
    await withService((q) =>
      q(`update outbound_messages set status = 'sent', sent_at = now(), locked_until = null, updated_at = now(),
                last_error = 'confirmé envoyé par ' || $3
         where id = $1 and organization_id = $2 and status = 'uncertain'`, [id, ctx.orgId, ctx.email]),
    );
  }
  back(`/interventions/${caseId}`);
}
