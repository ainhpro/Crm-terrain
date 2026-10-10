import type { MetadataRoute } from 'next';

// Rend l'application installable sur le téléphone (PWA).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CRM terrain',
    short_name: 'CRM terrain',
    start_url: '/',
    display: 'standalone',
    background_color: '#EEF2F7',
    theme_color: '#0A0A0A',
    icons: [],
  };
}
