// Réception des emails transférés : faux appels du service de réception Brevo, puis écrans du technicien.
// Prérequis : npm run db:reset ; application lancée avec INBOUND_DOMAIN et INBOUND_SECRET (mêmes valeurs ici) ;
// Playwright installé.   npm run test:e2e:reception   (captures dans .local/e2e-reception)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(process.env.PLAYWRIGHT_GLOBAL ?? '/usr/lib/node_modules/')('playwright'); } })();
const pg = require('pg');
const BASE = process.env.E2E_BASE ?? 'http://localhost:3200';
const DB = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54322/crm';
const DOMAIN = process.env.INBOUND_DOMAIN ?? 'reception.essai.be';
const SECRET = process.env.INBOUND_SECRET ?? 'cle-essai-reception-0123456789abcdef';
if (!/localhost|127\.0\.0\.1/.test(DB) || !/localhost|127\.0\.0\.1/.test(BASE)) throw new Error('Services locaux de test uniquement.');
const OUT = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '../../.local/e2e-reception');
mkdirSync(OUT, { recursive: true });
const db = new pg.Client({ connectionString: DB });
await db.connect();
const sql = async (q) => (await db.query({ text: q, rowMode: 'array' })).rows.map((r) => r.join('|')).join('\n');

const TOKEN = await sql(`select o.inbound_token from organizations o join organization_members m on m.organization_id = o.id join auth.users u on u.id = m.user_id where u.email = 'tom@demo.local'`);
const TICKET = await sql(`select number from case_references limit 1`);
const STAMP = Date.now().toString().slice(-6);

let failures = 0;
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const post = (body, cle = SECRET, raw = false) =>
  fetch(`${BASE}/api/reception${cle === null ? '' : `?cle=${encodeURIComponent(cle)}`}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? body : JSON.stringify(body) });
const email = (subject, text, extra = {}) => ({
  items: [{ MessageId: `<${subject.replace(/\W/g, '')}-${STAMP}@mail.test>`, From: { Address: 'tom@demo.local', Name: 'Tom' }, Recipients: [`${TOKEN}@${DOMAIN}`], To: [{ Address: `${TOKEN}@${DOMAIN}` }], Subject: subject, RawTextBody: text, ...extra }],
});

const browser = await (process.env.CHROMIUM_PATH ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) : chromium.launch());
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.url()}`));
const step = async (name, fn) => {
  try {
    await fn();
    console.log('OK  ', name);
  } catch (e) {
    failures++;
    console.log('FAIL', name, '-', e.message.split('\n')[0]);
    await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {});
  }
};

const subjNew = `TR: Ticket R-${STAMP} - fuite adoucisseur`;
const textNew = `À traiter stp\n\n---------- Message transféré ---------\nDe : Bureau SAV <sav@fabricant.example>\nObjet : Ticket R-${STAMP} - fuite adoucisseur\n\nBonjour, client Jean Dupuis, rue des Prés 4, 1300 Wavre, 0470 12 34 56.\nFuite sous l'adoucisseur. <b>urgent</b>`;

await step('réception : clé absente ou fausse refusée, corps invalide refusé', async () => {
  expect((await post(email('x', 'x'), null)).status === 401, 'sans clé');
  expect((await post(email('x', 'x'), 'mauvaise-cle-0123456789abcdef-xyz')).status === 401, 'mauvaise clé');
  expect((await post('pas du json', SECRET, true)).status === 400, 'JSON invalide');
});

await step('réception : un email transféré est rangé, une seule fois', async () => {
  const r1 = await (await post(email(subjNew, textNew, { Attachments: [{ Name: 'photo.jpg', ContentType: 'image/jpeg', ContentLength: 1200, DownloadToken: 't' }] }))).json();
  expect(r1.received === 1, JSON.stringify(r1));
  const r2 = await (await post(email(subjNew, textNew))).json();
  expect(r2.duplicates === 1 && r2.received === 0, JSON.stringify(r2));
  const r3 = await (await post(email(`Ticket ${TICKET} : pièce disponible`, `Bonjour, la pièce du ticket ${TICKET} est disponible.`))).json();
  const r4 = await (await post(email('Publicité', 'Rien à voir'))).json();
  expect(r3.received === 1 && r4.received === 1, JSON.stringify([r3, r4]));
  const unknown = await (await post({ items: [{ Recipients: [`${'0'.repeat(20)}@${DOMAIN}`], Subject: 'x' }] })).json();
  expect(unknown.ignored === 1, JSON.stringify(unknown));
});

