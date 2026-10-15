import { notFound } from 'next/navigation';
import { BackLink, Flash, formatDate } from '@/components';
import { looksLikeArrival } from '@/modules/interventions/parts';
import { extractTicketNumbers, normalizeTicket } from '@/modules/interventions/references';
import { attachEmail, ignoreMessage } from '@/server/actions/interventions';
import { requireCtx } from '@/server/context';
import { withUser } from '@/server/db';
import { matchCasesByTickets } from '@/server/interventions';

type Row = {
  id: string; channel: 'paste' | 'forward'; status: 'pending' | 'attached' | 'ignored'; from_address: string | null;
  subject: string | null; body_text: string | null; attachments: { name: string }[]; received_at: string; attached_case_id: string | null;
};

/**
 * Un email reçu : son texte (affiché tel quel, jamais comme du HTML), puis la décision du technicien :
 * créer une intervention, rattacher à un dossier proposé par son numéro de ticket, ou ignorer.
 */
export default async function InboundMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { t, locale } = ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withUser(ctx.userId, async (q) => {
    const m = (
      await q<Row>(
        `select id, channel, status, from_address, subject, body_text, attachments, received_at, attached_case_id from inbound_messages where id = $1`,
        [id],
      )
    ).rows[0];
    if (!m) return null;
    const tickets = extractTicketNumbers(m.subject, m.body_text).map(normalizeTicket);
    return { m, matches: m.status === 'pending' ? await matchCasesByTickets(q, tickets) : [] };
  });
  if (!data) notFound();
  const { m, matches } = data;
  const arrival = looksLikeArrival(`${m.subject ?? ''} ${m.body_text ?? ''}`);

  return (
    <main className="page">
      <div className="row">
        <BackLink href="/interventions/emails" label={t.common.back} />
        <h1 style={{ wordBreak: 'break-word' }}>{m.subject || '—'}</h1>
      </div>
      <p className="faint">
        {t.inbox.from} {m.from_address ?? '—'} · {t.inbox.received}{' '}
        {formatDate(m.received_at, locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }, ctx.timezone)} ·{' '}
        {m.channel === 'forward' ? t.inbox.forwarded : t.inbox.pasted}
      </p>
      {m.status !== 'pending' && (
        <Flash kind="info">
          {t.inbox.done}
          {m.attached_case_id && <> · <a className="link" href={`/interventions/${m.attached_case_id}`}>{t.interventions.title}</a></>}
        </Flash>
      )}
      {m.attachments.length > 0 && <p className="small">{t.inbox.attachments} {m.attachments.map((a) => a.name).join(', ')}</p>}
      <div className="card pad small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 360, overflow: 'auto' }}>
        {m.body_text}
      </div>

      {m.status === 'pending' && (
        <>
          <a className="btn primary block" href={`/interventions/nouvelle?message=${m.id}`}>{t.inbox.createCase}</a>
          <section className="stack">
            <h2>{t.inbox.attachOr}</h2>
            {matches.length === 0 && <p className="faint">{t.inbox.noMatch}</p>}
            {matches.map((c) => (
              <form key={c.id} action={attachEmail} className="card pad stack">
                <input type="hidden" name="caseId" value={c.id} />
                <input type="hidden" name="messageId" value={m.id} />
                <span className="label">{t.interventions.suggested}</span>
                <b>{c.label}</b>
                {c.needs.length > 0 && (
                  <fieldset className="stack" style={{ gap: 6 }}>
                    <legend>{arrival ? t.interventions.arrivalDetected : t.interventions.receiveFromEmail}</legend>
                    {c.needs.map((n) => (
                      <div key={n.id} className="row">
                        <label className="row grow"><input type="checkbox" name="receive" value={n.id} />{n.label}</label>
                        <input type="number" name={`qty:${n.id}`} min={1} max={n.remaining} defaultValue={n.remaining}
                          aria-label={`${t.parts.receivedQty} : ${n.label}`} style={{ width: 72, minHeight: 38 }} />
                      </div>
                    ))}
                  </fieldset>
                )}
                <button className="btn primary" type="submit">{t.interventions.attach}</button>
              </form>
            ))}
          </section>
          <form action={ignoreMessage}>
            <input type="hidden" name="messageId" value={m.id} />
            <button className="btn block" type="submit">{t.inbox.ignore}</button>
          </form>
        </>
      )}
    </main>
  );
}
