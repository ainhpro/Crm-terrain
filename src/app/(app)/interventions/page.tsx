import { Flash, formatDate, Icon } from '@/components';
import { requireCtx } from '@/server/context';
import { withUser } from '@/server/db';
import { scheduleMailboxFetch } from '@/server/imap';
import { countPendingInbound, searchCases } from '@/server/interventions';

const TAG: Record<string, string> = { waiting_parts: 'warn', return_to_plan: 'accent', closed: 'ok', cancelled: '', in_progress: 'accent', planned: '', new: '' };

export default async function InterventionsPage({ searchParams }: { searchParams: Promise<{ q?: string; etat?: string }> }) {
  const ctx = await requireCtx();
  const { t, locale } = ctx;
  const sp = await searchParams;
  scheduleMailboxFetch();
  const [cases, pendingInbound] = await withUser(ctx.userId, async (q) => [await searchCases(q, sp.q ?? '', sp.etat ?? null), await countPendingInbound(q)] as const);
  return (
    <main className="page">
      <div className="page-head">
        <h1>{t.interventions.title}</h1>
        <div className="row">
          <a className="btn small" href="/interventions/emails"><Icon name="mail" size={16} />{t.interventions.inbound}{pendingInbound > 0 && <span className="tag accent">{pendingInbound}</span>}</a>
          <a className="icon-btn" href="/interventions/nouvelle" aria-label={t.interventions.new} style={{ background: 'var(--accent)', color: '#fff' }}>
            <Icon name="plus" size={20} />
          </a>
        </div>
      </div>
      <form role="search">
        <label className="visually-hidden" htmlFor="q">{t.common.search}</label>
        <input type="search" id="q" name="q" defaultValue={sp.q} placeholder={t.interventions.search} />
      </form>
      {sp.etat && <Flash kind="info">{t.caseStatus[sp.etat as keyof typeof t.caseStatus] ?? sp.etat} · <a className="link" href="/interventions">{t.clients.all}</a></Flash>}
      {cases.length === 0 ? (
        <p className="faint">{t.interventions.empty}</p>
      ) : (
        <div className="card list">
          {cases.map((c) => (
            <a key={c.id} href={`/interventions/${c.id}`}>
              <span className="main">
                <span>{c.client_name}{c.tickets ? ` · ${t.interventions.ticket} ${c.tickets}` : ''}</span>
                <small>{[c.type_name, c.principal_name, c.problem, c.next_visit && formatDate(c.next_visit, locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, ctx.timezone)].filter(Boolean).join(' · ')}</small>
              </span>
              <span className={`tag ${TAG[c.status]}`}>{t.caseStatus[c.status]}</span>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
