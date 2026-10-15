import { headers } from 'next/headers';
import { Flash } from '@/components';
import { deleteMyAccount, deleteOrganization } from '@/server/actions/account';
import { logout } from '@/server/actions/auth';
import {
  addPipeline, addPrincipal, addPrincipalAddress, addStep, addType, archiveStep, inviteMember, moveStep, renamePipeline, renameStep,
  saveCompany, saveMemberSettings, suggestOptions,
} from '@/server/actions/settings';
import { isCommercial, isTechnician, requireCtx } from '@/server/context';
import { loadPipelines } from '@/server/crm';
import { withUser } from '@/server/db';
import { effectiveProfile, isProfile, profilesFor } from '@/modules/crm/formule';
import { readOptions } from '@/modules/interventions/options';
import { loadOrgIdentity } from '@/server/interventions';
import { addressFor } from '@/modules/interventions/inbound';
import { receptionScheme } from '@/server/config';
import { AddressCard } from '../interventions/emails/address-card';

type Member = { user_id: string; name: string; role: 'owner' | 'member'; profile: string | null; type_ids: string[] | null; options: unknown };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; erreur?: string; invitation?: string }> }) {
  const ctx = await requireCtx();
  const { t } = ctx;
  const sp = await searchParams;
  const host = (await headers()).get('host') ?? 'localhost:3000';
  const data = await withUser(ctx.userId, async (q) => ({
    org: await loadOrgIdentity(q, ctx.orgId),
    inboundToken: (await q<{ inbound_token: string }>(`select inbound_token from organizations where id = $1`, [ctx.orgId])).rows[0]?.inbound_token,
    pipelines: isCommercial(ctx) ? await loadPipelines(q) : [],
    openDeals: new Map(
      (await q<{ pipeline_id: string; n: number }>(`select pipeline_id, count(*)::int as n from deals where status = 'open' group by pipeline_id`)).rows.map((r) => [r.pipeline_id, r.n]),
    ),
    types: (await q<{ id: string; name: string; kind: string }>(`select id, name, kind from intervention_types where archived_at is null order by position, name`)).rows,
    principals: (
      await q<{ id: string; name: string; addresses: { label: string; email: string }[] }>(
        `select p.id, p.name, coalesce(json_agg(json_build_object('label', a.label, 'email', a.email) order by a.label) filter (where a.id is not null), '[]') as addresses
         from principals p left join principal_addresses a on a.principal_id = p.id where p.archived_at is null group by p.id order by p.name`,
      )
    ).rows,
    members: (
      await q<Member>(
        `select m.user_id, coalesce(p.full_name, p.email) as name, m.role, s.profile, s.type_ids, s.options
         from organization_members m join profiles p on p.id = m.user_id
         left join member_settings s on s.organization_id = m.organization_id and s.user_id = m.user_id
         order by m.created_at`,
      )
    ).rows,
  }));
  const isOwner = ctx.role === 'owner';
  const profiles = profilesFor(ctx.modules);
  const reception = receptionScheme();
  const inbound = reception && data.inboundToken ? addressFor(reception, data.inboundToken) : null;
  const me = data.members.find((m) => m.user_id === ctx.userId);
  const editable = isOwner ? data.members : me ? [me] : [];
  const errorText = sp.erreur === 'vat' ? t.settings.vatInvalid : sp.erreur === 'owner' ? t.settings.ownerOnly : sp.erreur === 'inUse' ? t.settings.stepsInUse : sp.erreur === 'confirm' ? t.settings.confirmError : sp.erreur === 'lastOwner' ? t.settings.lastOwner : t.common.error;

  const MemberForm = ({ m }: { m: Member }) => {
    const o = readOptions(m.options);
    const profile = effectiveProfile(isProfile(m.profile) ? m.profile : 'commercial', ctx.modules);
    return (
      <form action={saveMemberSettings} className="card pad stack">
        <input type="hidden" name="userId" value={m.user_id} />
        {isOwner && data.members.length > 1 && <b>{t.settings.memberSettings} {m.name}</b>}
        {/* Un seul profil possible (formule technicien) : pas de choix à montrer. */}
        {profiles.length > 1 ? (
          <fieldset>
            <legend>{t.settings.profile}</legend>
            <div className="choices">
              {profiles.map((p) => (
                <label key={p} className="choice"><input type="radio" name="profile" value={p} defaultChecked={profile === p} /><span>{t.welcome[p]}</span></label>
              ))}
            </div>
          </fieldset>
        ) : (
          <input type="hidden" name="profile" value={profile} />
        )}
        {data.types.length > 0 && (
          <fieldset className="stack" style={{ gap: 0 }}>
            <legend>{t.settings.myTypes}</legend>
            <div className="card">
              {data.types.map((ty) => (
                <label key={ty.id} className="check"><input type="checkbox" name="typeId" value={ty.id} defaultChecked={(m.type_ids ?? []).includes(ty.id)} />{ty.name}</label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="stack" style={{ gap: 0 }}>
          <legend>{t.settings.options}</legend>
          <p className="faint" style={{ marginBottom: 6 }}>{t.settings.optionsHint}</p>
          <div className="card">
            <label className="check"><input type="checkbox" name="optParts" defaultChecked={o.parts} />{t.settings.optionParts}</label>
            <label className="check"><input type="checkbox" name="optPricing" defaultChecked={o.pricing} />{t.settings.optionPricing}</label>
            <label className="check"><input type="checkbox" name="optSignature" defaultChecked={o.signature} />{t.settings.optionSignature}</label>
            <label className="check"><input type="checkbox" name="optWarranty" defaultChecked={o.warranty} />{t.settings.optionWarranty}</label>
          </div>
        </fieldset>
        <div className="grid2">
          <button className="btn primary" type="submit">{t.common.save}</button>
          <button className="btn" type="submit" formAction={suggestOptions}>{t.settings.suggest}</button>
        </div>
      </form>
    );
  };

  return (
    <main className="page">
      <h1>{t.settings.title}</h1>
      {sp.ok && <Flash>{t.common.saved}</Flash>}
      {sp.erreur && <Flash kind="bad">{errorText}</Flash>}

      <section className="stack">
        <h2>{t.settings.profile}</h2>
        <p className="faint">{t.settings.profileHint}</p>
        {editable.map((m) => <MemberForm key={m.user_id} m={m} />)}
      </section>

      <section className="stack">
        <h2>{t.settings.company}</h2>
        <p className="faint">{isOwner ? t.settings.companyHint : t.settings.ownerOnly}</p>
        <form action={saveCompany} className="card pad stack">
          <fieldset disabled={!isOwner} className="stack">
            <label className="field">{t.settings.companyName}<input type="text" name="companyName" defaultValue={data.org.company_name ?? ''} /></label>
            <label className="field">{t.clients.address}<input type="text" name="address" defaultValue={data.org.address ?? ''} /></label>
            <div className="grid2 stack-sm">
              <label className="field">{t.clients.phone}<input type="tel" name="phone" defaultValue={data.org.phone ?? ''} /></label>
              <label className="field">{t.clients.email}<input type="email" name="email" defaultValue={data.org.email ?? ''} /></label>
            </div>
            <div className="grid2 stack-sm">
              <label className="field">{t.settings.vat}<input type="text" name="vat" defaultValue={data.org.vat_number ?? ''} placeholder="BE0123456789" /></label>
              <label className="field">{t.settings.iban}<input type="text" name="iban" defaultValue={data.org.iban ?? ''} /></label>
            </div>
            <label className="field">{t.settings.paymentTerms}<input type="text" name="paymentTerms" defaultValue={data.org.payment_terms ?? ''} /></label>
            <label className="field">{t.settings.logo}<input type="file" name="logo" accept="image/png,image/jpeg" /></label>
            <button className="btn primary" type="submit">{t.common.save}</button>
          </fieldset>
        </form>
      </section>

      {isCommercial(ctx) && (
        <section className="stack" id="etapes">
          <h2>{t.settings.salesSteps}</h2>
          <p className="faint">{isOwner ? t.settings.salesStepsHint : t.settings.ownerOnly}</p>
          {data.pipelines.map((p) => (
            <div key={p.id} className="card pad stack">
              <form action={renamePipeline} className="row">
                <input type="hidden" name="pipelineId" value={p.id} />
                <input type="text" name="name" defaultValue={p.name} aria-label={t.settings.pipelineName} className="grow" required disabled={!isOwner} />
                {isOwner && <button className="btn small" type="submit">{t.settings.rename}</button>}
              </form>
              {isOwner && (data.openDeals.get(p.id) ?? 0) > 0 && (
                <p className="faint">{t.settings.stepsLocked.replace('{n}', String(data.openDeals.get(p.id)))}</p>
              )}
              <ol className="stack" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', gap: 12 }}>
                {p.steps.map((s, i) => (
                  <li key={s.id} className="stack" style={{ gap: 6 }}>
                    <form id={`step-${s.id}`} action={renameStep} className="row" style={{ gap: 6 }}>
                      <input type="hidden" name="stepId" value={s.id} />
                      <span className="faint num" style={{ width: 16, flexShrink: 0 }}>{i + 1}</span>
                      <input type="text" name="label" defaultValue={s.label} aria-label={t.settings.stepLabel} className="grow" required disabled={!isOwner} />
                      <input type="text" name="short" defaultValue={s.short_label ?? ''} aria-label={t.settings.shortLabel} placeholder={t.settings.shortLabel} style={{ flex: '0 0 92px' }} maxLength={8} disabled={!isOwner} />
                    </form>
                    {isOwner && (
                      <div className="row" style={{ gap: 6, paddingLeft: 22 }}>
                        <button className="btn small" type="submit" form={`step-${s.id}`}>{t.common.save}</button>
                        <form action={moveStep}><input type="hidden" name="stepId" value={s.id} /><input type="hidden" name="dir" value="up" />
                          <button className="btn small" type="submit" disabled={i === 0 || (data.openDeals.get(p.id) ?? 0) > 0} aria-label={`${t.settings.moveUp} : ${s.label}`}>↑</button></form>
                        <form action={moveStep}><input type="hidden" name="stepId" value={s.id} /><input type="hidden" name="dir" value="down" />
                          <button className="btn small" type="submit" disabled={i === p.steps.length - 1 || (data.openDeals.get(p.id) ?? 0) > 0} aria-label={`${t.settings.moveDown} : ${s.label}`}>↓</button></form>
                        <form action={archiveStep} style={{ marginLeft: 'auto' }}><input type="hidden" name="stepId" value={s.id} />
                          <button className="btn small danger" type="submit" disabled={p.steps.length <= 1 || (data.openDeals.get(p.id) ?? 0) > 0}>{t.settings.archiveStep}</button></form>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {isOwner && (
                <form action={addStep} className="row">
                  <input type="hidden" name="pipelineId" value={p.id} />
                  <input type="text" name="label" placeholder={t.settings.addStep} aria-label={t.settings.addStep} className="grow" required />
                  <button className="btn small" type="submit">{t.common.add}</button>
                </form>
              )}
            </div>
          ))}
          {isOwner && (
            <form action={addPipeline} className="row wrap">
              <input type="text" name="name" placeholder={t.settings.addPipeline} aria-label={t.settings.addPipeline} className="grow" required />
              <button className="btn" type="submit">{t.common.add}</button>
            </form>
          )}
        </section>
      )}

      {isTechnician(ctx) && (
        <>
          {inbound && (
            <section className="stack" id="reception">
              <h2>{t.inbox.title}</h2>
              <AddressCard address={inbound} labels={{ title: t.inbox.address, hint: t.inbox.addressHint, copy: t.inbox.copy, copied: t.inbox.copied }} />
            </section>
          )}
          <section className="stack">
            <h2>{t.settings.types}</h2>
            <div className="card list">
              {data.types.map((ty) => (
                <div key={ty.id}><span className="main">{ty.name}</span><span className="tag">{t.settings.kinds[ty.kind as keyof typeof t.settings.kinds]}</span></div>
              ))}
            </div>
            <form action={addType} className="row wrap">
              <input type="text" name="name" placeholder={t.settings.addType} aria-label={t.settings.addType} className="grow" required />
              <select name="kind" aria-label={t.interventions.type} style={{ maxWidth: 180 }}>
                {(['sav', 'measure', 'showroom', 'custom'] as const).map((k) => <option key={k} value={k}>{t.settings.kinds[k]}</option>)}
              </select>
              <button className="btn" type="submit">{t.common.add}</button>
            </form>
          </section>

          <section className="stack">
            <h2>{t.settings.principals}</h2>
            {data.principals.map((p) => (
              <div key={p.id} className="card pad stack">
                <b>{p.name}</b>
                {p.addresses.map((a, i) => <span key={i} className="small">{a.label} · <span className="muted">{a.email}</span></span>)}
                <form action={addPrincipalAddress} className="row wrap">
                  <input type="hidden" name="principalId" value={p.id} />
                  <input type="text" name="label" placeholder={t.settings.addressLabel} aria-label={t.settings.addressLabel} className="grow" required />
                  <input type="email" name="email" placeholder={t.clients.email} aria-label={t.clients.email} className="grow" required />
                  <button className="btn small" type="submit">{t.settings.addAddress}</button>
                </form>
              </div>
            ))}
            <form action={addPrincipal} className="row wrap">
              <input type="text" name="name" placeholder={t.settings.addPrincipal} aria-label={t.settings.addPrincipal} className="grow" required />
              <select name="defaultTypeId" aria-label={t.interventions.type} style={{ maxWidth: 200 }}>
                <option value="">—</option>
                {data.types.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}
              </select>
              <button className="btn" type="submit">{t.common.add}</button>
            </form>
          </section>
        </>
      )}

      {isOwner && (
        <section className="stack" id="equipe">
          <h2>{t.settings.team}</h2>
          <p className="faint">{t.settings.teamHint}</p>
          <div className="card list">
            {data.members.map((m) => (
              <div key={m.user_id}><span className="main">{m.name}</span><span className="tag">{m.role === 'owner' ? t.settings.owner : t.settings.member}</span></div>
            ))}
          </div>
          {sp.invitation && (
            <div className="note info" style={{ wordBreak: 'break-all' }}>
              {t.settings.inviteLink}<br />
              <code>http{host.startsWith('localhost') ? '' : 's'}://{host}/invitation/{sp.invitation}</code>
            </div>
          )}
          <form action={inviteMember} className="row wrap">
            <input type="email" name="email" placeholder={t.clients.email} aria-label={t.clients.email} className="grow" required />
            <select name="role" aria-label={t.settings.inviteRole} style={{ maxWidth: 160 }}>
              <option value="member">{t.settings.member}</option>
              <option value="owner">{t.settings.owner}</option>
            </select>
            <button className="btn" type="submit">{t.settings.invite}</button>
          </form>
        </section>
      )}

      <section className="stack" id="donnees">
        <h2>{t.settings.data}</h2>
        <p className="faint">{t.settings.dataHint}</p>
        {isOwner && (
          <div className="card pad stack">
            <a className="btn block" href="/reglages/export" download>{t.settings.export}</a>
            <p className="faint">{t.settings.exportHint}</p>
          </div>
        )}
        {isOwner && (
          <details className="card pad">
            <summary className="danger">{t.settings.deleteOrg}</summary>
            <form action={deleteOrganization} className="stack" style={{ marginTop: 10 }}>
              <p className="small">{t.settings.deleteOrgHint}</p>
              <label className="field">{t.settings.confirmName.replace('{name}', ctx.orgName)}<input type="text" name="confirmName" autoComplete="off" required /></label>
              <label className="row small"><input type="checkbox" name="confirm" required />{t.settings.confirmCheck}</label>
              <button className="btn block danger" type="submit">{t.settings.deleteOrgButton}</button>
            </form>
          </details>
        )}
        <details className="card pad">
          <summary className="danger">{t.settings.deleteMe}</summary>
          <form action={deleteMyAccount} className="stack" style={{ marginTop: 10 }}>
            <p className="small">{t.settings.deleteMeHint}</p>
            <label className="field">{t.settings.confirmEmail}<input type="email" name="confirmEmail" autoComplete="off" required /></label>
            <label className="row small"><input type="checkbox" name="confirm" required />{t.settings.confirmCheck}</label>
            <button className="btn block danger" type="submit">{t.settings.deleteMeButton}</button>
          </form>
        </details>
      </section>

      <form action={logout}><button className="btn block" type="submit">{t.auth.logout}</button></form>
    </main>
  );
}
