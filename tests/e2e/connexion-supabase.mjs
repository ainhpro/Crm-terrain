// Connexion Supabase (lien + code) dans un navigateur. Prérequis : l'application lancée avec
// SUPABASE_URL / SUPABASE_ANON_KEY pointant vers un service Auth (réel ou de test) sur le port 3200.
// E2E_CODE : code reçu (le service de test renvoie toujours 123456). E2E_EMAIL : adresse utilisée.
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(process.env.PLAYWRIGHT_GLOBAL ?? '/usr/lib/node_modules/')('playwright'); } })();
const BASE = process.env.E2E_BASE ?? 'http://localhost:3200';
const EMAIL = process.env.E2E_EMAIL ?? 'fabrice@demo.local';
const OUT = '.local/e2e/connexion';
mkdirSync(OUT, { recursive: true });
const browser = await (process.env.CHROMIUM_PATH ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) : chromium.launch());
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const errors = [];

// 1. Lien + code.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/connexion`);
  ok('écran Supabase : pas de connexion par email seul', (await page.getByText(/Mode développement/).count()) === 0 && (await page.getByRole('button', { name: 'Recevoir mon lien de connexion' }).count()) === 1);
  await page.screenshot({ path: `${OUT}/1-email.png` });
  await page.fill('#email', EMAIL); await page.getByRole('button', { name: 'Recevoir mon lien de connexion' }).click();
  await page.getByRole('heading', { name: 'Vérifiez vos emails' }).waitFor();
  ok('l’adresse n’apparaît pas dans l’URL', !page.url().includes(encodeURIComponent(EMAIL)) && !page.url().includes(EMAIL), page.url());
  await page.fill('#code', '999999'); await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.locator('.note.bad, [class*=flash]').filter({ hasText: /expiré|incorrect/ }).first().waitFor();
  ok('mauvais code : message clair, on reste sur la saisie du code', (await page.locator('#code').count()) === 1);
  await page.screenshot({ path: `${OUT}/2-code-refuse.png` });
  await page.fill('#code', process.env.E2E_CODE ?? '123456'); await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/connexion'));
  ok('bon code : connecté', !page.url().includes('/connexion'), new URL(page.url()).pathname);
  await page.screenshot({ path: `${OUT}/3-connecte.png` });
  await ctx.close();
}

// 2. Lien de l'email : ouvrir la page ne connecte pas ; le bouton, oui.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => errors.push(String(e)));
  const hash = `pkce_${Buffer.from(EMAIL).toString('base64url')}`;
  await page.goto(`${BASE}/auth/confirmer?token_hash=${hash}`);
  const cookies = (await ctx.cookies()).map((c) => c.name);
  ok('ouvrir le lien ne consomme rien', !cookies.includes('crm_session'));
  await page.screenshot({ path: `${OUT}/4-confirmer.png` });
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'));
  ok('bouton du lien : connecté', !page.url().includes('/connexion'), new URL(page.url()).pathname);
  await ctx.close();
}

// 3. Un cookie de développement correctement signé est refusé quand Supabase est configuré.
if (process.env.SESSION_SECRET && process.env.E2E_USER_ID) {
  const ctx = await browser.newContext();
  const payload = `d.${process.env.E2E_USER_ID}`;
  const sig = createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  await ctx.addCookies([{ name: 'crm_session', value: `${payload}.${sig}`, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  ok('cookie de développement refusé en mode Supabase', page.url().includes('/connexion'), new URL(page.url()).pathname);
  await ctx.close();
}

console.log(results.join('\n'));
console.log('Erreurs navigateur :', errors.length ? errors : 'aucune');
await browser.close();
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exit(1);
