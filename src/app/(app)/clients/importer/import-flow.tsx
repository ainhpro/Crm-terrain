'use client';

import { useActionState, useMemo, useState } from 'react';
import type { Messages } from '@/i18n/messages/fr';
import { buildImport, type Mapping, TARGET_FIELDS, type TargetField } from '@/modules/crm/import/columns';
import { readImportFile, runImport } from '@/server/actions/crm';

/** Import en trois temps : lire le fichier, ajuster la correspondance, vérifier le bilan complet, importer. */
export function ImportFlow({ t, fields, common }: { t: Messages['import']; fields: Messages['clients']; common: Messages['common'] }) {
  const [preview, read, pending] = useActionState(readImportFile, null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const current = mapping ?? preview?.mapping ?? [];
  const label: Record<TargetField, string> = {
    name: fields.name, group: fields.group, address: fields.address, postalCode: fields.postalCode, city: fields.city,
    contact: fields.contact, phone: fields.phone, email: fields.email, category: fields.category, notes: fields.notes,
  };

  // Le bilan est recalculé ici à chaque changement de correspondance ; le serveur le refait à l'import.
  const report = useMemo(() => {
    if (!preview?.rows.length) return null;
    try {
      return { ok: buildImport(preview.rows, current, new Set(preview.existing)) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [preview, current]);

  return (
    <div className="stack">
      <form action={(fd) => { setMapping(null); read(fd); }} className="stack">
        <label className="field">
          {t.chooseFile}
          <input type="file" name="file" id="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
        </label>
        <button className="btn" type="submit" disabled={pending}>{t.read}</button>
      </form>
      {preview?.error && <p className="note bad" role="alert">{t[preview.error as 'unreadable' | 'unsupported' | 'tooLarge'] ?? common.error}</p>}

      {preview && !preview.error && (
        <>
          <h2>{t.mappingTitle}</h2>
          <p className="faint">{t.mappingHint}</p>
          <div className="card">
            {preview.headers.map((h, i) => (
              <label key={i} className="check">
                <span className="grow">{t.column} « {h || '—'} »</span>
                <select
                  style={{ maxWidth: 200 }}
                  value={current[i] ?? ''}
                  onChange={(e) => {
                    const next = [...current];
                    next[i] = (e.target.value || null) as TargetField | null;
                    setMapping(next);
                  }}
                >
                  <option value="">{t.ignore}</option>
                  {TARGET_FIELDS.map((f) => <option key={f} value={f}>{label[f]}</option>)}
                </select>
              </label>
            ))}
          </div>

          <h2>{t.reportTitle}</h2>
          {report && 'error' in report ? (
            <p className="note bad">{t.noName}</p>
          ) : report ? (
            <>
              <div className="stats">
                <div className="stat"><b>{report.ok.rows.length}</b>{t.rows}</div>
                <div className="stat"><b>{report.ok.valid}</b>{t.valid}</div>
                <div className={`stat${report.ok.withIssues + report.ok.duplicates ? ' bad' : ''}`}><b>{report.ok.withIssues + report.ok.duplicates}</b>{t.withIssues} / {t.duplicates}</div>
              </div>
              {report.ok.rows.some((r) => r.issues.length || r.duplicateOf !== null) && (
                <div className="card table-wrap">
                  <table>
                    <thead><tr><th>{t.line}</th><th>{fields.name}</th><th>{t.reportTitle}</th></tr></thead>
                    <tbody>
                      {report.ok.rows.filter((r) => r.issues.length || r.duplicateOf !== null).slice(0, 200).map((r) => (
                        <tr key={r.line}>
                          <td className="num">{r.line}</td>
                          <td>{r.values.name ?? '—'}</td>
                          <td>{[...r.issues, r.duplicateOf === 'existing' ? t.duplicateExisting : r.duplicateOf ? `${t.duplicateOf} ${r.duplicateOf}` : ''].filter(Boolean).join(' · ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <form action={runImport}>
                <input type="hidden" name="rows" value={JSON.stringify(preview.rows)} />
                <input type="hidden" name="mapping" value={JSON.stringify(current)} />
                <button className="btn primary block" type="submit" disabled={report.ok.valid === 0}>{t.importN} ({report.ok.valid})</button>
              </form>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
