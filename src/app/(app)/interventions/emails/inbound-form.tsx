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
              {draft.arrival && (
                <label className="row"><input type="checkbox" name="confirmArrival" value="1" />{t.interventions.arrivalDetected}</label>
              )}
              <button className="btn primary" type="submit">{t.interventions.attach}</button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
