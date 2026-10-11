// Applique supabase/migrations/*.sql sur le projet Supabase, dans l'ordre, une transaction par fichier.
// Suivi dans supabase_migrations.schema_migrations (même table que la CLI Supabase).
// N'applique JAMAIS supabase/tests/supabase-shim.sql ni scripts/seed.sql (données de démonstration).
//   node scripts/supabase/migrate.mjs            liste ce qui reste à appliquer (aucune écriture)
//   node scripts/supabase/migrate.mjs --apply    applique
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectDb } from './lib.mjs';

const DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');
const apply = process.argv.includes('--apply');
const files = readdirSync(DIR).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();

const db = await connectDb();
try {
  await db.query(`create schema if not exists supabase_migrations`);
  await db.query(`create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
  const done = new Set((await db.query(`select version from supabase_migrations.schema_migrations`)).rows.map((r) => r.version));
  const pending = files.filter((f) => !done.has(f.slice(0, 14)));
  console.log(`Migrations dans le dépôt : ${files.length} ; déjà appliquées : ${files.length - pending.length} ; à appliquer : ${pending.length}`);
  for (const f of pending) console.log(`  - ${f}`);
  if (!apply) {
    if (pending.length) console.log('Rien n’a été modifié. Relancer avec --apply pour appliquer.');
    process.exit(0);
  }
  for (const f of pending) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    await db.query('begin');
    try {
      await db.query(sql);
      await db.query(`insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)`, [
        f.slice(0, 14), [sql], f.slice(15, -4),
      ]);
      await db.query('commit');
      console.log(`Appliquée : ${f}`);
    } catch (e) {
      await db.query('rollback');
      console.error(`ÉCHEC sur ${f} : ${e.message}. Cette migration est annulée ; les suivantes ne sont pas appliquées.`);
      process.exit(1);
    }
  }
} finally {
  await db.end();
}
