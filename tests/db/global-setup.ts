import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

const ROOT = join(import.meta.dirname, '..', '..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

declare module 'vitest' {
  export interface ProvidedContext {
    testDbUrl: string;
  }
}

/**
 * Crée une base neuve au nom unique, y applique l'émulation Supabase puis les migrations,
 * et la supprime à la fin. Ne supprime jamais une base qu'elle n'a pas créée.
 *
 * Cible : TEST_DATABASE_URL (jamais DATABASE_URL, qui peut viser une vraie base).
 * Refuse un serveur distant sauf TEST_DB_ALLOW_REMOTE=1.
 */
export default async function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL manquant : lancer via npm run test:db');

  const target = new URL(url);
  if (!LOCAL_HOSTS.has(target.hostname) && process.env.TEST_DB_ALLOW_REMOTE !== '1') {
    throw new Error(`Serveur de test non local refusé (${target.hostname}). TEST_DB_ALLOW_REMOTE=1 pour forcer.`);
  }

  const dbName = `crm_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  // Échoue si le nom existe déjà : on ne touche jamais une base préexistante.
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const testUrl = new URL(url);
  testUrl.pathname = `/${dbName}`;
  const db = new pg.Client({ connectionString: testUrl.toString() });
  await db.connect();
  try {
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
  } finally {
    await db.end();
  }

  project.provide('testDbUrl', testUrl.toString());

  return async () => {
    const cleanup = new pg.Client({ connectionString: url });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName} with (force)`);
    await cleanup.end();
  };
}
