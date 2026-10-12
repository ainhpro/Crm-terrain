'use client';

import { useActionState } from 'react';
import type { Messages } from '@/i18n/messages/fr';
import { previewReprise, runReprise } from '@/server/actions/reprise';

/** Coller la sauvegarde (ou choisir le fichier), voir le bilan, puis reprendre. */
export function RepriseFlow({ t }: { t: Messages['reprise'] }) {
  const [preview, read, pending] = useActionState(previewReprise, null);
  return (
    <div className="stack">
      <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>{t.how1}</li>
        <li>{t.how2}</li>
        <li>{t.how3}</li>
      </ol>
      <form action={read} className="stack">
        <label className="field">{t.paste}<textarea name="backup" id="backup" rows={6} placeholder='{"entries":[…]}' /></label>
        <label className="field">{t.orFile}<input type="file" name="file" accept=".json,.txt,application/json,text/plain" /></label>
        <button className="btn block" type="submit" disabled={pending}>{t.read}</button>
      </form>
      {preview?.error && <p className="note bad" role="alert">{t.errors[preview.error]}</p>}
      {preview && !preview.error && (
        <form action={runReprise} className="stack">
          <input type="hidden" name="json" value={preview.json} />
          <h2>{t.summary}</h2>
          <div className="stats">
            <div className="stat"><b>{preview.entries}</b>{t.entries}</div>
            <div className="stat"><b>{preview.clients}</b>{t.clients}</div>
            <div className="stat"><b>{preview.deals}</b>{t.deals}</div>
          </div>
          <p className="small">
            {Object.entries(preview.byGroup ?? {}).map(([g, n]) => `${g} : ${n}`).join(' · ')}
            {preview.pipelines?.length ? ` — ${t.pipelines} : ${preview.pipelines.join(', ')}` : ''}
          </p>
          {(preview.withIssues ?? 0) > 0 && (
            <div className="card table-wrap">
              <p className="note warn" style={{ margin: 8 }}>{t.issuesLead.replace('{n}', String(preview.withIssues))}</p>
              <table>
                <tbody>
                  {preview.issues?.map((i) => (
                    <tr key={i.id}><td className="num">#{i.id}</td><td>{i.label}</td><td>{i.problems.join(' · ')}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="faint">{t.again}</p>
          <button className="btn primary block" type="submit">{t.run.replace('{n}', String(preview.entries))}</button>
        </form>
      )}
    </div>
  );
}
