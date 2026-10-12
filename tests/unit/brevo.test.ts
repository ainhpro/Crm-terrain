import { describe, expect, it } from 'vitest';
import { type OutgoingEmail, sendWithBrevo } from '../../src/server/brevo';

const mail: OutgoingEmail = {
  to: { email: 'bureau@client.be', name: 'Bureau' },
  from: { email: 'envoi@crm.be', name: 'Société' },
  replyTo: { email: 'contact@societe.be' },
  subject: 'Ticket 2026-0512 — SAV',
  text: 'Fait : joint remplacé.',
  attachments: [{ name: 'rapport-v1.pdf', content: new Uint8Array([37, 80, 68, 70]) }],
  key: 'report:abc:addr:1',
};
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const thrown = (code: string, name = 'TypeError') =>
  (async () => { throw Object.assign(new Error('fetch failed'), { name, cause: { code } }); }) as unknown as typeof fetch;

describe('Brevo : envoi et classement des réponses', () => {
  it('construit la demande : expéditeur, réponse, pièce jointe en base64, clé de l’opération', async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ messageId: '<m1@brevo>' }), { status: 201 });
    }) as unknown as typeof fetch;
    expect(await sendWithBrevo({ apiKey: 'cle', fetch: f }, mail)).toEqual({ kind: 'sent', providerId: '<m1@brevo>' });
    const body = JSON.parse(String(sent!.init.body));
    expect(sent!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((sent!.init.headers as Record<string, string>)['api-key']).toBe('cle');
    expect(body).toMatchObject({
      sender: { email: 'envoi@crm.be', name: 'Société' },
      to: [{ email: 'bureau@client.be', name: 'Bureau' }],
      replyTo: { email: 'contact@societe.be' },
      attachment: [{ name: 'rapport-v1.pdf', content: 'JVBERg==' }],
      headers: { 'X-Mailin-custom': 'report:abc:addr:1' },
    });
  });

  it('refus certain → failed ; trop de demandes → retry ; erreur Brevo → uncertain', async () => {
    expect((await sendWithBrevo({ apiKey: 'k', fetch: reply(400, { code: 'invalid_parameter' }) }, mail)).kind).toBe('failed');
    expect((await sendWithBrevo({ apiKey: 'k', fetch: reply(401, {}) }, mail)).kind).toBe('failed');
    expect((await sendWithBrevo({ apiKey: 'k', fetch: reply(429, {}) }, mail)).kind).toBe('retry');
    expect((await sendWithBrevo({ apiKey: 'k', fetch: reply(502, {}) }, mail)).kind).toBe('uncertain');
    expect((await sendWithBrevo({ apiKey: 'k', fetch: reply(201, {}) }, mail)).kind).toBe('uncertain'); // accepté sans identifiant : on ne sait pas
  });

  it('réseau : injoignable → retry (rien n’est parti) ; coupure ou délai → uncertain', async () => {
    expect(await sendWithBrevo({ apiKey: 'k', fetch: thrown('ECONNREFUSED') }, mail)).toEqual({ kind: 'retry', error: 'ECONNREFUSED' });
    expect((await sendWithBrevo({ apiKey: 'k', fetch: thrown('ENOTFOUND') }, mail)).kind).toBe('retry');
    expect((await sendWithBrevo({ apiKey: 'k', fetch: thrown('ECONNRESET') }, mail)).kind).toBe('uncertain');
    const timeout = (async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }) as unknown as typeof fetch;
    expect((await sendWithBrevo({ apiKey: 'k', fetch: timeout }, mail)).kind).toBe('uncertain');
  });
});

describe('configuration Brevo', () => {
  it('rien sans clé et adresse d’expédition ; l’API ne peut viser que Brevo ou un service de test local', async () => {
    const { brevoConfig } = await import('../../src/server/config');
    expect(brevoConfig({ BREVO_API_KEY: 'k' })).toBeNull();
    expect(brevoConfig({ BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'envoi@crm.be' })?.apiUrl).toBe('https://api.brevo.com');
    expect(brevoConfig({ BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'e@x.be', BREVO_API_URL: 'http://localhost:54402' })?.apiUrl).toBe('http://localhost:54402');
    expect(() => brevoConfig({ BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'e@x.be', BREVO_API_URL: 'https://evil.example' })).toThrow();
  });
});
