// Contrôles navigateur de la relecture V1 (D01, D02, M02, M03, M04, P02, R02).
// Prérequis : npm run db:reset (données de démonstration), puis l'application sur le port 3200.
// Modifie la base de démonstration (c'est voulu) : relancer db:reset ensuite pour la retrouver intacte.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(process.env.PLAYWRIGHT_GLOBAL ?? '/usr/lib/node_modules/')('playwright'); } })();
const BASE = process.env.E2E_BASE ?? 'http://localhost:3200';
const DB = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54322/crm';
if (!/localhost|127\.0\.0\.1/.test(DB)) throw new Error('Base locale de démonstration uniquement.');
const OUT = '.local/e2e/relecture';
mkdirSync(OUT, { recursive: true });
const sql = (s) => execFileSync('psql', [DB, '-Atc', s]).toString().trim();
const pdfText = (buf, name) => { writeFileSync(`${OUT}/${name}.pdf`, buf); return execFileSync('pdftotext', [`${OUT}/${name}.pdf`, '-']).toString(); };
sql(`insert into contacts (organization_id, client_id, name, email) select organization_id, id, 'Mme Exemple', 'mme@client.example' from clients where name = 'Mme Exemple'`);
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const browser = await (process.env.CHROMIUM_PATH ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) : chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage(); page.setDefaultTimeout(30000);
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/connexion`); await page.fill('#email', 'fabrice@demo.local'); await page.click('button[type=submit]'); await page.waitForURL(`${BASE}/`);

// Rapport : PDF figés, remarques internes absentes du PDF client.
await page.goto(`${BASE}/interventions`); await page.getByRole('link', { name: /Mme Exemple/ }).first().click(); await page.waitForLoadState('networkidle');
const caseUrl = page.url();
await page.getByRole('link', { name: /Planifié/ }).first().click(); await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: /arrivé/ }).click(); await page.getByRole('button', { name: 'Je pars' }).waitFor();
await page.getByText('Ajouter une ligne à commander').click();
await page.fill('details[open] input[name=designation]', 'Joint silicone');
await page.fill('details[open] input[name=quantity]', '3');
await page.locator('details[open]').getByRole('button', { name: 'Ajouter' }).click(); await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: 'Je pars' }).click(); await page.waitForLoadState('networkidle');
await page.getByText('Arrivée / Départ / Pauses').click();
await page.locator('details[open] input[name=arrived]').fill('2026-10-10T10:00');
await page.locator('details[open] input[name=left]').fill('2026-10-10T10:07');
await page.locator('details[open]').getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForLoadState('networkidle');
await page.waitForTimeout(1200);
await page.fill('textarea[name=done]', 'Joint refait.');
await page.fill('textarea[name=remarks]', 'REMARQUE-INTERNE client difficile');
await page.getByLabel(/Taux horaire/).fill('60');
const calc = await page.locator('dl').innerText();
ok('M04 détail du calcul affiché', /Temps travaillé réel/.test(calc) && /0 h 15/.test(calc), calc.replace(/\s+/g, ' '));
const pad = page.locator('canvas.sig'); await pad.evaluate((el) => el.scrollIntoView({ block: 'center' }));
const b = await pad.boundingBox(); await page.mouse.move(b.x + 30, b.y + 80); await page.mouse.down();
for (const [x, y] of [[80, 40], [130, 100], [180, 50]]) await page.mouse.move(b.x + x, b.y + y, { steps: 5 });
await page.mouse.up();
for (const box of await page.locator('input[name=recipient]:not([disabled])').all()) await box.check();
await page.getByRole('button', { name: 'Valider et envoyer' }).click(); await page.waitForURL(/valide=1/);
const rid = sql(`select rv.id from report_versions rv join service_visits v on v.id = rv.visit_id join service_cases sc on sc.id = v.case_id join clients c on c.id = sc.client_id where c.name = 'Mme Exemple' and rv.status = 'validated' order by validated_at desc limit 1`);
const get = async (q = '') => Buffer.from(await (await page.request.get(`${BASE}/rapports/${rid}/pdf${q}`)).body());
const before = await get(); const client = await get('?pour=client');
const tP = pdfText(before, 'principal'), tC = pdfText(client, 'client');
ok('R02 PDF donneur d’ordre : remarques présentes', tP.includes('REMARQUE-INTERNE'));
ok('R02 PDF client : remarques absentes', !tC.includes('REMARQUE-INTERNE'));
ok('M04 durée retenue figée 15 min', /0 h 15/.test(tP));
sql(`update organizations set company_name = 'SOCIETE-MODIFIEE' where name = 'INDA'`);
sql(`update visit_workers set left_at = left_at + interval '2 hours' where visit_id = (select visit_id from report_versions where id = '${rid}')`);
const after = await get();
ok('D02 PDF identique après modification société et heures', Buffer.compare(before, after) === 0);
const body = sql(`select string_agg(audience || ':' || (coalesce(body,'') like '%REMARQUE-INTERNE%')::text, ',') from outbound_messages where report_version_id = '${rid}'`);
ok('R02 envois : remarques vers le donneur d’ordre, jamais vers le client', /principal:true/.test(body) && /client:false/.test(body) && !/client:true/.test(body), body);

// Pièces : réception partielle, email « disponible » sans réception automatique.
await page.goto(caseUrl); await page.waitForLoadState('networkidle');
const row = page.locator('.list > div', { hasText: 'Joint silicone' });
await row.locator('input[name=quantity]').fill('1');
await row.getByRole('button', { name: 'Pièce reçue' }).click();
await page.locator('.list > div', { hasText: 'Joint silicone' }).getByText('Reçue en partie').waitFor({ timeout: 10000 }).catch(() => undefined);
const status = sql(`select status from service_cases where id = '${caseUrl.split('/').pop()}'`);
const rowText = await page.locator('.list > div', { hasText: 'Joint silicone' }).innerText();
ok('M03 réception partielle : 1 reçu sur 3, dossier pas « à planifier »', /Reçue en partie/.test(rowText) && status !== 'return_to_plan', `${status} / ${rowText.replace(/\s+/g, ' ')}`);
await page.goto(`${BASE}/interventions/emails`);
await page.fill('input[name=subject]', 'Ticket 2026-0457 — pièce disponible'); await page.fill('textarea[name=body]', 'La pièce est disponible.');
await page.getByRole('button', { name: /Intégrer/ }).click();
await page.getByText(/Disponible.*n’est pas/).waitFor();
const boxes = await page.locator('input[name=receive]').evaluateAll((els) => els.map((e) => e.checked));
ok('M03 email « disponible » : lignes à cocher, rien de coché d’office', boxes.length > 0 && boxes.every((x) => !x), JSON.stringify(boxes));
await page.getByRole('button', { name: /Rattacher/ }).first().click(); await page.waitForLoadState('networkidle');
const received = sql(`select coalesce(sum(r.quantity),0) from part_receipts r join part_needs n on n.id = r.need_id where n.designation = 'Joint silicone'`);
ok('M03 rattacher sans cocher ne reçoit rien', received === '1', received);

// Compte rendu : négation.
await page.goto(`${BASE}/clients`); await page.getByRole('link', { name: /FACQ Geel/ }).first().click(); await page.waitForLoadState('networkidle');
await page.goto(`${page.url()}/compte-rendu`);
await page.fill('#text', "Je n'ai pas envoyé l'offre showroom. Relancer le responsable demain.");
await page.getByRole('button', { name: 'Préparer la mise à jour' }).click();
await page.getByText('Ce qui sera mis à jour').waitFor();
const stepValue = await page.locator('select[name=step]').inputValue();
ok('M02 « je n’ai pas envoyé l’offre » : aucune étape cochée, phrase montrée', stepValue === '' && (await page.getByText(/Non retenu/).count()) > 0);
// Brouillon gardé sur l'appareil.
await page.reload(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500);
ok('P02 brouillon récupéré après rechargement', (await page.locator('#text').inputValue()).startsWith("Je n'ai pas"));
await ctx.setOffline(true); await page.waitForTimeout(300);
ok('P02 bandeau hors connexion', (await page.getByText(/Hors connexion/).count()) > 0);
await ctx.setOffline(false);

// Réglages : parcours suivis par des affaires en cours.
await page.goto(`${BASE}/reglages#etapes`); await page.waitForLoadState('networkidle');
ok('D01 étapes verrouillées signalées', (await page.getByText(/affaire\(s\) en cours suivent ce parcours/).count()) > 0);

