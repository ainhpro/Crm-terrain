import { isCommercial, requireCtx } from '@/server/context';

export default async function StartPage() {
  const ctx = await requireCtx();
  const { t } = ctx;
  if (!isCommercial(ctx)) {
    return (
      <main className="page">
        <h1>{t.start.techTitle}</h1>
        <p className="muted">{t.start.techLead}</p>
        <a className="big-choice main" href="/interventions/nouvelle">
          <span className="ico">+</span>
          <span><b>{t.start.techCreate}</b></span>
        </a>
        <a className="link" href="/">{t.start.later}</a>
      </main>
    );
  }
  return (
    <main className="page">
      <h1>{t.start.title}</h1>
      <p className="muted">{t.start.lead}</p>
      <a className="big-choice main" href="/clients/importer">
        <span className="ico">↑</span>
        <span><b>{t.start.import}</b><small>{t.start.importHint}</small></span>
      </a>
      <a className="big-choice" href="/clients/nouveau">
        <span className="ico">+</span>
        <span><b>{t.start.manual}</b><small>{t.start.manualHint}</small></span>
      </a>
      <a className="link" href="/" style={{ textAlign: 'center', padding: 12 }}>{t.start.later}</a>
    </main>
  );
}
