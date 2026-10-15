// Parcours complet dans un vrai navigateur, à la taille d'un téléphone.
// Prérequis : npm run db:reset, puis npm run dev (port 3200 : PORT=3200), Playwright installé.
//   npm run test:e2e            (captures dans .local/e2e)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(process.env.PLAYWRIGHT_GLOBAL ?? '/usr/lib/node_modules/')('playwright'); } })();
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE ?? 'http://localhost:3200';
// Connexion : email seul (développement) ou email puis code (Supabase Auth ; E2E_CODE fourni par le service de test).
async function login(p, email) {
  await p.fill('#email', email);
  await p.click('button[type=submit]');
  await Promise.race([p.waitForURL((u) => !u.pathname.startsWith('/connexion')), p.locator('#code').waitFor()]);
  if (await p.locator('#code').count()) {
    await p.fill('#code', process.env.E2E_CODE ?? '123456');
    await p.click('button[type=submit]');
    await p.waitForURL((u) => !u.pathname.startsWith('/connexion'));
  }
}
const TICKET = 'T' + Date.now().toString().slice(-6);
const out = process.argv[2] ?? join(HERE, '../../.local/e2e');
mkdirSync(out, { recursive: true });
const browser = await (process.env.CHROMIUM_PATH ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) : chromium.launch());
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
let failures = 0;
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { failures++; console.log('FAIL', name, '-', e.message.split('\n')[0]); await shot(`fail-${name.replace(/\W+/g, '-')}`); } };

