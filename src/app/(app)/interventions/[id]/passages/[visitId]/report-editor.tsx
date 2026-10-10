'use client';

import { useMemo, useState } from 'react';
import type { Messages } from '@/i18n/messages/fr';
import type { MemberOptions } from '@/modules/interventions/options';
import { formatEuro, formatMinutes, parseEuroToCents, priceVisit, type PricingMode } from '@/modules/interventions/pricing';
import { saveReportDraft, validateReport } from '@/server/actions/interventions';
import type { ReportVersionRow } from '@/server/interventions';
import { SignaturePad } from '@/app/signature';

type Worker = { arrivedAt: string | null; leftAt: string | null; breakMinutes: number };

/** Rapport « fait / à commander / à faire », prix calculé en direct (par le code), signature, destinataires. */
export function ReportEditor({
  t, caseId, visitId, base, toOrder, workers, recipients, options, language, locale,
}: {
  t: Messages; caseId: string; visitId: string; base: ReportVersionRow | null; toOrder: string[]; workers: Worker[];
  recipients: { value: string; label: string; email: string | null; defaultOn: boolean }[]; options: MemberOptions; language: string; locale: string;
}) {
  const [mode, setMode] = useState<PricingMode>(base?.pricing_mode ?? (options.pricing ? 'hourly' : 'none'));
  const [rate, setRate] = useState(base?.hourly_rate_cents != null ? String(base.hourly_rate_cents / 100).replace('.', ',') : '');
  const [flat, setFlat] = useState(base?.flat_cents != null ? String(base.flat_cents / 100).replace('.', ',') : '');
  const [vat, setVat] = useState(String((base?.vat_rate_bp ?? 2100) / 100));
  const [rounding, setRounding] = useState(String(base?.rounding_minutes ?? 15));
  const [signature, setSignature] = useState('');
  const [reason, setReason] = useState('');

  const price = useMemo(
    () =>
      priceVisit(
        workers.map((w) => ({ arrivedAt: w.arrivedAt ? new Date(w.arrivedAt) : null, leftAt: w.leftAt ? new Date(w.leftAt) : null, breakMinutes: w.breakMinutes })),
        { mode, hourlyRateCents: parseEuroToCents(rate), flatCents: parseEuroToCents(flat), vatRateBp: Math.round(Number(vat.replace(',', '.')) * 100) || 0, roundingMinutes: Number(rounding) },
      ),
    [workers, mode, rate, flat, vat, rounding],
  );
  const euro = (c: number | null) => (c === null ? '—' : formatEuro(c, locale === 'nl' ? 'nl-BE' : 'fr-BE'));
  const canValidate = !options.signature || signature || reason.trim();

  return (
    <form className="stack">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="visitId" value={visitId} />
      <label className="field"><span style={{ color: 'var(--ok)', fontWeight: 600 }}>{t.visit.done}</span><textarea name="done" rows={3} defaultValue={base?.done_text ?? ''} /></label>
      {toOrder.length > 0 && (
        <div className="card pad" style={{ borderColor: 'var(--warn-line)' }}>
          <span className="label" style={{ color: 'var(--warn)' }}>{t.visit.toOrder}</span>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{toOrder.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      <label className="field"><span style={{ color: 'var(--accent)', fontWeight: 600 }}>{t.visit.todo}</span><textarea name="todo" rows={2} defaultValue={base?.todo_text ?? ''} /></label>
      <label className="field">{t.visit.remarks}<textarea name="remarks" rows={2} defaultValue={base?.remarks ?? ''} /></label>

      {options.pricing && (
        <fieldset className="card pad stack">
          <legend className="label">{t.visit.pricing}</legend>
          <div className="choices">
            {([['none', t.visit.pricingNone], ['hourly', t.visit.pricingHourly], ['flat', t.visit.pricingFlat]] as const).map(([m, l]) => (
              <label key={m} className="choice"><input type="radio" name="pricingMode" value={m} checked={mode === m} onChange={() => setMode(m)} /><span>{l}</span></label>
            ))}
          </div>
          {mode === 'hourly' && (
            <div className="grid2">
              <label className="field">{t.visit.rate}<input type="text" inputMode="decimal" name="rate" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
              <label className="field">{t.visit.rounding}
                <select name="rounding" value={rounding} onChange={(e) => setRounding(e.target.value)}>
                  {[1, 5, 10, 15, 30, 60].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            </div>
          )}
          {mode === 'flat' && <label className="field">{t.visit.flat}<input type="text" inputMode="decimal" name="flat" value={flat} onChange={(e) => setFlat(e.target.value)} /></label>}
          {mode !== 'none' && (
            <>
              <label className="field">{t.visit.vat}<input type="text" inputMode="decimal" name="vat" value={vat} onChange={(e) => setVat(e.target.value)} /></label>
              <div className="row small">
                <span className="grow">{t.visit.computed}{mode === 'hourly' ? ` · ${t.visit.billable} ${formatMinutes(price.billableMinutes)}` : ''}</span>
                <b className="num">{euro(price.amountExclCents)} HTVA · {euro(price.amountInclCents)}</b>
              </div>
              {mode === 'hourly' && workers.every((w) => !w.leftAt) && <p className="faint">{t.visit.noWorkerTime}</p>}
            </>
          )}
        </fieldset>
      )}
      {!options.pricing && <input type="hidden" name="pricingMode" value="none" />}

      <fieldset className="card">
        <legend className="label" style={{ padding: '12px 16px 0' }}>{t.visit.recipients}</legend>
        {recipients.map((r) => (
          <label key={r.value} className="check">
            <input type="checkbox" name="recipient" value={r.value} defaultChecked={r.defaultOn} disabled={!r.email} />
            <span className="grow">{r.label}<span className="faint" style={{ display: 'block' }}>{r.email ?? t.visit.recipientNoEmail}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="field">{t.visit.reportLanguage}
        <select name="language" defaultValue={base?.language ?? language}>
          <option value="fr">{t.language.fr}</option>
          <option value="nl">{t.language.nl}</option>
        </select>
      </label>

      {options.signature && (
        <div className="stack">
          <span className="label">{t.visit.signature}</span>
          <SignaturePad onChange={setSignature} labels={{ hint: t.visit.signHere, clear: t.visit.clear }} />
          <input type="hidden" name="signature" value={signature} />
          {!signature && <label className="field">{t.visit.noSignature}<input type="text" name="noSignatureReason" value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
        </div>
      )}
      {!options.signature && <input type="hidden" name="noSignatureReason" value="—" />}

      <p className="faint">{t.visit.recap}</p>
      <button className="btn block" type="submit" formAction={saveReportDraft}>{t.visit.saveDraft}</button>
      <button className="btn primary block" type="submit" formAction={validateReport} disabled={!canValidate}>{t.visit.validateSend}</button>
    </form>
  );
}
