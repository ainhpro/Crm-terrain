/**
 * Formule de l'installation et modules d'un compte. Le profil d'écran (commercial, technicien, les deux)
 * est une préférence de l'utilisateur, limitée par les modules que le compte a achetés (cahier § 6 ter).
 */

export type Formule = 'complete' | 'technicien';
export type Profile = 'commercial' | 'technician' | 'both';

export const PROFILES: readonly Profile[] = ['commercial', 'technician', 'both'];

export const isFormule = (v: unknown): v is Formule => v === 'complete' || v === 'technicien';
export const isProfile = (v: unknown): v is Profile => PROFILES.includes(v as Profile);

/** Profils d'écran permis par les modules du compte. */
export function profilesFor(modules: readonly string[]): Profile[] {
  const crm = modules.includes('crm');
  const tech = modules.includes('interventions');
  if (crm && tech) return [...PROFILES];
  if (tech) return ['technician'];
  if (crm) return ['commercial'];
  return [];
}

/** Profil affiché : la préférence, ramenée à ce que le compte permet (« les deux » sans CRM → technicien). */
export function effectiveProfile(preferred: Profile, modules: readonly string[]): Profile {
  const allowed = profilesFor(modules);
  return allowed.includes(preferred) ? preferred : (allowed[0] ?? preferred);
}
