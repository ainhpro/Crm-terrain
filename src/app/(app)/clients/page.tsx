import { Flash, Icon } from '@/components';
import { requireCtx } from '@/server/context';
import { loadPortfolio } from '@/server/crm';
import { withUser } from '@/server/db';

const TAG: Record<string, string> = { finished: 'ok', late: 'bad', in_progress: 'accent', not_started: '', closed: '' };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; groupe?: string; filtre?: string; importes?: string }> }) {
  const ctx = await requireCtx();
  const { t } = ctx;
  const sp = await searchParams;
  const p = await withUser(ctx.userId, (q) => loadPortfolio(q, ctx.today));
  const due = new Set(p.followUps.map((f) => f.clientId));
  const groups = [...new Map(p.clients.filter((c) => c.group_id).map((c) => [c.group_id!, c.group_name!])).entries()];
  const needle = (sp.q ?? '').trim().toLowerCase();
  const list = p.clients.filter(
    (c) =>
      (!needle || c.name.toLowerCase().includes(needle) || (c.city ?? '').toLowerCase().includes(needle)) &&
      (!sp.groupe || c.group_id === sp.groupe) &&
      (sp.filtre !== 'relance' || due.has(c.id) || p.clientStatus.get(c.id) === 'late'),
  );
  const href = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, ...extra })) if (v) u.set(k, v);
    return `/clients${u.size ? `?${u}` : ''}`;
  };
  return (
    <main className="page">
      <div className="page-head">
        <h1>{t.clients.title}</h1>
        <div className="row">
          <a className="btn small" href="/clients/importer">{t.clients.import}</a>
          <a className="icon-btn" href="/clients/nouveau" aria-label={t.clients.add} style={{ background: 'var(--accent)', color: '#fff' }}>
            <Icon name="plus" size={20} />
          </a>
        </div>
      </div>
      {sp.importes && <Flash>{sp.importes} {t.import.done}</Flash>}
      <form role="search">
        <label className="visually-hidden" htmlFor="q">{t.common.search}</label>
        <input type="search" id="q" name="q" defaultValue={sp.q} placeholder={t.clients.search} />
      </form>
      <div className="row wrap">
        <a className={`btn small${!sp.groupe && !sp.filtre ? ' primary' : ''}`} href={href({})}>{t.clients.all} · {p.clients.length}</a>
        <a className={`btn small${sp.filtre === 'relance' ? ' primary' : ''}`} href={href({ filtre: 'relance' })}>{t.clients.toFollowUp}</a>
        {groups.map(([id, name]) => (
          <a key={id} className={`btn small${sp.groupe === id ? ' primary' : ''}`} href={href({ groupe: id })}>{name}</a>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="faint">{t.clients.empty}</p>
      ) : (
        <div className="card list">
          {list.map((c) => {
            const status = p.clientStatus.get(c.id) ?? 'not_started';
            return (
              <a key={c.id} href={`/clients/${c.id}`}>
                <span className="main">
                  <span>{c.name}</span>
                  <small>{[c.group_name, c.city, c.category].filter(Boolean).join(' · ')}</small>
                </span>
                <span className={`tag ${TAG[status]}`}>{t.progress[status]}</span>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
