import { notFound } from 'next/navigation';
import { BackLink, Flash, formatDate, Icon } from '@/components';
import { fill } from '@/i18n/messages/fr';
import { ACTION_STATUSES, DEAL_STATUSES } from '@/modules/crm/pipeline/types';
import { addAction, closeDeal, createDeal, markActionDone } from '@/server/actions/crm';
import { requireModule } from '@/server/context';
import { loadClient } from '@/server/crm';
import { withUser } from '@/server/db';

const TAG: Record<string, string> = { finished: 'ok', late: 'bad', in_progress: 'accent', not_started: '', closed: '' };

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const ctx = await requireModule('crm');
  const { t, locale } = ctx;
  const { id } = await params;
  const sp = await searchParams;
  const data = await withUser(ctx.userId, (q) => loadClient(q, id, ctx.today));
  if (!data) notFound();
  const { client, dealViews, actions, contacts, available } = data;
  const openDeals = dealViews.filter((d) => d.row.status === 'open');
  const phone = contacts.find((c) => c.phone)?.phone;
  const address = [client.address, client.postal_code, client.city].filter(Boolean).join(', ');
  const back = `/clients/${client.id}`;

  return (
    <main className="page">
      <div className="row">
        <BackLink href="/clients" label={t.common.back} />
        <div className="grow">
          <h1>{client.name}</h1>
          <p className="faint">{[client.group_name, client.category && `${t.clients.category} ${client.category}`, address].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {sp.ok && <Flash>{t.common.saved}</Flash>}
      {sp.erreur && <Flash kind="bad">{t.common.error}</Flash>}
      <div className="grid2">
        {phone ? <a className="btn" href={`tel:${phone.replace(/\s/g, '')}`}>{t.client.call}</a> : <span className="btn" aria-disabled="true">{t.client.call}</span>}
        <a className="btn" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || client.name)}`} target="_blank" rel="noreferrer">{t.client.route}</a>
      </div>

      <section className="stack">
        <h2>{t.client.deals}</h2>
        {dealViews.length === 0 && <p className="faint">{t.client.noDeals}</p>}
        {dealViews.map((d) => {
          const total = d.pipeline.steps.length;
          return (
            <div key={d.row.id} className="card pad stack">
              <div className="row">
                <b className="grow">{d.row.name}</b>
                <span className={`tag ${TAG[d.progress]}`}>{d.row.status === 'open' ? t.progress[d.progress] : t.client[d.row.status]}</span>
              </div>
              <span className="faint">{fill(t.client.stepOf, { n: Math.min(d.reached + 2, total), total })}</span>
              <div className="bar" aria-hidden="true">
                {d.states.map((s, i) => <i key={i} className={s === 'done' ? 'done' : s === 'implied' ? 'implied' : s === 'active' || s === 'scheduled' ? 'active' : ''} />)}
              </div>
              <div className="steps">
                {d.pipeline.steps.map((s, i) => (
                  <span key={s.id} className={i === d.reached + 1 ? 'on' : ''} title={d.states[i] === 'implied' ? t.client.implied : undefined}>
                    {s.short_label ?? s.label}{d.states[i] === 'done' || d.states[i] === 'implied' ? ' ✓' : ''}
                  </span>
                ))}
              </div>
              {d.row.status === 'open' && (
                <details>
                  <summary>{t.client.closeAs}</summary>
                  <form action={closeDeal} className="row wrap" style={{ marginTop: 8 }}>
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="dealId" value={d.row.id} />
                    {DEAL_STATUSES.filter((s) => s !== 'open').map((s) => (
                      <button key={s} className="btn small" name="status" value={s} type="submit">{t.client[s]}</button>
                    ))}
                  </form>
                </details>
              )}
            </div>
          );
        })}
        {available.length > 0 && (
          <details className="card pad">
            <summary>{t.client.newDeal}</summary>
            <form action={createDeal} className="stack" style={{ marginTop: 10 }}>
              <input type="hidden" name="clientId" value={client.id} />
              <label className="field">{t.client.pipeline}
                <select name="pipelineId" id="pipelineId" required>
                  {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="field">{t.client.dealName}<input type="text" name="name" id="dealName" required defaultValue={`${available[0]!.name} ${ctx.today.slice(0, 4)}`} /></label>
              <button className="btn primary" type="submit">{t.common.add}</button>
            </form>
          </details>
        )}
      </section>

      <a className="btn primary block" href={`/clients/${client.id}/compte-rendu`}>
        <Icon name="mic" size={20} />
        {t.client.dictate}
      </a>

      <details className="card pad">
        <summary>{t.client.addAction}</summary>
        <form action={addAction} className="stack" style={{ marginTop: 10 }}>
          <input type="hidden" name="clientId" value={client.id} />
          <label className="field">{t.client.step}
            <select name="target" id="target">
              <option value="">{t.client.noStep}</option>
              {openDeals.map((d) => (
                <optgroup key={d.row.id} label={d.row.name}>
                  {d.pipeline.steps.map((s) => <option key={s.id} value={`${d.row.id}:${s.id}`}>{s.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="grid2 stack-sm">
            <label className="field">{t.actionBuckets.today}
              <select name="status" id="status" defaultValue="todo">
                {ACTION_STATUSES.map((s) => <option key={s} value={s}>{t.actionStatus[s]}</option>)}
              </select>
            </label>
            <label className="field">{t.client.date}<input type="date" name="date" id="date" defaultValue={ctx.today} /></label>
          </div>
          <label className="field">{t.client.note}<textarea name="note" id="note" rows={2} /></label>
          <button className="btn primary" type="submit">{t.common.add}</button>
        </form>
      </details>

      <section className="stack">
        <h2>{t.client.history}</h2>
        {actions.length === 0 ? (
          <p className="faint">{t.client.noActions}</p>
        ) : (
          <div className="card list">
            {actions.map((a) => (
              <div key={a.id}>
                <span className="time">{a.due_date ? formatDate(a.due_date, locale) : '—'}</span>
                <span className="main">
                  <span>{a.step_label ?? (a.kind === 'report' ? t.report.title : a.kind === 'task' ? t.report.task : t.client.note)}</span>
                  {a.note && <small style={{ whiteSpace: 'pre-line' }}>{a.note}</small>}
                </span>
                {a.status === 'done' ? (
                  <span className="tag ok">{t.actionStatus.done}</span>
                ) : (
                  <form action={markActionDone}>
                    <input type="hidden" name="actionId" value={a.id} />
                    <input type="hidden" name="back" value={back} />
                    <button className="btn small" type="submit" title={t.actionStatus[a.status]}>{t.client.markDone}</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
