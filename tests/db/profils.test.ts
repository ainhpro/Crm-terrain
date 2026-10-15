import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, createUser } from './helpers';

// Migration 20261016000001 : profils des comptes de connexion créés avant le déclencheur.

const SQL = readFileSync(join(import.meta.dirname, '..', '..', 'supabase/migrations/20261016000001_profils_manquants.sql'), 'utf8');

let db: pg.Client;
let early: string; // compte créé avant les migrations (sans profil)
let normal: string; // compte ordinaire, profil déjà complété

beforeAll(async () => {
  db = connect();
  await db.connect();
  early = await createUser(db, 'avant@p.test');
  await db.query('delete from public.profiles where id = $1', [early]); // comme si le déclencheur n'existait pas
  normal = await createUser(db, 'normal@p.test');
  await db.query(`update public.profiles set full_name = 'Nora', language = 'nl' where id = $1`, [normal]);
});

afterAll(async () => {
  await db.query('delete from auth.users where id = any($1)', [[early, normal]]);
  await db.end();
});

const profile = async (id: string) => (await db.query('select email, full_name, language from public.profiles where id = $1', [id])).rows;

describe('profils manquants', () => {
  it('crée le profil d’un compte qui n’en a pas, avec son email', async () => {
    expect(await profile(early)).toEqual([]);
    await db.query(SQL);
    expect(await profile(early)).toEqual([{ email: 'avant@p.test', full_name: null, language: 'fr' }]);
  });

  it('ne touche pas aux profils existants et peut être rejouée', async () => {
    await db.query(SQL);
    expect(await profile(normal)).toEqual([{ email: 'normal@p.test', full_name: 'Nora', language: 'nl' }]);
    expect(await profile(early)).toHaveLength(1);
  });
});
