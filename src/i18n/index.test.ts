import { describe, expect, it } from 'vitest';
import fr from './messages/fr';
import nl from './messages/nl';
import { resolveLocale } from '.';

function leafKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? leafKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('dictionnaires', () => {
  it('nl contient exactement les mêmes clés que fr', () => {
    expect(leafKeys(nl).sort()).toEqual(leafKeys(fr).sort());
  });

  it('aucune traduction vide', () => {
    for (const dict of [fr, nl]) {
      const values = leafKeys(dict).map((k) => k.split('.').reduce<any>((o, p) => o[p], dict));
      expect(values.every((v) => typeof v === 'string' && v.trim().length > 0)).toBe(true);
    }
  });
});

describe('resolveLocale', () => {
  it('le cookie gagne', () => {
    expect(resolveLocale('nl', 'fr-BE')).toBe('nl');
  });
  it("suit l'ordre de préférence du navigateur", () => {
    expect(resolveLocale(undefined, 'nl-BE,nl;q=0.9,fr;q=0.8')).toBe('nl');
    expect(resolveLocale(undefined, 'en-US,en;q=0.9,nl;q=0.5,fr;q=0.7')).toBe('fr');
  });
  it('ignore une langue refusée (q=0) ou une pondération invalide', () => {
    expect(resolveLocale(undefined, 'nl;q=0, fr;q=0.5')).toBe('fr');
    expect(resolveLocale(undefined, 'nl;q=2, fr;q=0.5')).toBe('fr');
  });
  it('français par défaut', () => {
    expect(resolveLocale(undefined, null)).toBe('fr');
    expect(resolveLocale('de', 'de-DE')).toBe('fr');
  });
});
