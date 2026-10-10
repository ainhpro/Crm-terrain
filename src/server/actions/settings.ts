'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
