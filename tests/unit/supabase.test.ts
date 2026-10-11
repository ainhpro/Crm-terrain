import { describe, expect, it } from 'vitest';
import { appUrl, authMode, storageMode, supabaseConfig } from '../../src/server/config';
import { sslOptions } from '../../src/server/db';
import { decodeSession, encodeSession } from '../../src/server/session-token';
import { AuthError, sendLoginEmail, verifyCode, verifyLink } from '../../src/server/supabase/auth';
import { downloadObject, uploadObject } from '../../src/server/supabase/storage';

const SECRET = 'x'.repeat(40);
const USER = '11111111-1111-4111-8111-111111111111';
const SUPA = { SUPABASE_URL: 'https://abcd1234.supabase.co', SUPABASE_ANON_KEY: 'anon' };

describe('session signée', () => {
  it('un jeton n’est accepté que dans son mode', () => {
    const dev = encodeSession('d', USER, SECRET);
    expect(decodeSession(dev, SECRET, ['d'])).toBe(USER);
    expect(decodeSession(dev, SECRET, ['s'])).toBeNull(); // un jeton de développement ne vaut rien avec Supabase
    expect(decodeSession(encodeSession('s', USER, SECRET), SECRET, ['s'])).toBe(USER);
  });

  it('refuse un jeton modifié, d’un autre secret, ou l’ancien format', () => {
    const tok = encodeSession('s', USER, SECRET);
    expect(decodeSession(tok.replace('11111111-', '22222222-'), SECRET, ['s'])).toBeNull();
    expect(decodeSession(tok.replace('s.', 'd.'), SECRET, ['d'])).toBeNull();
    expect(decodeSession(tok, 'y'.repeat(40), ['s'])).toBeNull();
    expect(decodeSession(`${USER}.abc`, SECRET, ['s', 'd'])).toBeNull();
    expect(decodeSession(undefined, SECRET, ['s'])).toBeNull();
  });
});

describe('mode de connexion et de stockage', () => {
  it('Supabase configuré : seule la connexion vérifiée, même si AUTH_MODE=dev traîne', () => {
    expect(authMode({ ...SUPA, AUTH_MODE: 'dev' })).toBe('supabase');
  });
  it('développement seulement sur un poste de développement', () => {
    expect(authMode({ AUTH_MODE: 'dev' })).toBe('dev');
    expect(authMode({ AUTH_MODE: 'dev', NODE_ENV: 'production' })).toBe('none');
    expect(authMode({ AUTH_MODE: 'dev', VERCEL: '1' })).toBe('none');
    expect(authMode({})).toBe('none');
  });
  it('stockage Supabase seulement avec la clé serveur', () => {
    expect(storageMode(SUPA)).toBe('local');
    expect(storageMode({ ...SUPA, SUPABASE_SERVICE_ROLE_KEY: 'k' })).toBe('supabase');
    expect(supabaseConfig({ ...SUPA, SUPABASE_SERVICE_ROLE_KEY: 'k' })?.bucket).toBe('fichiers');
  });
  it('refuse une adresse Supabase douteuse', () => {
    expect(() => supabaseConfig({ ...SUPA, SUPABASE_URL: 'https://evil.example.com' })).toThrow();
    expect(appUrl({ APP_URL: 'https://crm.example.be/' })).toBe('https://crm.example.be');
  });
});

