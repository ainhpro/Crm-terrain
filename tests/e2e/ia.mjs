// IA (compte rendu, lecture d'email) dans un navigateur, contre un service Messages de test.
// Prérequis : npm run db:reset ; faux service sur AI_MOCK (défaut http://localhost:54404, avec /mode et /log) ;
// application lancée avec ANTHROPIC_API_KEY=<n'importe quoi> et AI_TEST_BASE_URL=<faux service>.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(process.env.PLAYWRIGHT_GLOBAL ?? '/usr/lib/node_modules/')('playwright'); } })();
const BASE = process.env.E2E_BASE ?? 'http://localhost:3200';
const MOCK = process.env.AI_MOCK ?? 'http://localhost:54404';
const results = [];
const errors = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const browser = await (process.env.CHROMIUM_PATH ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) : chromium.launch());
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/connexion`); await page.fill('#email', 'fabrice@demo.local'); await page.click('button[type=submit]'); await page.waitForURL(`${BASE}/`);

const report = async (text) => {
  await page.goto(`${BASE}/clients`); await page.getByRole('link', { name: /FACQ Geel/ }).first().click(); await page.waitForLoadState('networkidle');
  await page.goto(`${page.url()}/compte-rendu`);
  await page.fill('#text', text);
  await page.getByRole('button', { name: 'Préparer la mise à jour' }).click();
  await page.getByText('Ce qui sera mis à jour').waitFor();
};

// 1. Compte rendu : proposition de l'IA, contrôlée et sourcée.
await fetch(`${MOCK}/mode?m=ok`);
await report('Rendez-vous fait avec le responsable. Offre envoyée au responsable hier soir. Rappeler le responsable lundi prochain.');
const step = await page.locator('select[name=step] option:checked').innerText();
ok('compte rendu : préparé par l’IA (annoncé)', (await page.getByText(/préparée par l’IA/).count()) === 1);
ok('étape proposée par l’IA, avec sa source', /Offre/.test(step) && (await page.getByText(/Offre envoyée au responsable hier soir/).count()) > 0, step);
ok('tâche datée par l’IA, modifiable avant validation', (await page.locator('input[name=task]').first().inputValue()) === 'Rappeler le responsable' && (await page.locator('input[name=taskDue]').first().inputValue()) === '2026-10-19');

// 2. Service IA indisponible : les règles locales prennent le relais, sans erreur.
await fetch(`${MOCK}/mode?m=down`);
await report("J'ai envoyé l'offre showroom. Rappeler demain.");
ok('IA indisponible : proposition par les règles simples, annoncée', (await page.getByText(/préparée par des règles simples/).count()) === 1);

// 3. Demande par email lue par l'IA ; un champ inventé n'apparaîtrait pas (contrôle du code).
await fetch(`${MOCK}/mode?m=ok`);
await page.goto(`${BASE}/interventions/nouvelle`);
await page.fill('#subject', 'Dossier INC-7781 — adoucisseur');
await page.fill('#body', "Bonjour,\nNotre adoucisseur ne fonctionne plus depuis lundi.\nClaire Martin, Place du Marché 3, 4000 Liège\nGSM 0476 12 34 56 — claire@client.example\nL'appareil hors garantie.\nMerci");
await page.getByRole('button', { name: 'Lire la demande' }).click();
await page.getByText('Ce que nous avons compris').waitFor();
const html = await page.content();
ok('email lu par l’IA (annoncé), ticket et coordonnées repris', (await page.getByText(/Lu par l’IA/).count()) === 1 && html.includes('INC-7781') && html.includes('claire@client.example'));

const log = await (await fetch(`${MOCK}/log`)).json();
ok('appels : modèle, effort bas, repli en cas de refus', log.length >= 3 && log.every((l) => l.model === 'claude-opus-5-5' && l.effort === 'low' && l.fallbacks === 'default' && /server-side-fallback-2026-07-01/.test(l.beta)), `${log.length} appels`);
console.log(results.join('\n'));
console.log('Erreurs navigateur :', errors.length ? errors : 'aucune');
await browser.close();
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exit(1);
