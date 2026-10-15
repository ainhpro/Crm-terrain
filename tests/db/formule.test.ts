import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, connect, createOrg, createUser, sqlState } from './helpers';

// Migration 20261017000001 : formule de l'installation (complète ou technicien), modules fixés à la création.

let db: pg.Client;
let owner: string;
const orgs: string[] = [];

const modulesOf = async (org: string) => (await db.query('select modules from public.organizations where id = $1', [org])).rows[0].modules;
const setFormule = (f: string) =>
  db.query(`insert into private.settings (key, value) values ('formule', $1) on conflict (key) do update set value = excluded.value`, [f]);

beforeAll(async () => {
  db = connect();
  await db.connect();
  owner = await createUser(db, 'formule@f.test');
});

afterAll(async () => {
  await db.query(`delete from private.settings`); // les autres fichiers de tests retrouvent la formule complète
  await db.query('delete from public.organizations where id = any($1)', [orgs]);
  await db.query('delete from auth.users where id = $1', [owner]);
  await db.end();
});

describe('formule de l’installation', () => {
  it('par défaut, un nouveau compte a le CRM et les interventions', async () => {
    orgs.push(await createOrg(db, owner, 'Complet'));
    expect(await modulesOf(orgs[0]!)).toEqual(['crm', 'interventions']);
    expect((await asUser(db, owner, (q) => q('select public.deployment_formule() as f'))).rows[0].f).toBe('complete');
  });

  it('formule technicien : un nouveau compte n’a que les interventions, les comptes existants ne changent pas', async () => {
    await setFormule('technicien');
    orgs.push(await createOrg(db, owner, 'Technicien'));
    expect(await modulesOf(orgs[1]!)).toEqual(['interventions']);
    expect(await modulesOf(orgs[0]!)).toEqual(['crm', 'interventions']);
    expect((await asUser(db, owner, (q) => q('select public.deployment_formule() as f'))).rows[0].f).toBe('technicien');
  });

  it('un utilisateur ne lit ni ne change la formule, ni les modules de son compte', async () => {
    expect(await sqlState(asUser(db, owner, (q) => q('select * from private.settings')))).toBe('42501');
    expect(await sqlState(asUser(db, owner, (q) => q(`update private.settings set value = 'complete'`)))).toBe('42501');
    expect(await sqlState(asUser(db, owner, (q) => q(`select private.formule_modules('complete')`)))).toBe('42501');
    expect(
      await sqlState(asUser(db, owner, (q) => q(`update public.organizations set modules = array['crm', 'interventions'] where id = $1`, [orgs[1]]))),
    ).toBe('42501');
    expect(await modulesOf(orgs[1]!)).toEqual(['interventions']);
  });

  it('formule et modules inconnus refusés', async () => {
    expect(await sqlState(setFormule('tout'))).toBe('23514');
    expect(await sqlState(db.query(`update public.organizations set modules = '{}' where id = $1`, [orgs[0]]))).toBe('23514');
    expect(await sqlState(db.query(`update public.organizations set modules = array['facturation'] where id = $1`, [orgs[0]]))).toBe('23514');
  });
});
