import 'server-only';
import type { Messages } from '@/i18n/messages/fr';
import { type Formule, isFormule } from '@/modules/crm/formule';
import { withService } from './db';

let cached: { value: Formule; at: number } | null = null;

/**
 * Formule de l'installation (réglée en base par npm run supabase:setup), gardée une minute en mémoire.
 * Elle ne sert ici qu'à l'affichage (nom du produit, accueil) : les modules d'un compte sont fixés par
 * la base à sa création. Lue avant la connexion, d'où withService (lecture seule, aucune donnée de compte).
 */
export async function deploymentFormule(): Promise<Formule> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  try {
    const f = (await withService((q) => q<{ f: string }>(`select public.deployment_formule() as f`))).rows[0]?.f;
    cached = { value: isFormule(f) ? f : 'complete', at: Date.now() };
    return cached.value;
  } catch {
    return 'complete'; // base injoignable ou migration pas encore appliquée : accroche par défaut
  }
}

/** Nom du produit et accroche de la formule (commerciaux ou techniciens). */
export async function brand(t: Messages): Promise<{ name: string; tagline: string }> {
  return { name: t.app.name, tagline: (await deploymentFormule()) === 'technicien' ? t.app.taglineTechnician : t.app.tagline };
}
