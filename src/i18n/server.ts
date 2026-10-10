import 'server-only';
import { cookies, headers } from 'next/headers';
import { getMessages, LOCALE_COOKIE, resolveLocale, type Locale } from '.';

export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get('accept-language'));
}

export async function getServerMessages() {
  const locale = await getLocale();
  return { locale, t: getMessages(locale) };
}
