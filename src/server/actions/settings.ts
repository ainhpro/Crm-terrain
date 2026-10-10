'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { pipelineCodeFromName, stepCodeFromLabel } from '@/modules/crm/templates/standard';
import { defaultOptions, type TypeKind } from '@/modules/interventions/options';
import { requireCtx } from '../context';
import { pgCode, withUser } from '../db';
import { sessionUserId } from '../session';
import { saveFile } from '../storage';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const opt = (f: FormData, k: string) => str(f, k) || null;
const PROFILES = ['commercial', 'technician', 'both'];
const KINDS: TypeKind[] = ['sav', 'measure', 'showroom', 'custom'];

function done(extra = ''): never {
  revalidatePath('/', 'layout');
  redirect(`/reglages${extra}`);
}

/** Réglages d'un membre (le sien, ou ceux d'un membre de l'équipe pour le propriétaire — la RLS l'impose). */
export async function saveMemberSettings(formData: FormData) {
  const ctx = await requireCtx();
  const userId = str(formData, 'userId') || ctx.userId;
  const profile = str(formData, 'profile');
  if (!PROFILES.includes(profile)) done('?erreur=1');
  const typeIds = formData.getAll('typeId').map(String);
  const options = {
    parts: formData.get('optParts') === 'on',
    pricing: formData.get('optPricing') === 'on',
    signature: formData.get('optSignature') === 'on',
    warranty: formData.get('optWarranty') === 'on',
  };
  await withUser(ctx.userId, (q) =>
    q(
      `insert into member_settings (organization_id, user_id, profile, type_ids, options, updated_at) values ($1, $2, $3, $4, $5, now())
       on conflict (organization_id, user_id) do update set profile = excluded.profile, type_ids = excluded.type_ids, options = excluded.options, updated_at = now()`,
      [ctx.orgId, userId, profile, typeIds, JSON.stringify(options)],
    ),
  );
  done('?ok=1');
}

/** Valeurs par défaut des options selon les types cochés (bouton « proposer »). */
export async function suggestOptions(formData: FormData) {
  const ctx = await requireCtx();
  const typeIds = formData.getAll('typeId').map(String);
  const kinds = await withUser(ctx.userId, async (q) =>
    (await q<{ kind: TypeKind }>(`select kind from intervention_types where id = any($1::uuid[])`, [typeIds])).rows.map((r) => r.kind),
  );
  const o = defaultOptions(kinds);
  const fd = new FormData();
  for (const [k, v] of formData.entries()) if (!k.startsWith('opt')) fd.append(k, v);
  if (o.parts) fd.set('optParts', 'on');
  if (o.pricing) fd.set('optPricing', 'on');
  if (o.signature) fd.set('optSignature', 'on');
  if (o.warranty) fd.set('optWarranty', 'on');
  return saveMemberSettings(fd);
}

export async function saveCompany(formData: FormData) {
  const ctx = await requireCtx();
  if (ctx.role !== 'owner') done('?erreur=owner');
  const vat = (opt(formData, 'vat') ?? '').replace(/[\s.]/g, '').toUpperCase();
  if (vat && !/^BE[01]\d{9}$/.test(vat)) done('?erreur=vat');
  let logo: string | null = null;
  const file = formData.get('logo');
  if (file instanceof File && file.size > 0) {
    try {
      logo = (await saveFile(ctx.orgId, file)).path;
    } catch {
      done('?erreur=logo');
    }
  }
  await withUser(ctx.userId, (q) =>
    q(
      `update organizations set company_name = $1, address = $2, phone = $3, email = $4, vat_number = $5, iban = $6, payment_terms = $7,
              logo_path = coalesce($8, logo_path) where id = $9`,
      [opt(formData, 'companyName'), opt(formData, 'address'), opt(formData, 'phone'), opt(formData, 'email'), vat || null, opt(formData, 'iban'), opt(formData, 'paymentTerms'), logo, ctx.orgId],
    ),
  );
  done('?ok=1');
}

export async function addType(formData: FormData) {
  const ctx = await requireCtx();
  const name = str(formData, 'name');
  const kind = (KINDS.includes(str(formData, 'kind') as TypeKind) ? str(formData, 'kind') : 'custom') as TypeKind;
  if (!name) done();
  try {
    await withUser(ctx.userId, (q) =>
      q(`insert into intervention_types (organization_id, name, kind, position) values ($1, $2, $3, (select coalesce(max(position), 0) + 1 from intervention_types))`, [ctx.orgId, name, kind]),
    );
  } catch (e) {
    done(`?erreur=${pgCode(e) ?? 'x'}`);
  }
  done('?ok=1');
}

export async function addPrincipal(formData: FormData) {
  const ctx = await requireCtx();
  const name = str(formData, 'name');
  if (!name) done();
  try {
    await withUser(ctx.userId, (q) => q(`insert into principals (organization_id, name, default_type_id) values ($1, $2, $3)`, [ctx.orgId, name, opt(formData, 'defaultTypeId')]));
  } catch (e) {
    done(`?erreur=${pgCode(e) ?? 'x'}`);
  }
  done('?ok=1');
}

export async function addPrincipalAddress(formData: FormData) {
  const ctx = await requireCtx();
  const email = str(formData, 'email').toLowerCase();
  if (!str(formData, 'label') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) done('?erreur=email');
  await withUser(ctx.userId, (q) =>
    q(`insert into principal_addresses (organization_id, principal_id, label, email) values ($1, $2, $3, $4)`, [ctx.orgId, str(formData, 'principalId'), str(formData, 'label'), email]),
  );
  done('?ok=1');
}

