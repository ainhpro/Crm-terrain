import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, asUser, connect, createOrg, createUser, seedOrg, sqlState } from './helpers';

// Adhésions : invitation acceptée obligatoire, dernier propriétaire protégé,
// profils visibles seulement entre membres, perte d'accès au retrait.

let db: pg.Client;
let alice: string;
let bob: string;
let orgA: string;

beforeAll(async () => {
  db = connect();
  await db.connect();
  alice = await createUser(db, 'alice@m.test');
  bob = await createUser(db, 'bob@m.test');
  orgA = await createOrg(db, alice, 'A');
  await createOrg(db, bob, 'B');
  await seedOrg(db, alice, orgA, 'A');
});

afterAll(async () => {
  await db.end();
});

const invite = (by: string, org: string, email: string, role = 'member') =>
  asUser(db, by, async (q) => (await q(`select public.invite_member($1, $2, $3) as t`, [org, email, role])).rows[0].t as string, {
    commit: true,
  });
const accept = (user: string, token: string) =>
  asUser(db, user, (q) => q(`select public.accept_invitation($1)`, [token]), { commit: true });
const count = (user: string, table: string) =>
  asUser(db, user, async (q) => (await q(`select count(*)::int as n from ${table}`)).rows[0].n as number);

describe('ajout de membres (S01)', () => {
  it("personne n'insère directement dans organization_members", async () => {
    const carol = await createUser(db, 'carol1@m.test');
    expect(
      await sqlState(asUser(db, alice, (q) => q(`insert into organization_members (organization_id, user_id) values ($1, $2)`, [orgA, carol]))),
    ).toBe('42501');
  });

  it("Bob ne peut pas forcer Alice dans B ni lire son profil sans acceptation", async () => {
    const orgB = await asUser(db, bob, async (q) => (await q(`select id from organizations`)).rows[0].id);
    await invite(bob, orgB, 'alice@m.test');
    const seen = await asUser(db, bob, async (q) => (await q(`select id from profiles where id = $1`, [alice])).rowCount);
    expect(seen).toBe(0);
  });

  it('une invitation acceptée par la bonne personne donne accès', async () => {
    const carol = await createUser(db, 'carol2@m.test');
    const token = await invite(alice, orgA, 'Carol2@M.test ');
    expect(await count(carol, 'clients')).toBe(0);
    await accept(carol, token);
    expect(await count(carol, 'clients')).toBe(1);
    // Une invitation ne sert qu'une fois.
    expect(await sqlState(accept(carol, token))).toBe('P0001');
  });

  it("refusée à une autre identité, à un email non confirmé, après expiration", async () => {
    const dave = await createUser(db, 'dave@m.test');
    const unconfirmed = await createUser(db, 'frank@m.test', { confirmed: false });
    const t1 = await invite(alice, orgA, 'someone@m.test');
    expect(await sqlState(accept(dave, t1))).toBe('P0001');
    const t2 = await invite(alice, orgA, 'frank@m.test');
    expect(await sqlState(accept(unconfirmed, t2))).toBe('P0001');
    const t3 = await invite(alice, orgA, 'dave@m.test');
    await db.query(`update public.invitations set expires_at = now() - interval '1 minute' where organization_id = $1 and email = 'dave@m.test'`, [orgA]);
    expect(await sqlState(accept(dave, t3))).toBe('P0001');
    expect(await count(dave, 'clients')).toBe(0);
  });

  it("un simple membre ne peut pas inviter ; un non-membre non plus", async () => {
    const gina = await createUser(db, 'gina@m.test');
    await addMember(db, alice, orgA, gina, 'gina@m.test');
    expect(await sqlState(invite(gina, orgA, 'x@m.test'))).toBe('42501');
    expect(await sqlState(invite(bob, orgA, 'x@m.test'))).toBe('42501');
  });

  it("le jeton n'est pas lisible par la propriétaire", async () => {
    expect(await sqlState(asUser(db, alice, (q) => q(`select token_hash from invitations`)))).toBe('42501');
  });
});

describe('retrait et dernier propriétaire (S05)', () => {
  it("un membre retiré perd l'accès immédiatement", async () => {
    const hugo = await createUser(db, 'hugo@m.test');
    await addMember(db, alice, orgA, hugo, 'hugo@m.test');
    expect(await count(hugo, 'clients')).toBe(1);
    await asUser(db, alice, (q) => q(`delete from organization_members where organization_id = $1 and user_id = $2`, [orgA, hugo]), {
      commit: true,
    });
    expect(await count(hugo, 'clients')).toBe(0);
    expect(await count(hugo, 'organizations')).toBe(0);
  });

  it("un membre peut quitter l'organisation lui-même", async () => {
    const ines = await createUser(db, 'ines@m.test');
    await addMember(db, alice, orgA, ines, 'ines@m.test');
    const n = await asUser(db, ines, async (q) => (await q(`delete from organization_members where user_id = $1`, [ines])).rowCount, {
      commit: true,
    });
    expect(n).toBe(1);
  });

  it('le dernier propriétaire ne peut pas partir', async () => {
    expect(
      await sqlState(asUser(db, alice, (q) => q(`delete from organization_members where organization_id = $1 and user_id = $2`, [orgA, alice]))),
    ).toBe('P0001');
  });

  it("avec un second propriétaire, l'un peut partir", async () => {
    const jo = await createUser(db, 'jo@m.test');
    const org = await createOrg(db, jo, 'J');
    const kim = await createUser(db, 'kim@m.test');
    await addMember(db, jo, org, kim, 'kim@m.test', 'owner');
    const n = await asUser(db, jo, async (q) => (await q(`delete from organization_members where user_id = $1`, [jo])).rowCount, {
      commit: true,
    });
    expect(n).toBe(1);
    // Kim est désormais seule : elle ne peut plus partir.
    expect(await sqlState(asUser(db, kim, (q) => q(`delete from organization_members where user_id = $1`, [kim])))).toBe('P0001');
  });

  it("supprimer le compte Auth du dernier propriétaire est refusé ; supprimer l'organisation reste possible", async () => {
    const leo = await createUser(db, 'leo@m.test');
    const org = await createOrg(db, leo, 'L');
    expect(await sqlState(db.query(`delete from auth.users where id = $1`, [leo]))).toBe('P0001');
    await db.query(`delete from public.organizations where id = $1`, [org]);
    await db.query(`delete from auth.users where id = $1`, [leo]);
  });
});

describe('profils (S06)', () => {
  it("l'email du profil n'est pas modifiable par l'utilisateur", async () => {
    expect(await sqlState(asUser(db, alice, (q) => q(`update profiles set email = 'x@y.z' where id = $1`, [alice])))).toBe('42501');
    const n = await asUser(db, alice, async (q) => (await q(`update profiles set full_name = 'Alice' where id = $1`, [alice])).rowCount);
    expect(n).toBe(1);
  });

  it("le changement d'email confirmé côté Auth est recopié dans le profil", async () => {
    await db.query(`update auth.users set email = 'alice.new@m.test' where id = $1`, [alice]);
    const { rows } = await db.query(`select email from public.profiles where id = $1`, [alice]);
    expect(rows[0].email).toBe('alice.new@m.test');
  });
});
