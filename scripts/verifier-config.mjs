// Vérifie la configuration de l'application sur ce poste (.env.local) et dit quoi corriger.
// Ne modifie rien. Usage : npm run config:check
import { resolveMx } from 'node:dns/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { ImapFlow } from 'imapflow';
import pg from 'pg';
import { BAN_HINT, dbPasswordHints, dbUrlProblem } from './supabase/lib.mjs';

const env = (k) => process.env[k]?.trim() || '';
const lines = [];
const ok = (msg) => lines.push(`  OK       ${msg}`);
const todo = (msg, how) => lines.push(`  À FAIRE  ${msg}${how ? `\n           → ${how}` : ''}`);
const info = (msg) => lines.push(`  info     ${msg}`);
const section = (t) => lines.push(`\n${t}`);

section('Base de l\'application');
if (env('SESSION_SECRET').length >= 32) ok('SESSION_SECRET présent');
else todo('SESSION_SECRET manquant ou trop court', 'npm run config:secret, puis coller la valeur dans .env.local');

const supa = env('SUPABASE_URL');
const mode = supa ? 'supabase' : env('AUTH_MODE') === 'dev' ? 'dev' : 'aucun';
info(`Connexion : ${mode === 'supabase' ? 'Supabase (lien + code par email)' : mode === 'dev' ? 'mode développement (email seul, base locale)' : 'non configurée'}`);

section('Supabase');
if (!supa && mode === 'dev') {
  info('Supabase non configuré : mode développement sur la base locale (npm run db:start)');
} else if (!supa) {
  todo('SUPABASE_URL absent', 'Supabase › Project Settings › API › Project URL (voir docs/demarrage-pc.md, étape 3)');
} else if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supa.replace(/\/+$/, ''))) {
  todo('SUPABASE_URL mal formé', 'forme attendue : https://<ref>.supabase.co');
} else {
  ok('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY');
  if (!anon) todo('SUPABASE_ANON_KEY absent', 'Project Settings › API › clé « anon » / « publishable »');
  else {
    try {
      const r = await fetch(`${supa}/auth/v1/settings`, { headers: { apikey: anon } });
      if (r.ok) {
        const j = await r.json();
        ok('Supabase répond, clé publique acceptée');
        if (j?.external?.email !== true) todo('Connexion par email désactivée dans Supabase', 'Authentication › Providers › Email : activer');
      } else todo(`Supabase refuse la clé publique (HTTP ${r.status})`, 'recopier la clé « anon » sans espace');
    } catch (e) {
      todo(`Supabase injoignable (${e.cause?.code ?? e.message})`, 'vérifier la connexion internet et SUPABASE_URL');
    }
  }
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!service) todo('SUPABASE_SERVICE_ROLE_KEY absent (photos, PDF, suppression de compte)', 'Project Settings › API › clé « service_role » / « secret » — ne jamais la partager');
  else {
    try {
      const r = await fetch(`${supa}/storage/v1/bucket/${env('SUPABASE_STORAGE_BUCKET') || 'fichiers'}`, { headers: { apikey: service, authorization: `Bearer ${service}` } });
      if (r.ok) {
        const j = await r.json();
        if (j.public === false) ok('Stockage des fichiers : bucket privé prêt');
        else todo('Le bucket des fichiers est PUBLIC', 'npm run supabase:setup -- --apply (le repasse en privé)');
      } else if (r.status === 400 || r.status === 404) todo('Bucket des fichiers pas encore créé', 'npm run supabase:setup -- --apply');
      else todo(`Clé serveur refusée par Supabase (HTTP ${r.status})`, 'recopier la clé « service_role »');
    } catch {
      todo('Stockage Supabase injoignable');
    }
  }
  if (['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SENDER_EMAIL'].every((k) => env(k))) ok('SMTP des emails de connexion renseigné (appliqué par npm run supabase:setup -- --apply)');
  else todo('SMTP des emails de connexion absent : sur l\'offre gratuite de Supabase, l\'email de connexion n\'a ni le code ni le bon lien', 'Brevo › SMTP & API › SMTP : SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_SENDER_EMAIL dans .env.local, puis npm run supabase:setup -- --apply (docs/demarrage-pc.md, étape 4 bis)');
  if (!env('APP_URL')) todo('APP_URL absent (lien des emails de connexion)', 'sur ce PC : APP_URL=http://localhost:3000');
  else ok(`APP_URL = ${env('APP_URL')}`);
  if (!env('SUPABASE_ACCESS_TOKEN')) info('SUPABASE_ACCESS_TOKEN absent : nécessaire une fois pour npm run supabase:setup (emails de connexion)');
}