await step('connexion', async () => {
  await page.goto(`${BASE}/connexion`);
  await login(page, 'fabrice@demo.local');
  await page.waitForURL(`${BASE}/`);
  await page.getByRole('heading', { name: /Bonjour/ }).waitFor();
  await shot('01-aujourdhui');
});
await step('clients', async () => {
  await page.goto(`${BASE}/clients`);
  await page.getByText('FACQ Geel').first().waitFor();
  await shot('02-clients');
});
await step('fiche client', async () => {
  await page.getByRole('link', { name: /FACQ Geel/ }).first().click();
  await page.getByRole('heading', { name: 'FACQ Geel' }).waitFor();
  await page.getByText('Étape').first().waitFor();
  await shot('03-fiche');
});
await step('compte rendu', async () => {
  await page.getByRole('link', { name: /Dicter le compte rendu/ }).click();
  await page.waitForLoadState('networkidle');
  await page.fill('#text', "Je sors de chez FACQ Geel. Le responsable a confirmé la commande. Il faut planifier le placement le 3 novembre. Prévoir la formation parois dans deux semaines.");
  await page.getByRole('button', { name: /Préparer/ }).click();
  await page.getByText('Ce qui sera mis à jour').waitFor();
  await shot('04-compte-rendu');
  await page.getByRole('button', { name: 'Valider' }).click();
  await page.waitForURL(/ok=1/);
  await page.getByText('Il faut planifier le placement').first().waitFor();
  await shot('05-fiche-apres');
});
await step('import', async () => {
  await page.goto(`${BASE}/clients/importer`);
  await page.setInputFiles('#file', join(HERE, 'clients.csv'));
  await page.getByRole('button', { name: 'Lire le fichier' }).click();
  await page.getByRole('heading', { name: 'Bilan' }).waitFor();
  await shot('06-import');
  await page.getByRole('button', { name: /Importer les lignes valides \(2\)/ }).click();
  await page.waitForURL(/importes=2/);
});
await step('nouvelle intervention depuis un email', async () => {
  await page.goto(`${BASE}/interventions/nouvelle`);
  await page.fill('#subject', `Ticket ${TICKET} — SAV meuble salle de bain`);
  await page.fill('#body', "Bonjour,\nM. Test signale une porte de meuble mal alignée.\nAdresse : Rue Haute 5, 1000 Bruxelles\nTél. 0475 99 88 77 — test@client.example\nSous garantie.\nCordialement");
  await page.getByRole('button', { name: 'Lire la demande' }).click();
  await page.getByText('Ce que nous avons compris').waitFor();
  await page.selectOption('#principalId', { label: 'INDA' });
  await page.fill('#clientName', 'M. Test');
  await page.fill('#when', '2026-10-20T10:00');
  await shot('07-demande');
  await page.getByRole('button', { name: 'Créer et planifier' }).click();
  await page.waitForURL(/cree=1/);
  await shot('08-dossier');
});
await step('passage : arrivée, photo, pièce, départ', async () => {
  await page.getByRole('link', { name: /20 oct/ }).first().click();
  await page.getByRole('button', { name: /arrivé/ }).click();
  await page.getByRole('button', { name: 'Je pars' }).waitFor();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('input[name=photo][capture]', { name: 'p.png', mimeType: 'image/png', buffer: png });
  await page.locator('form:has(input[name=kind])').getByRole('button', { name: 'Enregistrer' }).click();
  await page.locator('.photos img').first().waitFor();
  await page.getByText('Ajouter une ligne à commander').click();
  await page.locator('details[open] input[name=reference]').fill('4512-08');
  await page.locator('details[open] input[name=designation]').fill("Charnière de porte");
  await page.locator('details[open]').getByRole('button', { name: 'Ajouter' }).click();
  await page.getByRole('button', { name: 'Je pars' }).click();
  await shot('09-passage');
});
await step('rapport validé et PDF', async () => {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.fill('textarea[name=done]', 'Diagnostic : charnière cassée. Porte réglée provisoirement.');
  await page.fill('textarea[name=todo]', 'Remplacer la charnière à réception.');
  await page.getByLabel(/Taux horaire/).fill('50');
  await shot('10a-avant-signature');
  const pad = page.locator('canvas.sig');
  await pad.scrollIntoViewIfNeeded();
  const b = await pad.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 40); await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y + 90, { steps: 8 }); await page.mouse.move(b.x + 220, b.y + 50, { steps: 8 }); await page.mouse.up();
  await shot('10-rapport');
  await page.getByRole('button', { name: 'Valider et envoyer' }).click();
  await page.waitForURL(/valide=1/);
  await page.getByText('Cette version est figée').waitFor();
  const href = await page.getByRole('link', { name: 'Voir le PDF' }).first().getAttribute('href');
  const res = await page.request.get(`${BASE}${href}`);
  if (res.headers()['content-type'] !== 'application/pdf') throw new Error('pas de PDF');
  const fs = await import('node:fs'); fs.writeFileSync(`${out}/rapport.pdf`, await res.body());
  await shot('11-valide');
});
await step('dossier : commande puis email de réception', async () => {
  await page.getByRole('link', { name: 'Retour' }).click();
  await page.getByRole('button', { name: 'Commander' }).click();
  await page.waitForURL(/commande=1/);
  await page.goto(`${BASE}/interventions/emails`);
  // Formulaire « coller un email » replié quand la réception par transfert est configurée.
  const paste = page.locator('details:has(input[name=subject])');
  if ((await paste.getAttribute('open')) === null) await paste.locator('summary').click();
  await page.fill('input[name=subject]', `Ticket ${TICKET} — pièce disponible`);
  await page.getByRole('button', { name: 'Intégrer' }).click();
  await page.getByText('Dossier proposé').first().waitFor();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rattacher à ce dossier' }).click();
  await page.getByText('Retour à planifier').first().waitFor();
  await shot('12-suivi');
});
await step('recherche par ticket', async () => {
  await page.goto(`${BASE}/interventions?q=${TICKET}`);
  await page.getByText('M. Test').first().waitFor();
});
await step('réglages', async () => {
  await page.goto(`${BASE}/reglages`);
  await page.getByRole('heading', { name: 'Réglages' }).waitFor();
  await shot('13-reglages');
});
await step('néerlandais', async () => {
  await page.getByRole('button', { name: 'Nederlands' }).click();
  await page.getByRole('heading', { name: 'Instellingen' }).waitFor();
  await page.goto(`${BASE}/`);
  await page.getByText('Vandaag').first().waitFor();
  await shot('14-nl');
  await page.getByRole('button', { name: 'Français' }).click();
});
await step('isolation : un autre compte ne voit rien', async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/connexion`);
  await login(p2, 'autre@demo.local');
  await p2.waitForURL(/bienvenue/);
  await p2.fill('#orgName', 'Autre société');
  await p2.getByRole('button', { name: 'Commencer' }).click();
  await p2.waitForURL(/demarrer/);
  await p2.goto(`${BASE}/clients`);
  if (await p2.getByText('FACQ Geel').count()) throw new Error('fuite : voit FACQ Geel');
  const r = await p2.request.get(`${BASE}/interventions`);
  if ((await r.text()).includes('M. Test')) throw new Error('fuite : voit M. Test');
  await ctx2.close();
});
const real = errors.filter((e) => !/caret-color|favicon|404/.test(e));
console.log('Erreurs navigateur :', real.length ? real.slice(0, 5) : 'aucune');
await browser.close();

if (failures) process.exitCode = 1;
