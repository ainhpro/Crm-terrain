import { LOCALES } from '@/i18n';
import { getServerMessages } from '@/i18n/server';
import { setLocale } from './actions';

export default async function HomePage() {
  const { locale, t } = await getServerMessages();

  return (
    <main className="page">
      <header className="hdr">
        <span className="hdr-title">{t.app.name}</span>
        <form action={setLocale} className="lang">
          {LOCALES.map((l) => (
            <button key={l} name="locale" value={l} aria-pressed={l === locale} aria-label={t.language[l]}>
              {l.toUpperCase()}
            </button>
          ))}
        </form>
      </header>
      <section className="content">
        <h1>{t.home.title}</h1>
        <p className="muted">{t.app.tagline}</p>
        <p>{t.home.comingSoon}</p>
      </section>
    </main>
  );
}