/** Invitation : le jeton n'est montré qu'une fois ; en production il partira par email. */
export async function inviteMember(formData: FormData) {
  const ctx = await requireCtx();
  const email = str(formData, 'email').toLowerCase();
  const role = str(formData, 'role') === 'owner' ? 'owner' : 'member';
  let token = '';
  try {
    token = await withUser(ctx.userId, async (q) => (await q<{ t: string }>(`select public.invite_member($1, $2, $3) as t`, [ctx.orgId, email, role])).rows[0]!.t);
  } catch (e) {
    done(`?erreur=${pgCode(e) ?? 'x'}`);
  }
  done(`?invitation=${encodeURIComponent(token)}#equipe`);
}

export async function acceptInvitation(formData: FormData) {
  const userId = await sessionUserId();
  if (!userId) redirect('/connexion');
  try {
    await withUser(userId, (q) => q(`select public.accept_invitation($1)`, [str(formData, 'token')]));
  } catch {
    redirect(`/invitation/${encodeURIComponent(str(formData, 'token'))}?erreur=1`);
  }
  redirect('/');
}

// ── Étapes de vente : chaque compte adapte ses pipelines à son métier (propriétaire uniquement). ──

async function ownerCtx() {
  const ctx = await requireCtx();
  if (ctx.role !== 'owner') done('?erreur=owner#etapes');
  return ctx;
}

export async function addPipeline(formData: FormData) {
  const ctx = await ownerCtx();
  const name = str(formData, 'name');
  if (!name) done('#etapes');
  await withUser(ctx.userId, async (q) => {
    const taken = (await q<{ code: string }>(`select code from pipelines`)).rows.map((r) => r.code);
    const p = (
      await q<{ id: string }>(
        `insert into pipelines (organization_id, code, name, position) values ($1, $2, $3, (select coalesce(max(position), 0) + 1 from pipelines)) returning id`,
        [ctx.orgId, pipelineCodeFromName(name, taken), name],
      )
    ).rows[0]!.id;
    // Un pipeline sans étape ne sert à rien : on lui donne la première, renommable.
    const first = str(formData, 'firstStep') || name;
    await q(`insert into pipeline_steps (organization_id, pipeline_id, code, label, position) values ($1, $2, $3, $4, 0)`, [ctx.orgId, p, stepCodeFromLabel(first, []), first]);
  });
  done('?ok=1#etapes');
}

export async function renamePipeline(formData: FormData) {
  const ctx = await ownerCtx();
  const name = str(formData, 'name');
  if (!name) done('#etapes');
  await withUser(ctx.userId, (q) => q(`update pipelines set name = $1 where id = $2`, [name, str(formData, 'pipelineId')]));
  done('?ok=1#etapes');
}

export async function addStep(formData: FormData) {
  const ctx = await ownerCtx();
  const label = str(formData, 'label');
  const pipelineId = str(formData, 'pipelineId');
  if (!label) done('#etapes');
  await withUser(ctx.userId, async (q) => {
    const taken = (await q<{ code: string }>(`select code from pipeline_steps where pipeline_id = $1`, [pipelineId])).rows.map((r) => r.code);
    await q(
      `insert into pipeline_steps (organization_id, pipeline_id, code, label, position)
       values ($1, $2, $3, $4, (select coalesce(max(position), -1) + 1 from pipeline_steps where pipeline_id = $2))`,
      [ctx.orgId, pipelineId, stepCodeFromLabel(label, taken), label],
    );
  });
  done('?ok=1#etapes');
}

/** Renommer ne change pas le code : l'historique et le calcul restent liés à la même étape. */
export async function renameStep(formData: FormData) {
  const ctx = await ownerCtx();
  const label = str(formData, 'label');
  if (!label) done('#etapes');
  await withUser(ctx.userId, (q) =>
    q(`update pipeline_steps set label = $1, short_label = $2 where id = $3`, [label, opt(formData, 'short'), str(formData, 'stepId')]),
  );
  done('?ok=1#etapes');
}

export async function moveStep(formData: FormData) {
  const ctx = await ownerCtx();
  const stepId = str(formData, 'stepId');
  const dir = str(formData, 'dir') === 'up' ? -1 : 1;
  await withUser(ctx.userId, async (q) => {
    const pipelineId = (await q<{ pipeline_id: string }>(`select pipeline_id from pipeline_steps where id = $1`, [stepId])).rows[0]?.pipeline_id;
    if (!pipelineId) return;
    // Toutes les étapes (archivées comprises) : la fonction de réordonnancement les exige toutes.
    const all = (await q<{ id: string; archived: boolean }>(
      `select id, archived_at is not null as archived from pipeline_steps where pipeline_id = $1 order by position`, [pipelineId],
    )).rows;
    const visible = all.filter((s) => !s.archived);
    const i = visible.findIndex((s) => s.id === stepId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= visible.length) return;
    [visible[i], visible[j]] = [visible[j]!, visible[i]!];
    const order = [...visible.map((s) => s.id), ...all.filter((s) => s.archived).map((s) => s.id)];
    await q(`select public.reorder_pipeline_steps($1, $2::uuid[])`, [pipelineId, order]);
  });
  done('#etapes');
}

/** Une étape utilisée ne se supprime pas : elle est archivée (l'historique la garde). */
export async function archiveStep(formData: FormData) {
  const ctx = await ownerCtx();
  await withUser(ctx.userId, async (q) => {
    const left = (await q<{ n: number }>(
      `select count(*)::int as n from pipeline_steps where pipeline_id = (select pipeline_id from pipeline_steps where id = $1) and archived_at is null`,
      [str(formData, 'stepId')],
    )).rows[0]!.n;
    if (left <= 1) return; // un pipeline garde au moins une étape
    await q(`update pipeline_steps set archived_at = now() where id = $1`, [str(formData, 'stepId')]);
  });
  done('?ok=1#etapes');
}
