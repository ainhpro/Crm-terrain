'use client';

import { useActionState, useState } from 'react';
import { DraftKeeper } from '@/app/drafts';
import type { Messages } from '@/i18n/messages/fr';
import { createCase, readRequest } from '@/server/actions/interventions';

type Opt = { id: string; name: string };

/** Nouvelle intervention : coller l'email → champs proposés avec leur source → vérification → création. */
export function NewCaseFlow({
  t, types, principals, clients, showWarranty, defaultLanguage,
}: {
  t: Messages; types: Opt[]; principals: (Opt & { default_type_id: string | null })[]; clients: Opt[]; showWarranty: boolean; defaultLanguage: string;
}) {
  const [draft, read, pending] = useActionState(readRequest, null);
  const [mode, setMode] = useState<'email' | 'manual'>('email');
  const [principalId, setPrincipalId] = useState('');
  const [existing, setExisting] = useState(false);
  const p = draft?.parsed;
  const Source = ({ s, confident }: { s: string | null | undefined; confident?: boolean }) =>
    s ? (
      <span className="source">
        {confident === false && <span className="tag warn" style={{ marginRight: 6 }}>{t.common.toConfirm}</span>}
        {t.common.source} : « {s} »
      </span>
    ) : null;
  const defaultType = principals.find((x) => x.id === principalId)?.default_type_id ?? types[0]?.id;

  return (
    <div className="stack">
      <div className="grid2">
        <button type="button" className={`btn${mode === 'email' ? ' primary' : ''}`} onClick={() => setMode('email')}>{t.interventions.fromEmail}</button>
        <button type="button" className={`btn${mode === 'manual' ? ' primary' : ''}`} onClick={() => setMode('manual')}>{t.interventions.manual}</button>
      </div>

      {mode === 'email' && (
        <form action={read} className="stack" id="demande-email">
          <DraftKeeper formId="demande-email" storageKey="demande-email" restoredLabel={t.common.draftRestored} />
          <label className="field">{t.interventions.emailSubject}<input type="text" name="subject" id="subject" /></label>
          <label className="field">{t.interventions.emailBody}<textarea data-draft name="body" id="body" rows={7} /></label>
          <button className="btn primary" type="submit" disabled={pending}>{t.interventions.analyze}</button>
        </form>
      )}

      {draft?.matchingCases.length ? (
        <div className="note warn">
          {t.interventions.suggested} :{' '}
          {draft.matchingCases.map((m) => <a key={m.id} className="link" href={`/interventions/${m.id}`} style={{ marginRight: 10 }}>{m.label}</a>)}
        </div>
      ) : null}

      {(mode === 'manual' || draft) && (
        <form action={createCase} className="stack" key={draft ? draft.subject + draft.body : 'manual'}>
          {draft && <h2>{t.interventions.understood}</h2>}
          {draft && <p className="faint">{draft.engine === 'ai' ? t.interventions.engineAi : t.interventions.engineRules}</p>}
          <input type="hidden" name="subject" value={draft?.subject ?? ''} />
          <input type="hidden" name="body" value={draft?.body ?? ''} />
          <label className="field">{t.interventions.principal}
            <select name="principalId" id="principalId" value={principalId} onChange={(e) => setPrincipalId(e.target.value)}>
              <option value="">{t.interventions.noPrincipal}</option>
              {principals.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className="field">{t.interventions.type}
            <select name="typeId" id="typeId" key={defaultType} defaultValue={defaultType} required>
              {types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <div className="stack" style={{ gap: 6 }}>
            <label className="field">{t.interventions.tickets} <span className="faint">({t.common.optional})</span>
              <input type="text" name="ticket" id="ticket" defaultValue={p?.tickets.value[0] ?? ''} />
            </label>
            <Source s={p?.tickets.source} confident={p?.tickets.confident} />
          </div>
          <fieldset className="stack">
            <legend>{t.interventions.client}</legend>
            <div className="grid2">
              <button type="button" className={`btn small${!existing ? ' primary' : ''}`} onClick={() => setExisting(false)}>{t.interventions.newClient}</button>
              <button type="button" className={`btn small${existing ? ' primary' : ''}`} onClick={() => setExisting(true)}>{t.interventions.existingClient}</button>
            </div>
            {existing ? (
              <select name="clientId" id="clientId" required aria-label={t.interventions.existingClient}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <>
                <input type="text" name="clientName" id="clientName" required placeholder={t.clients.name} aria-label={t.clients.name} />
                <div className="grid2 stack-sm">
                  <span className="stack" style={{ gap: 4 }}>
                    <input type="tel" name="clientPhone" id="clientPhone" defaultValue={p?.phone.value ?? ''} placeholder={t.clients.phone} aria-label={t.clients.phone} />
                    <Source s={p?.phone.source} />
                  </span>
                  <span className="stack" style={{ gap: 4 }}>
                    <input type="email" name="clientEmail" id="clientEmail" defaultValue={p?.email.value ?? ''} placeholder={t.clients.email} aria-label={t.clients.email} />
                    <Source s={p?.email.source} />
                  </span>
                </div>
              </>
            )}
          </fieldset>
          <div className="stack" style={{ gap: 6 }}>
            <label className="field">{t.interventions.site}<input type="text" name="site" id="site" defaultValue={p?.postalAddress.value ?? ''} /></label>
            <Source s={p?.postalAddress.source} confident={p?.postalAddress.confident} />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="field">{t.interventions.problem}<textarea name="problem" id="problem" rows={3} defaultValue={p?.problem.value ?? ''} /></label>
            <Source s={p?.problem.source} confident={false} />
          </div>
          {showWarranty && (
            <div className="stack" style={{ gap: 6 }}>
              <fieldset>
                <legend>{t.interventions.warranty}</legend>
                <div className="choices">
                  {(['yes', 'no', 'unknown'] as const).map((w) => (
                    <label key={w} className="choice"><input type="radio" name="warranty" value={w} defaultChecked={(p?.warranty.value ?? 'unknown') === w} /><span>{t.warranty[w]}</span></label>
                  ))}
                </div>
              </fieldset>
              <Source s={p?.warranty.source} confident={false} />
            </div>
          )}
          {/* Recréé quand le donneur d'ordre change : « qui paie » suit ce choix par défaut. */}
          <fieldset key={`payer-${principalId}`}>
            <legend>{t.interventions.payer}</legend>
            <div className="choices">
              {(['principal', 'client', 'other'] as const).map((w) => (
                <label key={w} className="choice"><input type="radio" name="payer" value={w} defaultChecked={(principalId ? 'principal' : 'client') === w} /><span>{t.payer[w]}</span></label>
              ))}
            </div>
          </fieldset>
          <div className="grid2 stack-sm">
            <label className="field">{t.interventions.contact}<input type="text" name="contact" id="contact" /></label>
            <label className="field">{t.interventions.equipment}<input type="text" name="equipment" id="equipment" /></label>
          </div>
          <label className="field">{t.interventions.language}
            <select name="language" id="language" defaultValue={p?.language.value ?? defaultLanguage}>
              <option value="fr">{t.language.fr}</option>
              <option value="nl">{t.language.nl}</option>
            </select>
          </label>
          <label className="field">{t.interventions.when}<input type="datetime-local" name="when" id="when" /></label>
          <button className="btn primary block" type="submit">{t.interventions.create}</button>
        </form>
      )}
    </div>
  );
}
