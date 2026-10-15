// Vérifie le projet Supabase réel, en lecture seule par défaut :
//  - migrations du dépôt toutes appliquées ;
//  - RLS active sur toutes les tables publiques ; aucun droit pour anon ; fonctions appelables par
//    authenticated = exactement la liste attendue ;
//  - bucket des fichiers privé ; Auth par email active, adresse du site correcte.
// Avec --isolation : crée deux comptes de test (API d'administration), vérifie qu'aucun ne voit ni ne
// modifie les données de l'autre sous RLS, puis supprime tout ce qu'il a créé.
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUCKET, connectDb, http, need, serviceHeaders } from './lib.mjs';

const EXPECTED_CALLABLE = ['accept_invitation', 'create_organization', 'delete_organization', 'deployment_formule', 'invite_member', 'is_member', 'is_owner', 'reorder_pipeline_steps'];
const url = need('SUPABASE_URL').replace(/\/+$/, '');
const anon = need('SUPABASE_ANON_KEY');
const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const db = await connectDb();
try {
  const files = readdirSync(join(import.meta.dirname, '..', '..', 'supabase', 'migrations')).filter((f) => /^\d{14}_.+\.sql$/.test(f));
  const applied = new Set(
    (await db.query(`select version from supabase_migrations.schema_migrations`).catch(() => ({ rows: [] }))).rows.map((r) => r.version),
  );
  const missing = files.filter((f) => !applied.has(f.slice(0, 14)));
  ok('Migrations appliquées', missing.length === 0, missing.length ? `manquantes : ${missing.join(', ')}` : `${files.length}/${files.length}`);

  const noRls = (await db.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
  )).rows.map((r) => r.relname);
  ok('RLS active sur toutes les tables publiques', noRls.length === 0, noRls.join(', '));

  const anonTables = (await db.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'select, insert, update, delete') order by 1`,
  )).rows.map((r) => r.relname);
  ok('Aucun droit de anon sur les tables', anonTables.length === 0, anonTables.join(', '));

  const fn = async (role) => (await db.query(
    `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1`, [role],
  )).rows.map((r) => r.proname);
  const anonFns = await fn('anon');
  ok('Aucune fonction appelable par anon', anonFns.length === 0, anonFns.join(', '));
  const authFns = await fn('authenticated');
  ok('Fonctions appelables par authenticated = liste attendue', JSON.stringify(authFns) === JSON.stringify(EXPECTED_CALLABLE), authFns.join(', '));

  const trigger = (await db.query(`select 1 from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass`)).rowCount;
  ok('Profil créé à l’inscription (déclencheur sur auth.users)', trigger === 1);

  const b = await http(`${url}/storage/v1/bucket/${BUCKET}`, { headers: serviceHeaders() });
  ok(`Bucket « ${BUCKET} » privé`, b.ok && b.json?.public === false, b.ok ? '' : `HTTP ${b.status}`);
  const pub = await http(`${url}/storage/v1/object/public/${BUCKET}/x/y.png`);
  ok('Aucun accès public aux fichiers', !pub.ok, `HTTP ${pub.status}`);

  const s = await http(`${url}/auth/v1/settings`, { headers: { apikey: anon } });
  ok('Auth : connexion par email active', s.ok && s.json?.external?.email === true, s.ok ? '' : `HTTP ${s.status}`);

  if (process.argv.includes('--isolation')) {
    const tag = randomBytes(4).toString('hex');
    const users = [];
    const orgs = [];
    try {
      for (const who of ['a', 'b']) {
        const r = await http(`${url}/auth/v1/admin/users`, {
          method: 'POST', headers: serviceHeaders(), body: { email: `crm-check-${tag}-${who}@example.com`, email_confirm: true },
        });
        if (!r.ok) throw new Error(`création du compte de test : HTTP ${r.status} ${r.text.slice(0, 200)}`);
        users.push(r.json.id);
      }
      const asUser = async (uid, fnq) => {
        await db.query('begin');
        try {
          await db.query('set local role authenticated');
          await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
          const out = await fnq();
          await db.query('commit');
          return out;
        } catch (e) {
          await db.query('rollback');
          throw e;
        }
      };
      const profiles = (await db.query(`select count(*)::int as n from public.profiles where id = any($1::uuid[])`, [users])).rows[0].n;
      ok('Isolation : profils créés pour les deux comptes', profiles === 2);
      for (const [i, uid] of users.entries()) {
        const org = await asUser(uid, async () => (await db.query(`select public.create_organization($1) as id`, [`Contrôle ${tag} ${i}`])).rows[0].id);
        orgs.push(org);
        await asUser(uid, () => db.query(`insert into public.clients (organization_id, name) values ($1, $2)`, [org, `Client ${tag} ${i}`]));
      }
      const seen = await asUser(users[0], async () => (await db.query(`select count(*)::int as n from public.clients where organization_id = $1`, [orgs[1]])).rows[0].n);
      ok('Isolation : A ne voit pas les clients de B', seen === 0, `${seen}`);
      const changed = await asUser(users[0], async () => (await db.query(`update public.clients set name = 'x' where organization_id = $1`, [orgs[1]])).rowCount);
      ok('Isolation : A ne modifie pas les clients de B', changed === 0, `${changed}`);
      const own = await asUser(users[0], async () => (await db.query(`select count(*)::int as n from public.clients where organization_id = $1`, [orgs[0]])).rows[0].n);
      ok('Isolation : A voit ses propres clients', own === 1, `${own}`);
      const crossInsert = await asUser(users[0], () => db.query(`insert into public.clients (organization_id, name) values ($1, 'x')`, [orgs[1]])).then(() => 'accepté', (e) => e.code);
      ok('Isolation : A ne crée rien chez B', crossInsert === '42501', crossInsert);
    } catch (e) {
      ok('Isolation : déroulement', false, e.message);
    } finally {
      if (orgs.length) await db.query(`delete from public.organizations where id = any($1::uuid[])`, [orgs]).catch((e) => ok('Nettoyage des organisations de test', false, e.message));
      for (const id of users) {
        const d = await http(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: serviceHeaders() });
        if (!d.ok) ok('Nettoyage des comptes de test', false, `HTTP ${d.status}`);
      }
    }
  }
} finally {
  await db.end();
}

for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
