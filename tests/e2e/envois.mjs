// Envoi réel des emails (relecture D03) dans un navigateur, contre un service Brevo de test.
// Prérequis : npm run db:reset ; faux Brevo sur BREVO_MOCK (défaut http://localhost:54402, avec /mode et /log) ;
// application lancée avec BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_API_URL=<faux Brevo>, CRON_SECRET.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(process.env.PLAYWRIGHT_GLOBAL ?? '/usr/lib/node_modules/')('playwright'); } })();
const BASE = process.env.E2E_BASE ?? 'http://localhost:3200';
const MOCK = process.env.BREVO_MOCK ?? 'http://localhost:54402';
const DB = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54322/crm';
if (!/localhost|127\.0\.0\.1/.test(DB) || !/localhost|127\.0\.0\.1/.test(MOCK)) throw new Error('Services locaux de test uniquement.');
const sql = (s) => execFileSync('psql', [DB, '-Atc', s]).toString().trim();
const mode = (m) => fetch(`${MOCK}/mode?m=${m}`);
const brevoLog = async () => (await fetch(`${MOCK}/log`)).json();
const until = async (cond, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const results = [];
const errors = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

sql(`insert into contacts (organization_id, client_id, name, email) select organization_id, id, 'Mme Exemple', 'mme@client.example' from clients where name = 'Mme Exemple'`);
const browser = await (process.env.CHROMIUM_PATH ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) : chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage(); page.setDefaultTimeout(60000);
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/connexion`); await page.fill('#email', 'fabrice@demo.local'); await page.click('button[type=submit]'); await page.waitForURL(`${BASE}/`);

// 1. Rapport validé : un envoi par destinataire, PDF figé du bon public, remarques seulement au donneur d'ordre.
await mode('accept');
await page.goto(`${BASE}/interventions`); await page.getByRole('link', { name: /Mme Exemple/ }).first().click(); await page.waitForLoadState('networkidle');
const caseUrl = page.url();
await page.getByRole('link', { name: /Planifié/ }).first().click(); await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: /arrivé/ }).click(); await page.getByRole('button', { name: 'Je pars' }).waitFor();
const addNeed = async (name) => {
  const box = page.locator('details', { hasText: 'Ajouter une ligne à commander' });
  await box.evaluate((el) => { el.open = true; });
  await box.locator('input[name=designation]').fill(name);
  await box.getByRole('button', { name: 'Ajouter' }).click();
  await page.locator('.list > div, li, div', { hasText: name }).first().waitFor();
  await page.waitForLoadState('networkidle');
};
await addNeed('Joint silicone');
await addNeed('Charnière');
await page.getByRole('button', { name: 'Je pars' }).click(); await page.waitForLoadState('networkidle');
await page.fill('textarea[name=done]', 'Joint refait.');
await page.fill('textarea[name=remarks]', 'REMARQUE-INTERNE');
const pad = page.locator('canvas.sig'); await pad.evaluate((el) => el.scrollIntoView({ block: 'center' }));
const b = await pad.boundingBox(); await page.mouse.move(b.x + 30, b.y + 80); await page.mouse.down();
for (const [x, y] of [[80, 40], [130, 100], [180, 50]]) await page.mouse.move(b.x + x, b.y + y, { steps: 5 });
await page.mouse.up();
for (const box of await page.locator('input[name=recipient]:not([disabled])').all()) await box.check();
await page.getByRole('button', { name: 'Valider et envoyer' }).click(); await page.waitForURL(/valide=1/);
const rid = sql(`select rv.id from report_versions rv join service_visits v on v.id = rv.visit_id join service_cases sc on sc.id = v.case_id join clients c on c.id = sc.client_id where c.name = 'Mme Exemple' and rv.status = 'validated'`);
const allSent = await until(() => sql(`select count(*) filter (where status <> 'sent') = 0 and count(*) = 3 from outbound_messages where report_version_id = '${rid}'`) === 't');
const log = await brevoLog();
const mine = log.filter((l) => l.key.startsWith(`report:${rid}`));
ok('rapport : 3 envois partis juste après la validation, sans attendre', allSent && mine.length === 3, `${mine.length}`);
ok('chaque envoi joint le PDF figé', mine.every((m) => m.attachments.length === 1 && m.attachments[0].pdf === '%PDF-'), mine.map((m) => m.attachments[0]?.name).join(', '));
const client = mine.find((m) => m.to === 'mme@client.example');
ok('client final : PDF client, sans les remarques internes', client && client.attachments[0].name.endsWith('-client.pdf') && !client.text.includes('REMARQUE-INTERNE'));
ok('donneur d’ordre : remarques présentes', mine.filter((m) => m !== client).every((m) => m.text.includes('REMARQUE-INTERNE')));
ok('expéditeur : adresse authentifiée, au nom de l’entreprise', mine.every((m) => m.from.email === 'envoi@crm-test.be' && m.apiKey === 'cle-brevo-test'), mine[0]?.from.name);
ok('identifiant Brevo conservé', sql(`select count(*) from outbound_messages where report_version_id = '${rid}' and provider_message_id like '<%@brevo-test>'`) === '3');

// 2. Coupure après acceptation : « À vérifier », jamais renvoyé d'office ; l'utilisateur confirme.
await mode('reset');
await page.goto(caseUrl); await page.waitForLoadState('networkidle');
const rowJ = page.locator('.list > div', { hasText: 'Joint silicone' });
await rowJ.locator('select[name=supplierEmail]').selectOption({ index: 1 });
await rowJ.getByRole('button', { name: 'Commander' }).click();
await page.waitForURL(/commande=1/);
const uncertain = await until(() => sql(`select count(*) from outbound_messages where kind = 'part_order' and status = 'uncertain'`) === '1');
await page.goto(caseUrl); await page.waitForLoadState('networkidle');
ok('coupure : envoi « À vérifier », avec explication et choix', uncertain && (await page.getByText('À vérifier').count()) > 0 && (await page.getByRole('button', { name: 'Il est bien parti' }).count()) === 1);
const keyU = sql(`select idempotency_key from outbound_messages where status = 'uncertain'`);
const r = await page.request.get(`${BASE}/api/envois`, { headers: { authorization: 'Bearer secret-de-test-tres-long' } });
ok('passage planifié : ne renvoie pas un envoi incertain', r.status() === 200 && (await brevoLog()).filter((l) => l.key === keyU).length === 1, JSON.stringify(await r.json()));
await page.getByRole('button', { name: 'Il est bien parti' }).click(); await page.waitForLoadState('networkidle');
ok('confirmé par l’utilisateur : « Envoyé », toujours un seul appel', (await until(() => sql(`select status from outbound_messages where idempotency_key = '${keyU}'`) === 'sent')) && (await brevoLog()).filter((l) => l.key === keyU).length === 1);

// 3. Refus certain : « Échec » avec le motif ; « Renvoyer » quand le problème est réglé.
await mode('refuse');
await page.goto(caseUrl); await page.waitForLoadState('networkidle');
const rowC = page.locator('.list > div', { hasText: 'Charnière' });
await rowC.locator('select[name=supplierEmail]').selectOption({ index: 1 });
await rowC.getByRole('button', { name: 'Commander' }).click();
await page.waitForURL(/commande=1/);
const keyF = await (async () => { await until(() => sql(`select count(*) from outbound_messages where kind = 'part_order' and status = 'failed'`) === '1'); return sql(`select idempotency_key from outbound_messages where kind = 'part_order' and status = 'failed'`); })();
await page.goto(caseUrl); await page.waitForLoadState('networkidle');
ok('refus : « Échec » et motif affichés', (await page.getByText('Échec').count()) > 0 && (await page.getByText(/HTTP 400/).count()) > 0);
await mode('accept');
await page.getByRole('button', { name: 'Renvoyer' }).click(); await page.waitForLoadState('networkidle');
ok('renvoyé après correction : « Envoyé »', await until(() => sql(`select status from outbound_messages where idempotency_key = '${keyF}'`) === 'sent'), `${(await brevoLog()).filter((l) => l.key === keyF).length} appels`);

// 4. Commande sans adresse : notée, aucun email.
const before = (await brevoLog()).length;
await page.goto(caseUrl); await page.waitForLoadState('networkidle');
sql(`insert into part_needs (organization_id, case_id, designation) select organization_id, id, 'Vis' from service_cases where id = '${caseUrl.split('/').pop()}'`);
await page.reload(); await page.waitForLoadState('networkidle');
await page.locator('.list > div', { hasText: 'Vis' }).getByRole('button', { name: 'Commander' }).click(); await page.waitForURL(/commande=1/);
ok('commande sans adresse : notée, aucun email', sql(`select count(*) from part_orders o join part_needs n on n.id = o.need_id where n.designation = 'Vis'`) === '1'
  && sql(`select count(*) from outbound_messages where subject like '%Vis%'`) === '0' && (await brevoLog()).length === before);

// 5. Passage planifié protégé.
ok('passage planifié refusé sans le secret', (await page.request.get(`${BASE}/api/envois`)).status() === 401);

console.log(results.join('\n'));
console.log('Erreurs navigateur :', errors.length ? errors : 'aucune');
await browser.close();
if (results.some((x) => x.startsWith('FAIL')) || errors.length) process.exit(1);
