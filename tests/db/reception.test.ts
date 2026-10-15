import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { asUser, connect, createOrg, createUser, sqlState } from './helpers';

// Migration 20261018000001 et traitement « réception d'emails » : le compte est celui de l'adresse de
// réception, jamais celui du ticket ou de l'expéditeur (cahier § 6 ter).

const DOMAIN = 'reception.test.be';
let db: pg.Client;
let alice: string;
let bob: string;
let orgA: string;
let orgB: string;
let tokenA: string;
let tokenB: string;
let caseA: string;
let receiveInbound: typeof import('../../src/server/reception').receiveInbound;

async function makeCase(owner: string, org: string, ticket: string): Promise<string> {
  return asUser(db, owner, async (q) => {
    const client = (await q(`insert into clients (organization_id, name) values ($1, 'Client') returning id`, [org])).rows[0].id;
    const type = (await q(`insert into intervention_types (organization_id, name, kind) values ($1, 'SAV', 'sav') returning id`, [org])).rows[0].id;
    const id = (await q(`insert into service_cases (organization_id, type_id, client_id, problem) values ($1, $2, $3, 'x') returning id`, [org, type, client])).rows[0].id;
    await q(`insert into case_references (organization_id, case_id, number) values ($1, $2, $3)`, [org, id, ticket]);
    return id as string;
  }, { commit: true });
}

const item = (to: string[], extra: Record<string, unknown> = {}) => ({
  MessageId: `<${Math.random().toString(36).slice(2)}@mail.test>`,
  From: { Address: 'sav@fabricant.test', Name: 'SAV' },
  Recipients: to,
  To: to.map((Address) => ({ Address })),
  Subject: 'Demande',
  RawTextBody: 'Bonjour',
  ...extra,
});
const rowsOf = (org: string) =>
  db.query('select channel, from_address, subject, suggested_case_id, attachments, status from inbound_messages where organization_id = $1 order by received_at', [org]).then((r) => r.rows);

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@rc.test');
  bob = await createUser(db, 'bob@rc.test');
  orgA = await createOrg(db, alice, 'Réception A');
  orgB = await createOrg(db, bob, 'Réception B');
  const tokens = (await db.query('select id, inbound_token from organizations where id = any($1)', [[orgA, orgB]])).rows;
  tokenA = tokens.find((r) => r.id === orgA).inbound_token;
  tokenB = tokens.find((r) => r.id === orgB).inbound_token;
  caseA = await makeCase(alice, orgA, 'T-100');
  await makeCase(bob, orgB, 'T-100'); // même numéro chez l'autre compte
  process.env.DATABASE_URL = inject('testDbUrl');
  (globalThis as unknown as { crmPool?: pg.Pool }).crmPool = new pg.Pool({ connectionString: inject('testDbUrl'), max: 4 });
  ({ receiveInbound } = await import('../../src/server/reception'));
});

afterAll(async () => {
  await (globalThis as unknown as { crmPool?: pg.Pool }).crmPool?.end();
  (globalThis as unknown as { crmPool?: pg.Pool }).crmPool = undefined;
  await db.query('delete from organizations where id = any($1)', [[orgA, orgB]]);
  await db.query('delete from auth.users where id = any($1)', [[alice, bob]]);
  await db.end();
});

describe('adresse de réception', () => {
  it('chaque compte a la sienne, aléatoire et unique', () => {
    expect(tokenA).toMatch(/^[0-9a-f]{20}$/);
    expect(tokenB).toMatch(/^[0-9a-f]{20}$/);
    expect(tokenA).not.toBe(tokenB);
  });

  it('un membre lit celle de son compte, pas celle d’un autre, et ne peut pas la changer', async () => {
    const seen = await asUser(db, alice, async (q) => (await q('select id, inbound_token from organizations')).rows);
    expect(seen).toEqual([{ id: orgA, inbound_token: tokenA }]);
    expect(await sqlState(asUser(db, alice, (q) => q(`update organizations set inbound_token = $1 where id = $2`, [tokenB, orgA])))).toBe('42501');
  });
});

describe('réception d’emails', () => {
  it('range l’email dans le seul compte de l’adresse, et propose son dossier, jamais celui d’un autre compte', async () => {
    const r = await receiveInbound({ items: [item([`${tokenA}@${DOMAIN}`], { Subject: 'Ticket T-100 : pièce disponible' })] }, DOMAIN);
    expect(r).toEqual({ received: 1, duplicates: 0, ignored: 0 });
    expect(await rowsOf(orgA)).toEqual([
      { channel: 'forward', from_address: 'sav@fabricant.test', subject: 'Ticket T-100 : pièce disponible', suggested_case_id: caseA, attachments: [], status: 'pending' },
    ]);
    expect(await rowsOf(orgB)).toEqual([]);
  });

  it('un nouvel essai du même email n’en crée pas un deuxième', async () => {
    const again = item([`${tokenA}@${DOMAIN}`], { MessageId: '<unique@mail.test>' });
    expect(await receiveInbound({ items: [again] }, DOMAIN)).toEqual({ received: 1, duplicates: 0, ignored: 0 });
    expect(await receiveInbound({ items: [again] }, DOMAIN)).toEqual({ received: 0, duplicates: 1, ignored: 0 });
  });

  it('ignore les adresses inconnues, d’un autre domaine, ou devinées', async () => {
    const r = await receiveInbound({
      items: [
        item([`${'f'.repeat(20)}@${DOMAIN}`]),
        item([`${tokenA}@autre-domaine.be`]),
        item(['technicien@exemple.be']),
        item([`demandes@${DOMAIN}`]),
      ],
    }, DOMAIN);
    expect(r).toEqual({ received: 0, duplicates: 0, ignored: 4 });
  });

  it('un email adressé aux deux comptes arrive chez chacun, séparément', async () => {
    const before = (await rowsOf(orgB)).length;
    expect(await receiveInbound({ items: [item([`${tokenA}@${DOMAIN}`, `${tokenB}@${DOMAIN}`])] }, DOMAIN)).toEqual({ received: 2, duplicates: 0, ignored: 0 });
    expect((await rowsOf(orgB)).length).toBe(before + 1);
  });

  it('transfert à la main : expéditeur et objet d’origine ; pièces jointes notées sans être importées', async () => {
    await receiveInbound({
      items: [item([`${tokenB}@${DOMAIN}`], {
        From: { Address: 'bob@rc.test' },
        Subject: 'TR: Panne',
        RawTextBody: 'À voir\n\n---------- Message transféré ---------\nDe : Client <client@exemple.be>\nObjet : Panne chaudière\n\nBonjour',
        Attachments: [{ Name: 'photo.jpg', ContentType: 'image/jpeg', ContentLength: 1000, DownloadToken: 'jeton-brevo' }],
      })],
    }, DOMAIN);
    const last = (await rowsOf(orgB)).at(-1);
    expect(last).toMatchObject({ from_address: 'client@exemple.be', subject: 'Panne chaudière', attachments: [{ name: 'photo.jpg', type: 'image/jpeg', size: 1000 }] });
    expect(JSON.stringify(last)).not.toContain('jeton-brevo');
  });

  it('les emails reçus restent invisibles pour l’autre compte', async () => {
    const seenByBob = await asUser(db, bob, async (q) => (await q('select organization_id from inbound_messages')).rows);
    expect(seenByBob.length).toBeGreaterThan(0);
    expect(seenByBob.every((r) => r.organization_id === orgB)).toBe(true);
  });
});
