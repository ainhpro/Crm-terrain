import { describe, expect, it } from 'vitest';
import { imapConfig, inboundConfig, receptionScheme } from '../../src/server/config';

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

describe('relève d’une boîte par IMAP', () => {
  const GMAIL = { IMAP_HOST: 'imap.gmail.com', IMAP_USER: 'Sitot.Demandes@gmail.com', IMAP_PASSWORD: 'abcd efgh ijkl mnop' };

  it('Gmail : adresse en minuscules, port 993, espaces du mot de passe d’application retirés', () => {
    expect(imapConfig(GMAIL)).toEqual({ host: 'imap.gmail.com', port: 993, user: 'sitot.demandes@gmail.com', password: 'abcdefghijklmnop' });
  });

  it('connexion chiffrée obligatoire hors poste local ; adresse complète sans « + »', () => {
    expect(imapConfig({ ...GMAIL, IMAP_PORT: '143' })).toBeNull();
    expect(imapConfig({ IMAP_HOST: 'localhost', IMAP_PORT: '3143', IMAP_USER: 'sitot@localhost.test', IMAP_PASSWORD: 'x' })).toMatchObject({ port: 3143 });
    expect(imapConfig({ ...GMAIL, IMAP_USER: 'sitot' })).toBeNull();
    expect(imapConfig({ ...GMAIL, IMAP_USER: 'sitot+x@gmail.com' })).toBeNull();
    expect(imapConfig({ ...GMAIL, IMAP_PASSWORD: '' })).toBeNull();
  });

  it('adresses affichées : domaine Brevo s’il existe, sinon boîte IMAP', () => {
    expect(receptionScheme(GMAIL)).toEqual({ kind: 'plus', mailbox: 'sitot.demandes@gmail.com' });
    expect(receptionScheme({ ...GMAIL, INBOUND_DOMAIN: 'reception.sitot.be', INBOUND_SECRET: SECRET })).toEqual({ kind: 'domain', domain: 'reception.sitot.be' });
    expect(receptionScheme({})).toBeNull();
  });
});
