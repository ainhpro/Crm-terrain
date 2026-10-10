import { notFound } from 'next/navigation';
import { BackLink, Flash, formatDate, formatTime, Icon } from '@/components';
import { formatMinutes, presenceMinutes } from '@/modules/interventions/pricing';
import {
  addPartNeed, markArrival, markDeparture, newReportVersion, setTimes, setVisitOutcome, uploadPhoto,
} from '@/server/actions/interventions';
import { requireCtx } from '@/server/context';
import { withUser } from '@/server/db';
import { loadCase, loadVisit } from '@/server/interventions';
import { ReportEditor } from './report-editor';

const local = (d: string | null, tz: string) =>
  d ? new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d)).replace(' ', 'T') : '';

export default async function VisitPage({ params, searchParams }: { params: Promise<{ id: string; visitId: string }>; searchParams: Promise<{ erreur?: string; valide?: string; brouillon?: string }> }) {
  const ctx = await requireCtx();
  const { t, locale } = ctx;
  const { id, visitId } = await params;
  const sp = await searchParams;
  const [cs, v] = await withUser(ctx.userId, (q) => Promise.all([loadCase(q, id), loadVisit(q, visitId, ctx.userId)]));
  if (!cs || !v || v.visit.case_id !== id) notFound();
  const c = cs.case;
  const hidden = (
    <>
      <input type="hidden" name="caseId" value={id} />
      <input type="hidden" name="visitId" value={visitId} />
    </>
  );
  const editable = !v.latestValidated || v.draft;
  const base = v.draft ?? v.latestValidated;
  const recipients = [
    ...cs.addresses.map((a) => ({ value: `addr:${a.id}`, label: `${c.principal_name} · ${a.label}`, email: a.email, defaultOn: cs.addresses.length === 1 })),
    { value: 'client', label: `${t.visit.recipientClient} · ${c.client_name}`, email: c.client_email, defaultOn: Boolean(c.client_email) },
  ];

  return (
    <main className="page">
      <div className="row">
        <BackLink href={`/interventions/${id}`} label={t.common.back} />
        <div className="grow">
          <h1>{c.client_name}</h1>
          <p className="faint">{[c.type_name, cs.refs.map((r) => r.number).join(', '), v.visit.scheduled_at && formatDate(v.visit.scheduled_at, locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, ctx.timezone)].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="tag accent">{t.visitStatus[v.visit.status]}</span>
      </div>
      {sp.erreur && <Flash kind="bad">{sp.erreur === 'signature' ? t.visit.missingSignature : sp.erreur === 'reason' ? `${t.visit.reason} ?` : t.common.error}</Flash>}
      {sp.valide && <Flash>{t.visit.validated} · {t.visit.queued}</Flash>}
      {sp.brouillon && <Flash>{t.common.saved}</Flash>}

      {/* Heures */}
      <section className="stack">
        <div className="stats" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className={`stat${v.me?.arrived_at ? '' : ''}`} style={v.me?.arrived_at ? { background: 'var(--ok-soft)', borderColor: '#abefc6' } : undefined}>
            <b className="num">{v.me?.arrived_at ? formatTime(v.me.arrived_at, locale, ctx.timezone) : '—'}</b>{t.visit.arrived}
          </div>
          <div className="stat">
            <b className="num">{v.me ? formatMinutes(presenceMinutes({ arrivedAt: v.me.arrived_at ? new Date(v.me.arrived_at) : null, leftAt: v.me.left_at ? new Date(v.me.left_at) : new Date(), breakMinutes: 0 })) : '—'}</b>
            {t.visit.presence}
          </div>
        </div>
        {!v.me?.arrived_at ? (
          <form action={markArrival}>{hidden}<button className="btn primary block" type="submit">{t.visit.arrive}</button></form>
        ) : !v.me.left_at ? (
          <form action={markDeparture}>{hidden}<button className="btn block" type="submit">{t.visit.leave}</button></form>
        ) : null}
        {v.workers.length > 0 && (
          <details className="card pad">
            <summary>{t.visit.arrived} / {t.visit.left} / {t.visit.breaks}</summary>
            {v.workers.map((w) => (
              <form key={w.id} action={setTimes} className="stack" style={{ marginTop: 10 }}>
                {hidden}
                <input type="hidden" name="workerId" value={w.id} />
                <b>{w.name}</b>
                <div className="grid2 stack-sm">
                  <label className="field">{t.visit.arrived}<input type="datetime-local" name="arrived" defaultValue={local(w.arrived_at, ctx.timezone)} /></label>
                  <label className="field">{t.visit.left}<input type="datetime-local" name="left" defaultValue={local(w.left_at, ctx.timezone)} /></label>
                </div>
                <label className="field">{t.visit.breaks}<input type="number" name="breaks" min={0} defaultValue={w.break_minutes} /></label>
                <button className="btn small" type="submit">{t.common.save}</button>
              </form>
            ))}
          </details>
        )}
      </section>

      {/* Photos */}
      <section className="stack">
        <h2>{t.visit.photos}</h2>
        {v.media.length > 0 && (
          <div className="photos">
            {v.media.map((m) => (
              <figure key={m.id}>
                <a href={`/fichiers/${m.id}`} target="_blank"><img src={`/fichiers/${m.id}`} alt={t.visit.kinds[m.kind as keyof typeof t.visit.kinds]} loading="lazy" /></a>
                <figcaption>{t.visit.kinds[m.kind as keyof typeof t.visit.kinds]}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <form action={uploadPhoto} className="stack card pad">
          {hidden}
          <div className="choices">
            {(['before', 'part', 'after'] as const).map((k, i) => (
              <label key={k} className="choice"><input type="radio" name="kind" value={k} defaultChecked={i === 0} /><span>{t.visit.kinds[k]}</span></label>
            ))}
          </div>
          <label className="btn">
            <Icon name="camera" size={20} />
            {t.visit.addPhoto}
            <input type="file" name="photo" accept="image/*" capture="environment" required className="visually-hidden" />
          </label>
          <button className="btn small" type="submit">{t.common.save}</button>
        </form>
      </section>

      {/* Pièces à commander depuis le terrain */}
      {ctx.options.parts && (
        <details className="card pad">
          <summary>{t.parts.add}</summary>
          <form action={addPartNeed} className="stack" style={{ marginTop: 10 }}>
            {hidden}
            <fieldset>
              <legend>{t.parts.photo}</legend>
              <div className="choices">
                <label className="choice"><input type="radio" name="photoKind" value="notice" defaultChecked /><span>{t.parts.photoNotice}</span></label>
                <label className="choice"><input type="radio" name="photoKind" value="damaged" /><span>{t.parts.photoDamaged}</span></label>
              </div>
            </fieldset>
            <input type="file" name="photo" accept="image/*" capture="environment" aria-label={t.parts.photo} />
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

      {/* Rapport */}
      <section className="stack">
        <h2>{t.visit.report}</h2>
        {v.versions.length > 0 && (
          <div className="card list">
            {v.versions.map((rv) => (
              <div key={rv.id}>
                <span className="main">
                  <span>{t.visit.version} {rv.version}</span>
                  <small>{rv.status === 'validated' ? `${t.visit.validated} · ${formatDate(rv.validated_at, locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, ctx.timezone)}` : t.visit.draft}</small>
                </span>
                {rv.status === 'validated' && <a className="btn small" href={`/rapports/${rv.id}/pdf`} target="_blank">{t.visit.pdf}</a>}
              </div>
            ))}
          </div>
        )}
        {editable ? (
          <ReportEditor
            t={t}
            caseId={id}
            visitId={visitId}
            base={base}
            toOrder={cs.needs.filter((n) => !n.cancelled).map((n) => `${n.designation}${n.reference ? ` (${n.reference})` : ''} × ${n.quantity}`)}
            workers={v.workers.map((w) => ({ arrivedAt: w.arrived_at, leftAt: w.left_at, breakMinutes: w.break_minutes }))}
            recipients={recipients}
            options={ctx.options}
            language={c.recipient_language}
            locale={locale}
          />
        ) : (
          <div className="stack">
            <p className="note info">{t.visit.frozen}</p>
            <form action={newReportVersion}>{hidden}<button className="btn" type="submit">{t.visit.newVersion}</button></form>
          </div>
        )}
      </section>

      {/* Issue du passage (imprévus) */}
      {(v.visit.status === 'planned' || v.visit.status === 'in_progress') && (
        <details className="card pad">
          <summary>{t.visit.outcome}</summary>
          <form action={setVisitOutcome} className="stack" style={{ marginTop: 10 }}>
            {hidden}
            <div className="choices">
              {(['client_absent', 'no_access', 'postponed', 'cancelled'] as const).map((s, i) => (
                <label key={s} className="choice"><input type="radio" name="status" value={s} defaultChecked={i === 0} /><span>{t.visitStatus[s]}</span></label>
              ))}
            </div>
            <label className="field">{t.visit.reason}<input type="text" name="reason" required /></label>
            <button className="btn" type="submit">{t.common.save}</button>
          </form>
        </details>
      )}
    </main>
  );
}
