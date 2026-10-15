import { describe, expect, it } from 'vitest';
import { effectiveProfile, isFormule, profilesFor } from './formule';

describe('formule et profils', () => {
  it('les profils suivent les modules du compte', () => {
    expect(profilesFor(['crm', 'interventions'])).toEqual(['commercial', 'technician', 'both']);
    expect(profilesFor(['interventions'])).toEqual(['technician']);
    expect(profilesFor(['crm'])).toEqual(['commercial']);
    expect(profilesFor([])).toEqual([]);
  });

  it('un compte technicien reste technicien, quelle que soit la préférence enregistrée', () => {
    for (const p of ['commercial', 'technician', 'both'] as const) expect(effectiveProfile(p, ['interventions'])).toBe('technician');
    expect(effectiveProfile('both', ['crm'])).toBe('commercial');
  });

  it('un compte complet garde la préférence de l’utilisateur', () => {
    for (const p of ['commercial', 'technician', 'both'] as const) expect(effectiveProfile(p, ['crm', 'interventions'])).toBe(p);
  });

  it('seules deux formules existent', () => {
    expect(isFormule('technicien')).toBe(true);
    expect(isFormule('complete')).toBe(true);
    expect(isFormule('technician')).toBe(false);
    expect(isFormule(null)).toBe(false);
  });
});
