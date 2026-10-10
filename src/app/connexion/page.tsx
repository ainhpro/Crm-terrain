import { Flash } from '@/components';
import { getServerMessages } from '@/i18n/server';
import { devLogin } from '@/server/actions/auth';
import { devAuthEnabled } from '@/server/session';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { t } = await getServerMessages();
  const { erreur } = await searchParams;
  const enabled = devAuthEnabled();
  return (
    <main className="shell">
      <div className="page" style={{ justifyContent: 'center', maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <div className="brand">
          <i>C</i>
          {t.app.name}
        </div>
        <h1>{t.auth.title}</h1>
        <p className="muted">{t.app.tagline}</p>
        {erreur && <Flash kind="bad">{erreur === 'disabled' ? t.auth.disabled : t.common.error}</Flash>}
        {enabled ? (
          <form action={devLogin} className="stack">
            <label className="field">
              {t.auth.email}
              <input type="email" name="email" id="email" required autoComplete="email" placeholder="fabrice@demo.local" />
            </label>
            <button className="btn primary block" type="submit">
              {t.auth.submit}
            </button>
            <p className="faint">{t.auth.devNote}</p>
          </form>
        ) : (
          <Flash kind="warn">{t.auth.disabled}</Flash>
        )}
      </div>
    </main>
  );
}