// M01 : seules les actions cochées sont closes ; une relance rattachée à l'étape reste ouverte.
{
  const deal = sql(`select d.id from deals d join clients c on c.id = d.client_id where c.name = 'FACQ Geel' and d.name = 'MAJ showroom 2026'`);
  const step = sql(`select s.id from pipeline_steps s join deals d on d.pipeline_id = s.pipeline_id where d.id = '${deal}' and s.code = 'commande'`);
  sql(`insert into actions (organization_id, client_id, deal_id, step_id, kind, status, due_date, note)
       select organization_id, client_id, id, '${step}', 'step', x.status, '2026-10-20', x.note from deals,
       (values ('todo', 'Passer la commande M01'), ('follow_up', 'Relancer vendredi M01')) as x(status, note) where id = '${deal}'`);
  await page.goto(`${BASE}/clients`); await page.getByRole('link', { name: /FACQ Geel/ }).first().click(); await page.waitForLoadState('networkidle');
  await page.goto(`${page.url()}/compte-rendu`);
  await page.fill('#text', 'Le responsable a confirmé la commande.');
  await page.getByRole('button', { name: 'Préparer la mise à jour' }).click();
  await page.getByText('Ce qui sera mis à jour').waitFor();
  const todo = page.locator('label', { hasText: 'Passer la commande M01' }).locator('input');
  const follow = page.locator('label', { hasText: 'Relancer vendredi M01' }).locator('input');
  ok('M01 clôtures proposées : l’action de l’étape cochée, la relance non', (await todo.isChecked()) && !(await follow.isChecked()));
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await page.waitForURL(/ok=1/);
  const st = sql(`select string_agg(status, ',' order by note) from actions where note like '%M01'`);
  ok('M01 après validation : action close, relance toujours ouverte', st === 'done,follow_up', st);
}