section('Base de données');
const dbUrl = env('DATABASE_URL');
if (!dbUrl) todo('DATABASE_URL absent', 'Supabase › bouton « Connect » › « Session pooler » (avec votre mot de passe de base)');
else if (dbUrlProblem(dbUrl)) todo('DATABASE_URL illisible', dbUrlProblem(dbUrl));
else {
  const u = new URL(dbUrl);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  for (const k of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) u.searchParams.delete(k);
  const client = new pg.Client({ connectionString: u.toString(), ssl: local ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    ok(`Connexion à la base (${local ? 'locale' : u.hostname})`);
    const files = readdirSync(join(import.meta.dirname, '..', 'supabase', 'migrations')).filter((f) => /^\d{14}_.+\.sql$/.test(f));
    let applied = new Set();
    try {
      applied = new Set((await client.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version));
    } catch {
      try {
        applied = new Set((await client.query('select name from public._dev_migrations')).rows.map((r) => r.name.slice(0, 14)));
      } catch {
        /* aucune migration encore */
      }
    }
    const missing = files.filter((f) => !applied.has(f.slice(0, 14)));
    if (missing.length) todo(`${missing.length} migration(s) à appliquer sur ${files.length}`, local ? 'npm run db:migrate' : 'npm run supabase:migrate -- --apply');
    else ok(`Schéma à jour (${files.length} migrations)`);
    const formule = await client.query('select public.deployment_formule() as f').then((r) => r.rows[0].f, () => null);
    if (formule) {
      info(`Formule des nouveaux comptes : ${formule === 'technicien' ? 'technicien (interventions seulement)' : 'complète (CRM et interventions)'}`);
      if (env('FORMULE') && env('FORMULE') !== formule) todo(`FORMULE=${env('FORMULE')} dans .env.local, mais la base dit « ${formule} »`, 'npm run supabase:setup -- --apply');
    }
  } catch (e) {
    const m = String(e.message || e.code || 'erreur réseau');
    const where = `${u.hostname}, port ${u.port || 5432}`;
    if (e.code === '28P01' || /password/i.test(m)) todo(`Mot de passe de la base refusé (${where})`, dbPasswordHints(dbUrl, supa).join('\n           → '));
    else if (e.code === 'ECONNREFUSED' && !local) todo(`Connexion refusée par la base (${where})`, BAN_HINT);
    else todo(`Base injoignable (${where}) : ${m.slice(0, 120)}`, 'vérifier DATABASE_URL (adresse « Session pooler », port 5432)');
  } finally {
    await client.end().catch(() => {});
  }
}

section('IA (Claude)');
const key = env('ANTHROPIC_API_KEY');
if (!key) info('ANTHROPIC_API_KEY absent : les comptes rendus seront préparés par les règles simples (l\'application fonctionne quand même)');
else {
  try {
    const client = new Anthropic({ apiKey: key, baseURL: 'https://api.anthropic.com', maxRetries: 0, timeout: 15000 });
    const m = await client.models.retrieve('claude-opus-5-5');
    ok(`Clé Anthropic acceptée, modèle disponible (${m.display_name ?? m.id})`);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) todo('Clé Anthropic refusée', 'console.anthropic.com › API Keys : recopier la clé (commence par sk-ant-)');
    else if (e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError) todo('Modèle non accessible avec cette clé', 'vérifier le crédit du compte : console.anthropic.com › Billing');
    else if (e instanceof Anthropic.APIConnectionError) todo('API Anthropic injoignable', 'vérifier la connexion internet');
    else todo(`Erreur Anthropic : ${e.message}`);
  }
}

section('Envoi des emails (Brevo) — facultatif pour un premier essai');
if (env('BREVO_API_KEY') && env('BREVO_SENDER_EMAIL')) ok('Brevo configuré');
else info('Brevo non configuré : les emails des rapports restent « En file » (rien ne part)');

