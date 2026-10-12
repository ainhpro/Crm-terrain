// RGPD (règle 10) dans un navigateur : export complet, suppression d'un compte, suppression d'une
// entreprise. Prérequis : npm run db:reset, application en mode développement sur le port 3200.
// Supprime des données de démonstration (c'est voulu) : relancer db:reset ensuite.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(process.env.PLAYWRIGHT_GLOBAL ?? '/usr/lib/node_modules/')('playwright'); } })();
const BASE = process.env.E2E_BASE ?? 'http://localhost:3200';
const DB = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54322/crm';
if (!/localhost|127\.0\.0\.1/.test(DB)) throw new Error('Base locale de démonstration uniquement.');
const sql = (s) => execFileSync('psql', [DB, '-Atc', s]).toString().trim();
const OUT = '.local/e2e/rgpd';
mkdirSync(OUT, { recursive: true });
const browser = await (process.env.CHROMIUM_PATH ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) : chromium.launch());
const results = [];
const errors = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/connexion`); await page.fill('#email', email); await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/connexion'));
  return { ctx, page };
}
const confirmDelete = async (page, summary, field, value) => {
  await page.goto(`${BASE}/reglages#donnees`);
  const box = page.locator('details', { hasText: summary });
  await box.locator('summary').click();
  await box.locator(`input[name=${field}]`).fill(value);
  await box.locator('input[name=confirm]').check();
  await box.getByRole('button').click();
  await page.waitForURL((u) => u.search.includes('erreur') || !u.pathname.startsWith('/reglages'));
  await page.waitForLoadState('networkidle');
};

// Seed photo for the export.
const org = sql(`select id from organizations where name = 'INDA'`);
// 1. Export par le propriétaire.
{
  const { ctx, page } = await session('fabrice@demo.local');
  await page.goto(`${BASE}/reglages#donnees`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Exporter toutes les données/ }).click()]);
  const file = `${OUT}/export.tar`; await dl.saveAs(file);
  const list = execFileSync('tar', ['-tf', file]).toString().split('\n');
  mkdirSync(`${OUT}/x`, { recursive: true }); execFileSync('tar', ['-xf', file, '-C', `${OUT}/x`]);
  const clients = JSON.parse(execFileSync('cat', [`${OUT}/x/donnees/clients.json`]).toString());
  ok('export : archive lisible, une table par fichier', list.includes('LISEZMOI.txt') && list.includes('donnees/rapports.json') && list.includes('donnees/heures.json'), `${list.filter(Boolean).length} éléments`);
  ok('export : tous les clients, et seulement ceux de l’entreprise', clients.length === Number(sql(`select count(*) from clients where organization_id = '${org}'`)) && clients.every((c) => c.organization_id === org), `${clients.length}`);
  const refs = Number(sql(`select count(distinct p) from (select storage_path p from visit_media where organization_id = '${org}' union select signature_path from report_versions where organization_id = '${org}' union select pdf_path from report_versions where organization_id = '${org}' union select client_pdf_path from report_versions where organization_id = '${org}' union select logo_path from organizations where id = '${org}') x where p is not null`));
  const files = list.filter((n) => n.startsWith('fichiers/')).length;
  ok('export : chaque fichier référencé est dans l’archive', files === refs && !list.includes('fichiers-manquants.txt'), `${files}/${refs}`);
  ok('export : aucun secret (empreinte des invitations)', !execFileSync('cat', [`${OUT}/x/donnees/invitations.json`]).toString().includes('token_hash'));
  // 2. Le propriétaire ne peut pas supprimer son compte tant que d'autres membres dépendent de lui.
  await confirmDelete(page, 'Supprimer mon compte', 'confirmEmail', 'fabrice@demo.local');
  ok('seul propriétaire avec des membres : refus expliqué', (await page.getByText(/seul propriétaire/).count()) > 0);
  // Mauvaise confirmation.
  await confirmDelete(page, 'Supprimer l’entreprise', 'confirmName', 'INDA ?');
  ok('mauvaise confirmation du nom : rien n’est supprimé', (await page.getByText(/Confirmation incomplète/).count()) > 0 && sql(`select count(*) from organizations where id = '${org}'`) === '1');
  await ctx.close();
}
// 3. Un membre : pas d'export ; suppression de son compte.
{
  const { ctx, page } = await session('tom@demo.local');
  await page.goto(`${BASE}/reglages#donnees`);
  const r = await page.request.get(`${BASE}/reglages/export`);
  ok('membre : pas d’export de l’entreprise', (await page.getByRole('link', { name: /Exporter/ }).count()) === 0 && r.status() === 403, `HTTP ${r.status()}`);
  const tom = sql(`select id from auth.users where email = 'tom@demo.local'`);
  await confirmDelete(page, 'Supprimer mon compte', 'confirmEmail', 'tom@demo.local');
  ok('membre : compte supprimé, retour à la connexion', page.url().includes('compte=supprime') && sql(`select count(*) from auth.users where id = '${tom}'`) === '0', new URL(page.url()).search);
  ok('membre supprimé : ses heures gardent son nom', sql(`select count(*) from visit_workers where user_id is null and worker_name is not null`) === sql(`select count(*) from visit_workers where user_id is null`));
  await ctx.close();
}
// 4. Suppression de l'entreprise par le propriétaire.
{
  const { ctx, page } = await session('fabrice@demo.local');
  await confirmDelete(page, 'Supprimer l’entreprise', 'confirmName', 'INDA');
  ok('entreprise supprimée : message, plus aucune donnée', page.url().includes('/bienvenue') && (await page.getByText(/ont été supprimées/).count()) > 0
    && sql(`select (select count(*) from organizations where id = '${org}') + (select count(*) from clients where organization_id = '${org}') + (select count(*) from report_versions where organization_id = '${org}')`) === '0');
  await page.screenshot({ path: `${OUT}/apres-suppression.png` });
  await ctx.close();
}
// 5. Compte seul : son entreprise part avec lui.
{
  const { ctx, page } = await session('solo@demo.local');
  await page.fill('#orgName', 'Solo SRL'); await page.getByRole('button', { name: 'Commencer' }).click(); await page.waitForURL(/demarrer/);
  const solo = sql(`select id from organizations where name = 'Solo SRL'`);
  await confirmDelete(page, 'Supprimer mon compte', 'confirmEmail', 'solo@demo.local');
  ok('seul membre : compte et entreprise supprimés', sql(`select count(*) from organizations where id = '${solo}'`) === '0' && sql(`select count(*) from auth.users where email = 'solo@demo.local'`) === '0');
  await ctx.close();
}
console.log(results.join('\n'));
console.log('Erreurs navigateur :', errors.length ? errors : 'aucune');
await browser.close();
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exit(1);
