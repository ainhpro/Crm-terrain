import { formatDate, formatTime, Icon } from '@/components';
import { markActionDone } from '@/server/actions/crm';
import { isCommercial, isTechnician, requireCtx } from '@/server/context';
import { loadPortfolio } from '@/server/crm';
import { withUser } from '@/server/db';
import { scheduleMailboxFetch } from '@/server/imap';
import { loadTechDay } from '@/server/interventions';

export default async function TodayPage() {
  const ctx = await requireCtx();
  const { t, locale } = ctx;
  if (isTechnician(ctx)) scheduleMailboxFetch();
  const [portfolio, tech] = await withUser(ctx.userId, (q) =>
    Promise.all([isCommercial(ctx) ? loadPortfolio(q, ctx.today) : null, isTechnician(ctx) ? loadTechDay(q, ctx) : null]),
  );
  const b = portfolio?.buckets;
  const clientName = new Map(portfolio?.clients.map((c) => [c.id, c.name]) ?? []);
  const visitsCount = tech?.visits.length ?? 0;
  const lateCount = b?.late.length ?? 0;
  const tasksCount = (b?.today.length ?? 0) + (b?.next7Days.length ?? 0);

  const ActionItem = ({ a }: { a: NonNullable<typeof b>['late'][number] }) => (
    <div>
      <span className="time">{a.date ? formatDate(a.date, locale) : '—'}</span>
      <a className="main" href={`/clients/${a.row.client_id}`}>
        <span>{a.row.client_name}</span>
        <small>{a.row.step_label ?? a.row.note ?? t.actionStatus[a.status]}</small>
      </a>
      <form action={markActionDone}>
        <input type="hidden" name="actionId" value={a.id} />
        <button className="btn small" type="submit">{t.client.markDone}</button>
      </form>
    </div>
  );

  return (
    <main className="page">
      <div>
        <p className="faint">{formatDate(ctx.today, locale, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>{t.today.hello}{ctx.fullName ? ` ${ctx.fullName}` : ''}</h1>
      </div>
      <div className="stats">
        <div className="stat"><b>{isTechnician(ctx) ? visitsCount : (b?.today.length ?? 0)}</b>{isTechnician(ctx) ? t.today.visits : t.today.todaySection}</div>
        <div className="stat"><b>{tasksCount}</b>{t.today.tasks}</div>
        <div className={`stat${lateCount ? ' bad' : ''}`}><b>{lateCount}</b>{t.today.late}</div>
      </div>

      {tech && (
        <section className="stack">
          <h2>{t.today.interventions}</h2>
          {tech.visits.length === 0 ? (
            <p className="faint">{t.interventions.empty}</p>
          ) : (
            <div className="card list">
              {tech.visits.map((v) => (
                <a key={v.id} href={`/interventions/${v.case_id}/passages/${v.id}`}>
                  <span className="time">{formatTime(v.scheduled_at, locale, ctx.timezone)}</span>
                  <span className="main">
                    <span>{v.client_name}</span>
                    <small>{[v.type_name, v.tickets, v.problem].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="tag">{t.caseStatus[v.case_status]}</span>
                </a>
              ))}
            </div>
          )}
          {tech.pendingInbound > 0 && (
            <a className="card pad row" href="/interventions/emails">
              <span className="grow">{t.inbox.toProcess}</span>
              <span className="tag accent">{tech.pendingInbound}</span>
            </a>
          )}
          {tech.waitingParts > 0 && (
            <a className="card pad row" href="/interventions?etat=waiting_parts">
              <span className="grow">{t.today.partsWaiting}</span>
              <span className="tag warn">{tech.waitingParts}</span>
            </a>
          )}
        </section>
      )}

      {b && (
        <>
          {b.late.length > 0 && (
            <section className="stack">
              <h2 style={{ color: 'var(--bad)' }}>{t.today.lateSection}</h2>
              <div className="card list">{b.late.map((a) => <ActionItem key={a.id} a={a} />)}</div>
            </section>
          )}
          {b.today.length > 0 && (
            <section className="stack">
              <h2>{t.today.todaySection}</h2>
              <div className="card list">{b.today.map((a) => <ActionItem key={a.id} a={a} />)}</div>
            </section>
          )}
          {portfolio!.followUps.length > 0 && (
            <section className="stack">
              <h2>{t.today.toVisit}</h2>
              <div className="card list">
                {portfolio!.followUps.slice(0, 8).map((f) => (
                  <a key={f.clientId} href={`/clients/${f.clientId}`}>
                    <span className="main">
                      <span>{clientName.get(f.clientId)}</span>
                      <small>{t.today.visitDue} {formatDate(f.dueOn, locale)}</small>
                    </span>
                    {f.daysLate > 0 && <span className="tag bad">{f.daysLate} {t.today.daysLate}</span>}
                  </a>
                ))}
              </div>
            </section>
          )}
          {b.next7Days.length > 0 && (
            <section className="stack">
              <h2>{t.today.next7Days}</h2>
              <div className="card list">{b.next7Days.map((a) => <ActionItem key={a.id} a={a} />)}</div>
            </section>
          )}
          {b.late.length + b.today.length + b.next7Days.length + portfolio!.followUps.length === 0 && (
            <p className="note ok">{t.today.empty}</p>
          )}
        </>
      )}
      {!b && !tech && (
        <a className="btn primary" href="/demarrer">
          <Icon name="plus" size={18} />
          {t.common.continue}
        </a>
      )}
    </main>
  );
}
