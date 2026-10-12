'use client';

import { useActionState, useRef, useState } from 'react';
import type { Messages } from '@/i18n/messages/fr';
import { applyReport, prepareReport, type ReportProposal } from '@/server/actions/crm';
import { Dictation } from '@/app/dictation';
import { DraftKeeper } from '@/app/drafts';

export function ReportForm({ clientId, t, common, locale }: { clientId: string; t: Messages['report']; common: Messages['common']; locale: string }) {
  const [proposal, prepare, pending] = useActionState(prepareReport, null);
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="stack">
      <p className="muted">{t.lead}</p>
      <form action={prepare} className="stack" id={`cr-${clientId}`}>
        <DraftKeeper formId={`cr-${clientId}`} storageKey={`compte-rendu:${clientId}`} restoredLabel={common.draftRestored} clearOnFormId={`cr-apply-${clientId}`} />
        <input type="hidden" name="clientId" value={clientId} />
        <label className="field">
          {t.text}
          <textarea ref={area} data-draft name="text" id="text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <Dictation lang={locale === 'nl' ? 'nl-BE' : 'fr-BE'} onText={(s) => setText((v) => (v ? `${v} ${s}` : s))} labels={{ start: t.startDictation, stop: t.stopDictation, unavailable: t.dictationUnavailable }} />
        <button className="btn primary block" type="submit" disabled={pending}>{t.analyze}</button>
      </form>

      {proposal && (
        <form action={applyReport} className="stack" id={`cr-apply-${clientId}`}>
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="text" value={proposal.text} />
          <h2>{t.proposal}</h2>
          <p className="faint">{proposal.engine === 'ai' ? t.engineAi : t.engineRules}</p>
          <div className="card pad stack">
            <span className="label">{t.summary}</span>
            <p>{proposal.summary}</p>
          </div>
          <div className="card">
            {proposal.steps.length > 0 && (
              <StepChoice key={proposal.text} proposal={proposal} t={t} source={common.source} />
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
            {!proposal.step && proposal.candidates.length === 0 && proposal.tasks.length === 0 && <p className="check faint">{t.nothing}</p>}
          </div>
          <button className="btn primary block" type="submit">{t.validate}</button>
        </form>
      )}
    </div>
  );
}

/**
 * Étape terminée : proposée, jamais imposée. Modifiable dans la liste ; en cas d'ambiguïté (plusieurs
 * affaires) rien n'est choisi. Les actions ouvertes de l'étape choisie sont montrées, chacune cochable.
 */
function StepChoice({ proposal, t, source }: { proposal: ReportProposal; t: Messages['report']; source: string }) {
  const [step, setStep] = useState(proposal.step?.value ?? '');
  const actions = step ? proposal.openActions[step] ?? [] : [];
  return (
    <div className="check stack" style={{ alignItems: 'stretch', gap: 8 }}>
      <label className="field">
        {t.stepDone}
        <select name="step" value={step} onChange={(e) => setStep(e.target.value)}>
          <option value="">{t.noStep}</option>
          {proposal.steps.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      {proposal.step?.source && step === proposal.step.value && <span className="source">{source} : « {proposal.step.source} »</span>}
      {proposal.candidates.length > 0 && (
        <p className="note warn">{t.ambiguous} {proposal.candidates.map((c) => c.label).join(' / ')}</p>
      )}
      {proposal.notDone.map((sentence, i) => (
        <span key={i} className="source">{t.notRetained} : « {sentence} »</span>
      ))}
      {actions.length > 0 && (
        <fieldset className="stack" style={{ gap: 4 }}>
          <legend>{t.closeActions}</legend>
          {actions.map((a) => (
            <label key={a.id} className="row small"><input type="checkbox" name="closeAction" value={a.id} defaultChecked={a.close} />{a.label}</label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