await step('connexion du technicien et accueil : demandes à traiter', async () => {
  await page.goto(`${BASE}/connexion`);
  await page.fill('#email', 'tom@demo.local');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);
  const card = page.locator('a[href="/interventions/emails"]', { hasText: 'Demandes reçues à traiter' });
  await card.waitFor();
  expect((await card.locator('.tag').innerText()).trim() === '3', `compteur : ${await card.locator('.tag').innerText()}`);
  await page.screenshot({ path: `${OUT}/r1-accueil.png`, fullPage: true });
});

await step('emails reçus : adresse de réception et liste', async () => {
  await page.goto(`${BASE}/interventions/emails`);
  await page.getByText(`${TOKEN}@${DOMAIN}`).waitFor();
  await page.getByText(`Ticket R-${STAMP} - fuite adoucisseur`).waitFor(); // objet d'origine, sans « TR: »
  await page.getByText('sav@fabricant.example').first().waitFor(); // expéditeur d'origine
  await page.screenshot({ path: `${OUT}/r2-emails.png`, fullPage: true });
});

await step('email : texte affiché tel quel, jamais comme du HTML', async () => {
  await page.getByText(`Ticket R-${STAMP} - fuite adoucisseur`).click();
  await page.waitForURL(/\/interventions\/emails\/[0-9a-f-]{36}$/);
  const body = page.locator('.card.pad.small');
  await body.getByText('<b>urgent</b>', { exact: false }).waitFor();
  expect((await body.locator('b').count()) === 0, 'le HTML de l’email est interprété');
  await page.getByText('photo.jpg').waitFor();
  await page.screenshot({ path: `${OUT}/r3-email.png`, fullPage: true });
});

let createdCase = '';
await step('créer une intervention depuis l’email : lue tout de suite, puis rattachée', async () => {
  await page.getByRole('link', { name: 'Créer une intervention' }).click();
  await page.waitForURL(/\/interventions\/nouvelle\?message=/);
  await page.locator('#clientName, #clientId').first().waitFor(); // lecture lancée sans appuyer
  await page.screenshot({ path: `${OUT}/r4-nouvelle.png`, fullPage: true });
  if (await page.locator('#clientName').count()) {
    if (!(await page.inputValue('#clientName'))) await page.fill('#clientName', 'Jean Dupuis');
  }
  await page.getByRole('button', { name: /^Créer/ }).click();
  await page.waitForURL(/\/interventions\/[0-9a-f-]{36}\?cree=1/);
  createdCase = new URL(page.url()).pathname.split('/')[2];
  const row = await sql(`select status, attached_case_id from inbound_messages where subject = 'Ticket R-${STAMP} - fuite adoucisseur'`);
  expect(row === `attached|${createdCase}`, `email : ${row}`);
});

await step('rattacher un email à un dossier proposé par son ticket', async () => {
  await page.goto(`${BASE}/interventions/emails`);
  await page.getByText(`Ticket ${TICKET} : pièce disponible`).click();
  await page.getByText('Dossier proposé').first().waitFor();
  await page.screenshot({ path: `${OUT}/r5-rattacher.png`, fullPage: true });
  await page.getByRole('button', { name: 'Rattacher à ce dossier' }).first().click();
  await page.waitForURL(/\/interventions\/[0-9a-f-]{36}$/);
  const row = await sql(`select status from inbound_messages where subject = 'Ticket ${TICKET} : pièce disponible'`);
  expect(row === 'attached', `email : ${row}`);
});

await step('ignorer un email', async () => {
  await page.goto(`${BASE}/interventions/emails`);
  await page.getByText('Publicité').click();
  await page.getByRole('button', { name: 'Ignorer cet email' }).click();
  await page.waitForURL(`${BASE}/interventions/emails`);
  await page.getByText('Aucun email à traiter.').waitFor();
  expect(await sql(`select status from inbound_messages where subject = 'Publicité' order by received_at desc limit 1`) === 'ignored', 'statut');
});

await step('réglages : adresse de réception', async () => {
  await page.goto(`${BASE}/reglages`);
  await page.locator('#reception').getByText(`${TOKEN}@${DOMAIN}`).waitFor();
});

await step('néerlandais', async () => {
  await page.goto(`${BASE}/interventions/emails`);
  await page.locator('form.lang button[value=nl]').click();
  await page.getByRole('heading', { name: 'Ontvangen e-mails' }).waitFor();
  await page.getByText('Je ontvangstadres').waitFor();
  await page.screenshot({ path: `${OUT}/r6-nl.png`, fullPage: true });
});

console.log(errors.length ? `Erreurs navigateur : ${errors.join(' | ')}` : 'Erreurs navigateur : aucune');
await browser.close();
await db.end();
process.exit(failures || errors.length ? 1 : 0);
