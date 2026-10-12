import type { MetadataRoute } from 'next';

// Rend l'application installable sur le téléphone (PWA).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CRM terrain',
    short_name: 'CRM terrain',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F6F8',
    theme_color: '#1849A9',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
