'use server';

import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE } from '@/i18n';

export async function setLocale(formData: FormData) {
  const locale = formData.get('locale');
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
}
