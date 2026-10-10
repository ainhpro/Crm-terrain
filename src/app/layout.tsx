import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { getServerMessages } from '@/i18n/server';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerMessages();
  return { title: t.app.name, description: t.app.tagline };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0A0A0A',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getServerMessages();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
