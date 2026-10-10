'use client';

import { useActionState, useState } from 'react';
import type { Messages } from '@/i18n/messages/fr';
import { attachEmail, integrateEmail } from '@/server/actions/interventions';

/** Intégrer un email reçu : le dossier est proposé grâce au numéro de ticket, le technicien confirme. */
export function InboundForm({ t }: { t: Messages }) {
  const [draft, integrate, pending] = useActionState(integrateEmail, null);
  const [from, setFrom] = useState('');
  return (
    <div className="stack">
      <form action={integrate} className="stack">
        <label className="field">From<input type="email" name="from" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">{t.interventions.emailSubject}<input type="text" name="subject" required /></label>
        <label className="field">{t.interventions.emailBody}<textarea name="body" rows={6} /></label>
        <button className="btn primary" type="submit" disabled={pending}>{t.interventions.integrate}</button>
      </form>
      {draft && (
        <div className="stack">
          {draft.matches.length === 0 && <p className="note warn">{t.interventions.suggested} : —</p>}
          {draft.matches.map((m) => (
            <form key={m.id} action={attachEmail} className="card pad stack">
              <input type="hidden" name="caseId" value={m.id} />
              <input type="hidden" name="subject" value={draft.subject} />
              <input type="hidden" name="body" value={draft.body} />
              <input type="hidden" name="from" value={from} />
              <span className="label">{t.interventions.suggested}</span>
              <b>{m.label}</b>
              {m.needs.length > 0 && (
                <fieldset className="stack" style={{ gap: 6 }}>
                  <legend>{draft.arrival ? t.interventions.arrivalDetected : t.interventions.receiveFromEmail}</legend>
                  {m.needs.map((n) => (
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
        </div>
      )}
    </div>
  );
}
