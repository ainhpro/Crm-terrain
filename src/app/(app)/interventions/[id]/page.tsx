import { notFound } from 'next/navigation';
import { BackLink, Flash, formatDate } from '@/components';
import {
  addPartNeed, addTicket, cancelPartNeed, orderPart, receivePart, scheduleVisit, setCaseStatus,
} from '@/server/actions/interventions';
import { requireCtx } from '@/server/context';
import { withUser } from '@/server/db';
import { loadCase } from '@/server/interventions';

const PART_TAG: Record<string, string> = { needed: 'warn', ordered: 'accent', partially_received: 'warn', received: 'ok', cancelled: '' };

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cree?: string; erreur?: string; commande?: string }> }) {
  const ctx = await requireCtx();
  const { t, locale } = ctx;
  const { id } = await params;
  const sp = await searchParams;
  const data = await withUser(ctx.userId, (q) => loadCase(q, id));
  if (!data) notFound();
  const c = data.case;
  const closed = c.status === 'closed' || c.status === 'cancelled';
  const dt = (d: string | null) => (d ? formatDate(d, locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, ctx.timezone) : '—');

  return (
    <main className="page">
      <div className="row">
        <BackLink href="/interventions" label={t.common.back} />
        <div className="grow">
          <h1>{c.client_name}</h1>
          <p className="faint">{[c.type_name, c.principal_name, data.refs.map((r) => `${t.interventions.ticket} ${r.number}`).join(', ')].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="tag accent">{t.caseStatus[c.status]}</span>
      </div>
      {sp.cree && <Flash>{t.interventions.created}</Flash>}
      {sp.commande && <Flash>{t.parts.orderSent}</Flash>}
      {sp.erreur && <Flash kind="bad">{sp.erreur === '23505' ? t.interventions.ticketExists : t.common.error}</Flash>}
      {data.readyForReturn && c.status === 'return_to_plan' && <Flash kind="info">{t.interventions.readyForReturn}</Flash>}

      <section className="card pad stack">
        {c.problem && <p>{c.problem}</p>}
        <div className="faint">
          {[c.site_address, c.onsite_contact && `${t.interventions.contact} : ${c.onsite_contact}`, c.equipment, ctx.options.warranty && `${t.interventions.warranty} : ${t.warranty[c.warranty]}`, `${t.interventions.payer} : ${t.payer[c.payer]}`]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {c.request_text && (
          <details>
            <summary>{c.request_subject ?? t.interventions.emailBody}</summary>
            <p style={{ whiteSpace: 'pre-line', marginTop: 8 }} className="small muted">{c.request_text}</p>
          </details>
        )}
      </section>

      <section className="stack">
        <h2>{t.interventions.visits}</h2>
        {data.visits.length > 0 && (
          <div className="card list">
            {data.visits.map((v) => (
              <a key={v.id} href={`/interventions/${c.id}/passages/${v.id}`}>
                <span className="main">
                  <span>{dt(v.scheduled_at)}</span>
                  {v.outcome_reason && <small>{v.outcome_reason}</small>}
                </span>
                <span className={`tag ${v.status === 'done' ? 'ok' : v.status === 'in_progress' ? 'accent' : ''}`}>{t.visitStatus[v.status]}</span>
              </a>
            ))}
          </div>
        )}
        {!closed && (
          <form action={scheduleVisit} className="row wrap">
            <input type="hidden" name="caseId" value={c.id} />
            <label className="visually-hidden" htmlFor="when">{t.interventions.when}</label>
            <input type="datetime-local" name="when" id="when" required className="grow" style={{ maxWidth: 260 }} />
            <button className="btn" type="submit">{t.interventions.newVisit}</button>
          </form>
        )}
      </section>

      {ctx.options.parts && (
        <section className="stack">
          <h2>{t.interventions.parts}</h2>
          {data.needs.length > 0 && (
            <div className="card list">
              {data.needs.map((n) => (
                <div key={n.id} style={{ flexWrap: 'wrap' }}>
                  <span className="main">
                    <span>{n.designation}{n.reference ? ` · ${n.reference}` : ''} × {n.quantity}</span>
                    <small>{[n.remark, n.ordered ? `${n.ordered} ${t.parts.ordered}` : '', n.received ? `${n.received} ${t.parts.received}` : ''].filter(Boolean).join(' · ')}</small>
                  </span>
                  {n.media_id && <a className="link small" href={`/fichiers/${n.media_id}`} target="_blank">{t.parts.photo}</a>}
                  <span className={`tag ${PART_TAG[n.status]}`}>{n.status === 'ordered' ? t.parts.ordered : n.status === 'received' ? t.parts.received : t.parts[n.status as 'needed' | 'partially_received' | 'cancelled']}</span>
                  {!n.cancelled && n.status !== 'received' && !closed && (
                    <div className="row wrap" style={{ width: '100%' }}>
                      {n.ordered < n.quantity && (
                        <form action={orderPart} className="row wrap grow">
                          <input type="hidden" name="caseId" value={c.id} />
                          <input type="hidden" name="needId" value={n.id} />
                          <select name="supplierEmail" aria-label={t.parts.supplier} style={{ maxWidth: 220 }}>
                            <option value="">—</option>
                            {data.addresses.map((a) => <option key={a.id} value={a.email}>{a.label}</option>)}
                          </select>
                          <input type="hidden" name="supplier" value={c.principal_name ?? ''} />
                          <button className="btn small" type="submit">{t.parts.order}</button>
                        </form>
                      )}
                      <form action={receivePart}>
                        <input type="hidden" name="caseId" value={c.id} />
                        <input type="hidden" name="needId" value={n.id} />
                        <button className="btn small primary" type="submit">{t.parts.receive}</button>
                      </form>
                      <form action={cancelPartNeed}>
                        <input type="hidden" name="caseId" value={c.id} />
                        <input type="hidden" name="needId" value={n.id} />
                        <button className="btn small danger" type="submit">{t.parts.cancel}</button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!closed && (
            <details className="card pad">
              <summary>{t.parts.add}</summary>
              <form action={addPartNeed} className="stack" style={{ marginTop: 10 }}>
                <input type="hidden" name="caseId" value={c.id} />
                <div className="grid2 stack-sm">
                  <label className="field">{t.parts.reference}<input type="text" name="reference" /></label>
                  <label className="field">{t.parts.quantity}<input type="number" name="quantity" min={1} defaultValue={1} /></label>
                </div>
                <label className="field">{t.parts.designation}<input type="text" name="designation" /></label>
                <label className="field">{t.parts.remark}<input type="text" name="remark" /></label>
                <button className="btn primary" type="submit">{t.common.add}</button>
              </form>
            </details>
          )}
        </section>
      )}

      <section className="stack">
        <h2>{t.interventions.tickets}</h2>
        <form action={addTicket} className="row">
          <input type="hidden" name="caseId" value={c.id} />
          <label className="visually-hidden" htmlFor="number">{t.interventions.addTicket}</label>
          <input type="text" name="number" id="number" placeholder={t.interventions.addTicket} className="grow" />
          <button className="btn" type="submit">{t.common.add}</button>
        </form>
      </section>

      <section className="stack">
        <h2>{t.interventions.timeline}</h2>
        <div className="card list">
          <div><span className="main"><span>{t.caseStatus.new}</span><small>{formatDate(c.created_at, locale)}</small></span></div>
          {data.inbound.map((m) => (
            <div key={m.id}><span className="main"><span>✉ {m.subject}</span><small>{[m.from_address, formatDate(m.received_at, locale)].filter(Boolean).join(' · ')}</small></span></div>
          ))}
          {data.outbound.map((m) => (
            <div key={m.id}>
              <span className="main"><span>→ {m.recipient_label}</span><small>{[m.recipient_email, formatDate(m.created_at, locale)].filter(Boolean).join(' · ')}</small></span>
              <span className={`tag ${m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : ''}`}>{t.outbound[m.status]}</span>
            </div>
          ))}
        </div>
        {data.outbound.some((m) => m.status === 'queued') && <p className="faint">{t.visit.sendNotConfigured}</p>}
      </section>

      <form action={setCaseStatus} className="row wrap">
        <input type="hidden" name="caseId" value={c.id} />
        {closed ? (
          <button className="btn" name="status" value="planned" type="submit">{t.interventions.reopen}</button>
        ) : (
          <>
            <button className="btn" name="status" value="closed" type="submit">{t.interventions.close}</button>
            <button className="btn danger" name="status" value="cancelled" type="submit">{t.interventions.cancel}</button>
          </>
        )}
      </form>
    </main>
  );
}