// U01 : technicien sans l'option « signature » — rapport validé sans signature, motif fidèle.
{
  sql(`update member_settings set options = options || '{"signature": false}' where user_id = (select id from auth.users where email = 'tom@demo.local')`);
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await c2.newPage(); p2.setDefaultTimeout(30000);
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto(`${BASE}/connexion`); await p2.fill('#email', 'tom@demo.local'); await p2.click('button[type=submit]'); await p2.waitForURL(`${BASE}/`);
  const [caseId, visitId] = sql(`select sc.id || '|' || v.id from service_visits v join service_cases sc on sc.id = v.case_id join clients c on c.id = sc.client_id where c.name = 'M. Exemple' limit 1`).split('|');
  await p2.goto(`${BASE}/interventions/${caseId}/passages/${visitId}`); await p2.waitForLoadState('networkidle');
  ok('U01 sans option signature : pas de zone de signature', (await p2.locator('canvas.sig').count()) === 0);
  await p2.fill('textarea[name=done]', 'Mesures prises.');
  await p2.getByRole('button', { name: 'Valider et envoyer' }).click(); await p2.waitForURL(/valide=1/);
  const rid = sql(`select id from report_versions where visit_id = '${visitId}' and status = 'validated'`);
  const text = pdfText(Buffer.from(await (await p2.request.get(`${BASE}/rapports/${rid}/pdf`)).body()), 'u01');
  ok('U01 rapport validé, PDF : « Signature non requise selon les réglages »', /Signature non requise selon les r/.test(text) && !/motif/.test(text));
  await c2.close();
}

console.log(results.join('\n'));
console.log('Erreurs navigateur :', errors.length ? errors : 'aucune');
await browser.close();
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exit(1);
