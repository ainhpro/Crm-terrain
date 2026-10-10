import type { ReactNode } from 'react';

/** Petits éléments d'interface partagés (sans état). */

export function Icon({ name, size = 22 }: { name: 'home' | 'users' | 'tool' | 'gear' | 'mic' | 'back' | 'plus' | 'chevron' | 'camera' | 'mail'; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    users: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .6 3.2 2.5 3.5 5.5" />
      </>
    ),
    tool: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />,
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </>
    ),
    back: <path d="M15 6l-6 6 6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="M9 6l6 6-6 6" />,
    camera: (
      <>
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="icon-btn" aria-label={label}>
      <Icon name="back" size={18} />
    </a>
  );
}

export function Flash({ kind = 'ok', children }: { kind?: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <p className={`note ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

export function formatDate(iso: string | Date | null | undefined, locale: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }, timeZone = 'Europe/Brussels') {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : iso;
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-BE' : 'fr-BE', { timeZone, ...opts }).format(d);
}

export function formatTime(d: string | Date | null | undefined, locale: string, timeZone = 'Europe/Brussels') {
  if (!d) return '';
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-BE' : 'fr-BE', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(d));
}