section('Réception des emails transférés — facultatif');
const imapHost = env('IMAP_HOST').toLowerCase();
const imapUser = env('IMAP_USER').toLowerCase();
const imapPass = process.env.IMAP_PASSWORD ?? '';
const inboundDomain = env('INBOUND_DOMAIN').toLowerCase();
const inboundSecret = env('INBOUND_SECRET');
if (!imapHost && !imapUser && !imapPass && !inboundDomain && !inboundSecret) {
  info('Réception non configurée : les emails de demande se collent à la main (Interventions › Emails reçus)');
}
if (imapHost || imapUser || imapPass) {
  const port = Number(env('IMAP_PORT') || 993);
  const local = ['localhost', '127.0.0.1', '::1'].includes(imapHost);
  if (!imapHost || !imapUser || !imapPass) todo('Relève de la boîte à moitié configurée', 'IMAP_HOST, IMAP_USER (adresse de la boîte) et IMAP_PASSWORD (voir docs/demarrage-pc.md, étape 8 ter)');
  else if (!/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(imapUser)) todo('IMAP_USER doit être l’adresse complète de la boîte, sans « + »');
  else if (!local && port !== 993) todo(`IMAP_PORT=${port} : seule la connexion chiffrée (993) est acceptée`, 'IMAP_PORT=993, ou supprimer la ligne');
  else {
    const client = new ImapFlow({
      host: imapHost, port, secure: port === 993, logger: false, socketTimeout: 20000,
      auth: { user: imapUser, pass: imapHost === 'imap.gmail.com' ? imapPass.replace(/\s+/g, '') : imapPass },
    });
    try {
      await client.connect();
      const box = await client.mailboxOpen('INBOX', { readOnly: true });
      ok(`Boîte ${imapUser} relevée par IMAP (${box.exists} email(s) dans la boîte de réception)`);
      const [l, d] = imapUser.split('@');
      info(`Adresses de réception : ${l}+<jeton>@${d}, une par compte (Interventions › Emails reçus)`);
    } catch (e) {
      const said = String(e.responseText ?? '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 120); // réponse du serveur, sans secret
      if (e.authenticationFailed || /auth|credential|password/i.test(String(e.responseText ?? e.message))) {
        // Gmail : un mot de passe d'application fait 16 lettres minuscules ; seule la forme est examinée, jamais affichée.
        const appPassword = /^[a-z]{16}$/.test(imapPass.replace(/\s+/g, ''));
        todo(`La boîte ${imapUser} refuse le mot de passe${said ? ` (« ${said} »)` : ''}`, imapHost !== 'imap.gmail.com'
          ? 'vérifier IMAP_USER et IMAP_PASSWORD'
          : appPassword
            ? `IMAP_PASSWORD a bien la forme d'un mot de passe d'application : vérifier qu'il a été créé en étant connecté à ${imapUser} (pas à un autre compte Google), et qu'il n'a pas été supprimé`
            : `IMAP_PASSWORD n'est pas un mot de passe d'application (16 lettres) : c'est sans doute le mot de passe du compte. Connecté à ${imapUser} : Sécurité › Validation en deux étapes, puis myaccount.google.com/apppasswords`);
      } else todo(`Boîte injoignable (${e.code ?? String(e.message).slice(0, 80)})`, 'vérifier IMAP_HOST (Gmail : imap.gmail.com) et la connexion internet');
    } finally {
      await client.logout().catch(() => client.close());
    }
  }
}
if (inboundDomain || inboundSecret) {
  if (!inboundDomain || inboundSecret.length < 24) todo('Réception Brevo à moitié configurée', 'INBOUND_DOMAIN (sous-domaine de réception) et INBOUND_SECRET (24 caractères au moins : npm run config:secret)');
  else {
    ok(`Domaine de réception (Brevo) : ${inboundDomain}`);
    try {
      const mx = (await resolveMx(inboundDomain)).map((r) => r.exchange.toLowerCase());
      if (mx.some((h) => h.endsWith('sendinblue.com') || h.endsWith('brevo.com'))) ok('Enregistrements MX vers Brevo');
      else todo(`Les MX de ${inboundDomain} ne pointent pas vers Brevo`, 'MX 10 inbound1.sendinblue.com et MX 20 inbound2.sendinblue.com (voir docs/supabase.md)');
    } catch {
      todo(`Aucun enregistrement MX pour ${inboundDomain}`, 'MX 10 inbound1.sendinblue.com et MX 20 inbound2.sendinblue.com (voir docs/supabase.md)');
    }
    if (!/^https:\/\//.test(env('APP_URL'))) info('APP_URL n’est pas en https : Brevo ne peut transmettre les emails qu’à l’application en ligne');
    else info('Déclaration chez Brevo : npm run brevo:reception -- --apply');
  }
}

console.log(lines.join('\n'));
const left = lines.filter((l) => l.includes('À FAIRE')).length;
console.log(left ? `\n${left} point(s) à faire. Le guide : docs/demarrage-pc.md` : '\nTout est prêt : npm run dev, puis http://localhost:3000');
process.exit(left ? 1 : 0);
