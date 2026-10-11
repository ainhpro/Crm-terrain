import { Flash } from '@/components';
import { getServerMessages } from '@/i18n/server';
import { devLogin, sendLoginLink, verifyLoginCode } from '@/server/actions/auth';
import { authMode } from '@/server/config';

type Err = 'email' | 'rate_limited' | 'invalid' | 'expired' | 'unavailable' | 'disabled';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erreur?: string; envoye?: string }> }) {
  const { t } = await getServerMessages();
  const { erreur, envoye } = await searchParams;
  const mode = authMode();
  const message = (e: string) =>
    e === 'disabled' ? t.auth.disabled : (t.auth.errors as Record<string, string>)[e as Exclude<Err, 'disabled'>] ?? t.common.error;
  return (
    <main className="shell">
      <div className="page" style={{ justifyContent: 'center', maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <div className="brand">
          <i>C</i>
          {t.app.name}
        </div>
        <h1>{mode === 'supabase' && envoye ? t.auth.sentTitle : t.auth.title}</h1>
        {erreur && <Flash kind="bad">{message(erreur)}</Flash>}

        {mode === 'supabase' && !envoye && (
          <form action={sendLoginLink} className="stack">
            <p className="muted">{t.app.tagline}</p>
            <label className="field">
              {t.auth.email}
              <input type="email" name="email" id="email" required autoComplete="email" inputMode="email" />
            </label>
            <button className="btn primary block" type="submit">{t.auth.sendLink}</button>
            <p className="faint">{t.auth.noPassword}</p>
          </form>
        )}

        {mode === 'supabase' && envoye && (
          <div className="stack">
            <p className="muted">{t.auth.sentLead}</p>
            <form action={verifyLoginCode} className="stack">
              <label className="field">
                {t.auth.code}
                <input type="text" name="code" id="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" maxLength={12} />
              </label>
              <button className="btn primary block" type="submit">{t.auth.verify}</button>
            </form>
            <a className="link" href="/connexion">{t.auth.otherEmail}</a>
          </div>
        )}

        {mode === 'dev' && (
          <form action={devLogin} className="stack">
            <p className="muted">{t.app.tagline}</p>
            <label className="field">
              {t.auth.email}
              <input type="email" name="email" id="email" required autoComplete="email" placeholder="fabrice@demo.local" />
            </label>
            <button className="btn primary block" type="submit">{t.auth.submit}</button>
            <p className="faint">{t.auth.devNote}</p>
          </form>
        )}

        {mode === 'none' && <Flash kind="warn">{t.auth.disabled}</Flash>}
      </div>
    </main>
  );
}
