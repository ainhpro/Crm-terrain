import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { OutgoingEmail, SendOutcome } from '../../src/server/brevo';
import { addMember, asUser, connect, createOrg, createUser, sqlState } from './helpers';

// Traitement d'envoi (relecture D03) : jamais deux envois d'une même opération sans le savoir.

let db: pg.Client;
let alice: string;
let bob: string;
let org: string;
let caseId: string;
let processOutbox: typeof import('../../src/server/outbox').processOutbox;
const SENDER = { email: 'envoi@crm.test' };

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@e.test');
  bob = await createUser(db, 'bob@e.test');
  org = await createOrg(db, alice, 'Envois');
  await addMember(db, alice, org, bob, 'bob@e.test');
  caseId = await asUser(db, alice, async (q) => {
    const client = (await q(`insert into clients (organization_id, name) values ($1, 'Client') returning id`, [org])).rows[0].id;
    const type = (await q(`insert into intervention_types (organization_id, name, kind) values ($1, 'SAV', 'sav') returning id`, [org])).rows[0].id;
    return (await q(`insert into service_cases (organization_id, type_id, client_id, problem) values ($1, $2, $3, 'x') returning id`, [org, type, client])).rows[0].id as string;
  }, { commit: true });
  process.env.DATABASE_URL = inject('testDbUrl');
  (globalThis as unknown as { crmPool?: pg.Pool }).crmPool = new pg.Pool({ connectionString: inject('testDbUrl'), max: 6 });
  ({ processOutbox } = await import('../../src/server/outbox'));
});

afterAll(async () => {
  await (globalThis as unknown as { crmPool: pg.Pool }).crmPool.end();
  await db.end();
});

let n = 0;
async function queue(count: number, email: string | null = 'bureau@d.test'): Promise<string[]> {
  return asUser(db, bob, async (q) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push((await q(
        `insert into outbound_messages (organization_id, case_id, kind, recipient_label, recipient_email, subject, body, idempotency_key)
         values ($1, $2, 'part_order', 'Bureau', $3, 'Commande', 'Joint x 1', $4) returning id`,
        [org, caseId, email, `test:${++n}`],
      )).rows[0].id);
    }
    return ids;
  }, { commit: true });
}
const status = async (ids: string[]) => (await db.query(`select id, status, attempts, last_error, provider_message_id from outbound_messages where id = any($1::uuid[]) order by created_at`, [ids])).rows;
const clean = () => db.query(`update outbound_messages set status = 'failed', locked_until = null where status in ('queued', 'sending')`);

function provider(answer: (mail: OutgoingEmail) => SendOutcome | Promise<SendOutcome>) {
  const calls: string[] = [];
  const send = async (mail: OutgoingEmail) => {
    calls.push(mail.key);
    return answer(mail);
  };
  return { send, calls };
}

describe('droits sur la file d’envoi', () => {
  it('un membre met en file un message neuf, mais ne peut ni fabriquer un « envoyé » ni changer un état', async () => {
    const fake = asUser(db, bob, (q) => q(
      `insert into outbound_messages (organization_id, case_id, kind, recipient_label, idempotency_key, status, sent_at) values ($1, $2, 'part_order', 'x', 'faux', 'sent', now())`,
      [org, caseId],
    ));
    expect(await sqlState(fake)).toBe('42501');
    const [id] = await queue(1);
    expect(await sqlState(asUser(db, bob, (q) => q(`update outbound_messages set status = 'sent' where id = $1`, [id])))).toBe('42501');
    await clean();
  });
});

