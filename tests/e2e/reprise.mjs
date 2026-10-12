// Reprise de l'ancien CRM dans un navigateur : compte neuf, sauvegarde collée, bilan, reprise,
// seconde reprise sans doublon. Prérequis : npm run db:reset, application en mode développement (port 3200).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(process.env.PLAYWRIGHT_GLOBAL ?? '/usr/lib/node_modules/')('playwright'); } })();
const BASE = process.env.E2E_BASE ?? 'http://localhost:3200';
const DB = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54322/crm';
if (!/localhost|127\.0\.0\.1/.test(DB)) throw new Error('Base locale de démonstration uniquement.');
const sql = (s) => execFileSync('psql', [DB, '-Atc', s]).toString().trim();
const results = [];
const errors = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// Sauvegarde au format de l'ancien CRM (bouton BACKUP), avec des guillemets « intelligents » comme dans Notes.
const entries = [
  { id: 101, client: 'FACQ', showroom: 'Geel', type: 'MAJ — RDV Mise à jour Showroom', statut: 'Terminé', date: '2026-09-01' },
  { id: 102, client: 'FACQ', showroom: 'Geel', type: 'MAJ — Offre Showroom', statut: 'En cours', date: '2026-10-02', note: 'Attente prix' },
  { id: 103, client: 'FACQ', showroom: 'Hasselt', type: 'Formation Meubles', statut: 'RDV à fixer' },
  { id: 104, client: 'STG', showroom: 'Zele', type: 'PLACEMENT — RDV showroom', statut: 'RDV fixé', date: '2026-10-21' },
  { id: 105, client: 'STG', showroom: 'Zele', type: 'Suivi visite', statut: 'Relance', date: '2026-10-20', note: 'Voir nouveau responsable' },
  { id: 106, client: 'SAMO', showroom: 'Dupont Ypres', type: 'Formation nouveautés', statut: 'Terminé', date: '2026-08-14' },
  { id: 107, client: 'FACQ', showroom: 'Geel', type: 'Commande', statut: 'Statut bizarre', date: '2026-02-30' },
];
const backup = JSON.stringify({ entries }).replace(/"/g, (m, i) => (i % 7 === 0 ? '“' : m));

const browser = await (process.env.CHROMIUM_PATH ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) : chromium.launch());
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/connexion`); await page.fill('#email', `reprise${Date.now()}@demo.local`); await page.click('button[type=submit]');
await page.waitForURL(/bienvenue/); await page.fill('#orgName', 'Reprise Test');
await page.locator('input[name=profile][value=commercial]').check({ force: true });
await page.getByRole('button', { name: 'Commencer' }).click(); await page.waitForURL(/demarrer/);
const org = sql(`select id from organizations where name = 'Reprise Test' order by created_at desc limit 1`);

await page.goto(`${BASE}/clients/importer`);
await page.getByRole('link', { name: /Reprendre sa sauvegarde/ }).click(); await page.waitForURL(/reprise/);
await page.fill('#backup', backup);
await page.getByRole('button', { name: 'Lire la sauvegarde' }).click();
await page.getByRole('heading', { name: 'Ce qui sera repris' }).waitFor();
const stats = await page.locator('.stat b').allInnerTexts();
ok('bilan : 7 actions, 4 clients, affaires par parcours', JSON.stringify(stats) === JSON.stringify(['7', '4', '4']), stats.join('/'));
ok('anomalies montrées avant la reprise (statut inconnu, date invalide)', (await page.getByText(/Statut bizarre/).count()) > 0 && (await page.getByText(/2026-02-30/).count()) > 0);
ok('rien n’est enregistré avant de lancer', sql(`select count(*) from clients where organization_id = '${org}'`) === '0');
await page.getByRole('button', { name: /Reprendre 7 actions/ }).click(); await page.waitForURL(/repris=/);
ok('reprise : message et compteurs', /repris=7&ignores=0/.test(page.url()) && (await page.getByText(/7 actions reprises/).count()) === 1, new URL(page.url()).search);
ok('clients créés avec leur groupe', sql(`select string_agg(c.name || ':' || g.name, ',' order by c.name) from clients c join client_groups g on g.id = c.group_id where c.organization_id = '${org}'`) === 'Dupont Ypres:SAMO,FACQ Geel:FACQ,FACQ Hasselt:FACQ,STG Zele:STG');
ok('étapes rattachées aux parcours de l’ancien CRM, suivi en note', sql(`select count(*) filter (where step_id is not null) || '/' || count(*) filter (where kind = 'note') from actions where organization_id = '${org}'`) === '6/1');
ok('dates et statuts repris ; date invalide laissée vide', sql(`select status || '|' || coalesce(due_date::text, '-') from actions where organization_id = '${org}' and legacy_id = 104`) === 'appointment_set|2026-10-21'
  && sql(`select status || '|' || coalesce(due_date::text, '-') from actions where organization_id = '${org}' and legacy_id = 107`) === 'todo|-');

// Avancement visible sur la fiche : FACQ Geel, MAJ showroom.
await page.goto(`${BASE}/clients`); await page.getByRole('link', { name: /FACQ Geel/ }).first().click(); await page.waitForLoadState('networkidle');
ok('fiche client : l’affaire de l’ancien CRM avec son avancement', (await page.getByText(/MAJ showroom/).count()) > 0, '');
await page.screenshot({ path: '.local/e2e/reprise-fiche.png', fullPage: true }).catch(() => {});

// Seconde reprise (sauvegarde plus récente, une entrée nouvelle) : rien en double.
await page.goto(`${BASE}/clients/reprise`);
await page.fill('#backup', JSON.stringify({ entries: [...entries, { id: 108, client: 'STG', showroom: 'Zele', type: 'Commande', statut: 'À faire', date: '2026-11-02' }] }));
await page.getByRole('button', { name: 'Lire la sauvegarde' }).click();
await page.getByRole('button', { name: /Reprendre 8 actions/ }).click(); await page.waitForURL(/repris=/);
ok('seconde reprise : seule la nouvelle entrée est ajoutée', /repris=1&ignores=7/.test(page.url()) && sql(`select count(*) from actions where organization_id = '${org}'`) === '8'
  && sql(`select count(*) from clients where organization_id = '${org}'`) === '4' && sql(`select count(*) from deals where organization_id = '${org}'`) === '4', new URL(page.url()).search); // la nouvelle entrée rejoint l'affaire STG Zele existante

// Texte qui n'est pas une sauvegarde.
await page.goto(`${BASE}/clients/reprise`);
await page.fill('#backup', 'Bonjour, voici mes notes');
await page.getByRole('button', { name: 'Lire la sauvegarde' }).click();
const msg = await page.getByRole('alert').filter({ hasText: /sauvegarde/ }).first().innerText().catch(() => '');
ok('texte illisible : message clair', /pas une sauvegarde lisible/.test(msg), msg);

console.log(results.join('\n'));
console.log('Erreurs navigateur :', errors.length ? errors : 'aucune');
await browser.close();
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exit(1);
