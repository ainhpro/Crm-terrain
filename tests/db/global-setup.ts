import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const ROOT = join(import.meta.dirname, '..', '..');
export const TEST_DB = 'crm_test';

/** Recrée une base vide, applique l'émulation Supabase puis toutes les migrations dans l'ordre. */
export default async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant : lancer via npm run test:db');

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const db = new pg.Client({ connectionString: testDbUrl(url) });
  await db.connect();
  // Les rôles sont globaux au cluster : ne les créer qu'une fois.
  const { rowCount } = await db.query(`select 1 from pg_roles where rolname = 'authenticated'`);
  let shim = readFileSync(join(ROOT, 'supabase/tests/supabase-shim.sql'), 'utf8');
  if (rowCount) shim = shim.replace(/^create role .*$/gm, '');
  await db.query(shim);

  const dir = join(ROOT, 'supabase/migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.query(readFileSync(join(dir, file), 'utf8'));
    } catch (err) {
      throw new Error(`Migration ${file} : ${(err as Error).message}`);
    }
  }
  await db.end();
}

export function testDbUrl(url: string): string {
  const u = new URL(url);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}