describe('traitement', () => {
  it('envoie, garde l’identifiant Brevo, ne renvoie pas au passage suivant', async () => {
    const ids = await queue(2);
    const p = provider((m) => ({ kind: 'sent', providerId: `<${m.key}@brevo>` }));
    const r = await processOutbox(p.send, { sender: SENDER });
    expect(r.sent).toBe(2);
    expect((await status(ids)).map((s) => [s.status, s.provider_message_id])).toEqual([
      ['sent', `<${p.calls[0]}@brevo>`],
      ['sent', `<${p.calls[1]}@brevo>`],
    ]);
    await processOutbox(p.send, { sender: SENDER });
    expect(p.calls.length).toBe(2);
  });

  it('deux traitements en même temps : chaque message part une seule fois', async () => {
    const ids = await queue(12);
    const p = provider(async (m) => {
      await new Promise((r) => setTimeout(r, 15));
      return { kind: 'sent', providerId: m.key };
    });
    await Promise.all([processOutbox(p.send, { sender: SENDER, limit: 8 }), processOutbox(p.send, { sender: SENDER, limit: 8 }), processOutbox(p.send, { sender: SENDER, limit: 8 })]);
    expect(new Set(p.calls).size).toBe(p.calls.length);
    expect((await status(ids)).every((s) => s.status === 'sent')).toBe(true);
    expect(p.calls.length).toBe(12);
  });

  it('traitement interrompu après l’acceptation par Brevo : « à vérifier », jamais renvoyé d’office', async () => {
    const [id] = await queue(1);
    // Le traitement a pris le message puis s'est arrêté avant d'enregistrer le résultat.
    await db.query(`update outbound_messages set status = 'sending', attempts = 1, locked_until = now() - interval '1 minute' where id = $1`, [id]);
    const p = provider(() => ({ kind: 'sent', providerId: 'x' }));
    const r = await processOutbox(p.send, { sender: SENDER });
    expect(r.expired).toBe(1);
    expect(p.calls).toEqual([]);
    const [s] = await status([id!]);
    expect(s.status).toBe('uncertain');
    expect(s.last_error).toMatch(/vérifier/);
    await processOutbox(p.send, { sender: SENDER });
    expect(p.calls).toEqual([]);
  });

  it('réponse incertaine (coupure, délai) : « à vérifier », pas de nouvel essai', async () => {
    const [id] = await queue(1);
    const p = provider(() => ({ kind: 'uncertain', error: 'ECONNRESET' }));
    await processOutbox(p.send, { sender: SENDER });
    await processOutbox(p.send, { sender: SENDER });
    expect(p.calls.length).toBe(1);
    expect((await status([id!]))[0].status).toBe('uncertain');
  });

  it('refus certain : échec visible ; rien n’est parti : réessai, au plus 5 tentatives', async () => {
    const [refused] = await queue(1);
    await processOutbox(provider(() => ({ kind: 'failed', error: 'HTTP 400 invalid email' })).send, { sender: SENDER });
    expect((await status([refused!]))[0]).toMatchObject({ status: 'failed', last_error: 'HTTP 400 invalid email' });

    const [down] = await queue(1);
    const p = provider(() => ({ kind: 'retry', error: 'ECONNREFUSED' }));
    for (let i = 0; i < 7; i++) await processOutbox(p.send, { sender: SENDER });
    expect(p.calls.length).toBe(5);
    expect((await status([down!]))[0]).toMatchObject({ status: 'failed', attempts: 5 });
  });

  it('sans adresse : échec immédiat, aucun appel', async () => {
    const [id] = await queue(1, null);
    const p = provider(() => ({ kind: 'sent', providerId: 'x' }));
    await processOutbox(p.send, { sender: SENDER });
    expect(p.calls).toEqual([]);
    expect((await status([id!]))[0]).toMatchObject({ status: 'failed', last_error: 'adresse email manquante' });
  });

  it('l’email part au nom de l’entreprise du message, avec sa clé', async () => {
    await db.query(`update organizations set company_name = 'Société Envois', email = 'contact@envois.test' where id = $1`, [org]);
    await queue(1);
    let seen: OutgoingEmail | null = null;
    await processOutbox(async (m) => { seen = m; return { kind: 'sent', providerId: 'x' }; }, { sender: SENDER });
    expect(seen).toMatchObject({ from: { email: 'envoi@crm.test', name: 'Société Envois' }, replyTo: { email: 'contact@envois.test' }, to: { email: 'bureau@d.test' } });
    expect(seen!.key).toMatch(/^test:/);
  });
});
