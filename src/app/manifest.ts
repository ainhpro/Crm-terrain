import type { MetadataRoute } from 'next';
import { getMessages } from '@/i18n';
import { brand } from '@/server/formule';

// Rend l'application installable sur le téléphone (PWA), sous le nom du produit de la formule
// (lue à chaque demande, pas figée à la compilation).
export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { name } = await brand(getMessages('fr'));
  return {
    name,
    short_name: name,
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F6F8',
    theme_color: '#1849A9',
    icons: [],
  };
}
