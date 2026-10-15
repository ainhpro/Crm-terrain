import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { getServerMessages } from '@/i18n/server';
import { brand } from '@/server/formule';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerMessages();
  const { name, tagline } = await brand(t);
  return { title: name, description: tagline };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1849A9',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getServerMessages();
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