describe('TLS vers la base', () => {
  const remote = 'postgres://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
  it('base locale sans TLS ; distante vérifiée avec l’autorité fournie', () => {
    expect(sslOptions('postgres://postgres@localhost:54322/crm', {})).toBeUndefined();
    expect(sslOptions(remote, { DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----' })).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----', rejectUnauthorized: true,
    });
  });
  it('en production, une base distante non vérifiée est refusée', () => {
    expect(() => sslOptions(remote, { NODE_ENV: 'production' })).toThrow(/DATABASE_SSL_CA/);
  });
});

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Record<string, { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find((k) => url.includes(k));
    const r = key ? responses[key]! : { status: 404, body: {} };
    return new Response((r.body instanceof Uint8Array ? new Blob([r.body as Uint8Array<ArrayBuffer>]) : JSON.stringify(r.body)) as BodyInit, { status: r.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('Supabase Auth (serveur)', () => {
  const user = { id: USER, email: 'fabrice@exemple.be', email_confirmed_at: '2026-10-11T08:00:00Z' };

  it('envoie l’email de connexion avec la clé publique, adresse normalisée', async () => {
    const { f, calls } = fakeFetch({ '/auth/v1/otp': { status: 200, body: {} } });
    await sendLoginEmail({ url: 'https://p.supabase.co', anonKey: 'anon', fetch: f }, '  Fabrice@Exemple.be ');
    expect(calls[0]!.url).toBe('https://p.supabase.co/auth/v1/otp');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'fabrice@exemple.be', create_user: true });
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe('anon');
  });

  it('code valide : identité vérifiée, puis la session Supabase est refermée', async () => {
    const { f, calls } = fakeFetch({ '/auth/v1/verify': { status: 200, body: { access_token: 'jwt', user } }, '/auth/v1/logout': { status: 204, body: {} } });
    expect(await verifyCode({ url: 'https://p.supabase.co', anonKey: 'anon', fetch: f }, 'fabrice@exemple.be', '123 456')).toEqual({ id: USER, email: user.email });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ type: 'email', email: 'fabrice@exemple.be', token: '123456' });
    expect(calls[1]!.url).toContain('/auth/v1/logout');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt');
  });

  it('lien : vérifie le token_hash ; refuse un compte non confirmé', async () => {
    const ok = fakeFetch({ '/auth/v1/verify': { status: 200, body: { user } } });
    expect((await verifyLink({ url: 'https://p.supabase.co', anonKey: 'anon', fetch: ok.f }, 'pkce_abcdef123456')).id).toBe(USER);
    const unconfirmed = fakeFetch({ '/auth/v1/verify': { status: 200, body: { user: { ...user, email_confirmed_at: null } } } });
    await expect(verifyLink({ url: 'https://p.supabase.co', anonKey: 'anon', fetch: unconfirmed.f }, 'pkce_abcdef123456')).rejects.toBeInstanceOf(AuthError);
  });

  it('erreurs traduites : trop de demandes, expiré, invalide, service absent', async () => {
    const cfg = (status: number, body: unknown) => ({ url: 'https://p.supabase.co', anonKey: 'anon', fetch: fakeFetch({ '/auth/v1/': { status, body } }).f });
    await expect(sendLoginEmail(cfg(429, { error_code: 'over_email_send_rate_limit' }), 'a@b.be')).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(verifyCode(cfg(403, { error_code: 'otp_expired' }), 'a@b.be', '123456')).rejects.toMatchObject({ code: 'expired' });
    await expect(verifyCode(cfg(400, { error_code: 'bad_code' }), 'a@b.be', '123456')).rejects.toMatchObject({ code: 'invalid' });
    await expect(verifyCode(cfg(500, {}), 'a@b.be', '123456')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(verifyCode(cfg(200, {}), 'a@b.be', 'abc')).rejects.toMatchObject({ code: 'invalid' }); // rien n'est envoyé
    const down = { url: 'https://p.supabase.co', anonKey: 'anon', fetch: (async () => { throw new Error('réseau'); }) as unknown as typeof fetch };
    await expect(sendLoginEmail(down, 'a@b.be')).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('Supabase Storage (serveur)', () => {
  const path = `${USER}/22222222-2222-4222-8222-222222222222.pdf`;
  it('dépose sans écraser, avec la clé serveur, dans le bucket privé', async () => {
    const { f, calls } = fakeFetch({ '/storage/v1/object/fichiers/': { status: 200, body: {} } });
    await uploadObject({ url: 'https://p.supabase.co', serviceRoleKey: 'srv', bucket: 'fichiers', fetch: f }, path, new Uint8Array([1, 2]), 'application/pdf');
    expect(calls[0]!.url).toBe(`https://p.supabase.co/storage/v1/object/fichiers/${path}`);
    const h = calls[0]!.init.headers as Record<string, string>;
    expect([h['x-upsert'], h.authorization, h['content-type']]).toEqual(['false', 'Bearer srv', 'application/pdf']);
  });
  it('relit le fichier ; refuse un chemin qui sort du compte', async () => {
    const { f } = fakeFetch({ '/storage/v1/object/fichiers/': { status: 200, body: new Uint8Array([7, 8, 9]) } });
    const cfg = { url: 'https://p.supabase.co', serviceRoleKey: 'srv', bucket: 'fichiers', fetch: f };
    expect([...(await downloadObject(cfg, path))]).toEqual([7, 8, 9]);
    await expect(downloadObject(cfg, '../autre/x.pdf')).rejects.toThrow('invalid_path');
    await expect(downloadObject(cfg, `${USER}/../../x.pdf`)).rejects.toThrow('invalid_path');
  });
});
