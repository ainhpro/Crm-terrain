import { describe, expect, it } from 'vitest';
import { inboundConfig } from '../../src/server/config';

const SECRET = 'k'.repeat(32);

describe('réglages de la réception des emails', () => {
  it('rien sans domaine ni clé assez longue', () => {
    expect(inboundConfig({})).toBeNull();
    expect(inboundConfig({ INBOUND_DOMAIN: 'reception.exemple.be' })).toBeNull();
    expect(inboundConfig({ INBOUND_DOMAIN: 'reception.exemple.be', INBOUND_SECRET: 'court' })).toBeNull();
    expect(inboundConfig({ INBOUND_SECRET: SECRET })).toBeNull();
  });

  it('domaine en minuscules, forme d’un vrai nom de domaine', () => {
    expect(inboundConfig({ INBOUND_DOMAIN: ' Reception.Exemple.BE ', INBOUND_SECRET: SECRET })).toEqual({ domain: 'reception.exemple.be', secret: SECRET });
    expect(inboundConfig({ INBOUND_DOMAIN: 'http://exemple.be', INBOUND_SECRET: SECRET })).toBeNull();
    expect(inboundConfig({ INBOUND_DOMAIN: 'exemple', INBOUND_SECRET: SECRET })).toBeNull();
    expect(inboundConfig({ INBOUND_DOMAIN: 'a@exemple.be', INBOUND_SECRET: SECRET })).toBeNull();
  });
});
