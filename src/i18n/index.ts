import fr, { type Messages } from './messages/fr';
import nl from './messages/nl';

export const LOCALES = ['fr', 'nl'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';
export const LOCALE_COOKIE = 'locale';

const DICTIONARIES: Record<Locale, Messages> = { fr, nl };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function getMessages(locale: Locale): Messages {
  return DICTIONARIES[locale];
}

/**
 * Choisit la langue : cookie explicite d'abord, puis l'en-tête Accept-Language du navigateur.
 * « nl-BE », « nl;q=0.9 »… → nl. Tout le reste → français.
 */
export function resolveLocale(cookieValue: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { lang: tag.toLowerCase().split('-')[0], q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((x) => x.lang && !Number.isNaN(x.q))
    .sort((x, y) => y.q - x.q);
  return ranked.map((x) => x.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
