'use client';

import { useActionState, useRef, useState } from 'react';
import type { Messages } from '@/i18n/messages/fr';
import { applyReport, prepareReport } from '@/server/actions/crm';
import { Dictation } from '@/app/dictation';

export function ReportForm({ clientId, t, common, locale }: { clientId: string; t: Messages['report']; common: Messages['common']; locale: string }) {
  const [proposal, prepare, pending] = useActionState(prepareReport, null);
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="stack">
      <p className="muted">{t.lead}</p>
      <form action={prepare} className="stack">
        <input type="hidden" name="clientId" value={clientId} />
        <label className="field">
          {t.text}
          <textarea ref={area} name="text" id="text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <Dictation lang={locale === 'nl' ? 'nl-BE' : 'fr-BE'} onText={(s) => setText((v) => (v ? `${v} ${s}` : s))} labels={{ start: t.startDictation, stop: t.stopDictation, unavailable: t.dictationUnavailable }} />
        <button className="btn primary block" type="submit" disabled={pending}>{t.analyze}</button>
      </form>

      {proposal && (
        <form action={applyReport} className="stack">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="text" value={proposal.text} />
          <h2>{t.proposal}</h2>
          <div className="card pad stack">
            <span className="label">{t.summary}</span>
            <p>{proposal.summary}</p>
          </div>
          <div className="card">
            {proposal.step && (
              <label className="check">
                <input type="checkbox" name="step" value={proposal.step.value} defaultChecked />
                <span className="grow">
                  {t.stepDone} : <b>{proposal.step.label}</b>
                  {proposal.step.source && <span className="source" style={{ display: 'block' }}>{common.source} : « {proposal.step.source} »</span>}
                </span>
              </label>
            )}
            {proposal.tasks.map((task, i) => (
              <div key={i} className="check" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" name="taskKeep" value={String(i)} defaultChecked aria-label={t.task} />
                <span className="grow stack" style={{ gap: 6 }}>
                  <input type="text" name="task" defaultValue={task.text} aria-label={t.task} />
                  <input type="date" name="taskDue" defaultValue={task.dueOn ?? ''} aria-label={t.due} />
                </span>
              </div>
            ))}
            {!proposal.step && proposal.tasks.length === 0 && <p className="check faint">{t.nothing}</p>}
          </div>
          <button className="btn primary block" type="submit">{t.validate}</button>
        </form>
      )}
    </div>
  );
}
