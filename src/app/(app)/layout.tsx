import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Icon } from '@/components';
import { LOCALES } from '@/i18n';
import { setLocale } from '@/app/actions';
import { isCommercial, isTechnician, requireCtx } from '@/server/context';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx();
  const { t } = ctx;
  const path = (await headers()).get('x-pathname') ?? '';
  const current = (href: string) => (href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined;
  const micHref = isTechnician(ctx) && !isCommercial(ctx) ? '/interventions' : '/clients';
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <i>C</i>
          {ctx.orgName}
        </span>
        <form action={setLocale} className="lang">
          {LOCALES.map((l) => (
            <button key={l} name="locale" value={l} aria-pressed={l === ctx.locale} aria-label={t.language[l]}>
              {l.toUpperCase()}
            </button>
          ))}
        </form>
      </header>
      {children}
      <nav className="bottom-nav" aria-label="Navigation">
        <div className="inner">
          <a href="/" aria-current={current('/')}>
            <Icon name="home" />
            {t.nav.today}
          </a>
          {isCommercial(ctx) ? (
            <a href="/clients" aria-current={current('/clients')}>
              <Icon name="users" />
              {t.nav.clients}
            </a>
          ) : (
            <span />
          )}
          <a href={micHref} className="mic" aria-label={t.nav.record}>
            <Icon name="mic" size={26} />
            <span>{t.nav.record}</span>
          </a>
          {isTechnician(ctx) ? (
            <a href="/interventions" aria-current={current('/interventions')}>
              <Icon name="tool" />
              {t.nav.interventions}
            </a>
          ) : (
            <span />
          )}
          <a href="/reglages" aria-current={current('/reglages')}>
            <Icon name="gear" />
            {t.nav.settings}
          </a>
        </div>
      </nav>
    </div>
  );
}
