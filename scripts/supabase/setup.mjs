// Configure le projet Supabase pour l'application (idempotent) :
//  1. Auth : adresse du site, liens autorisés, emails de connexion FR/NL (lien vers /auth/confirmer + code) ;
//     SMTP Brevo si ses paramètres sont fournis (le SMTP intégré de Supabase n'écrit qu'à l'équipe du projet).
//  2. Storage : bucket privé des fichiers (photos, signatures, logos, PDF), taille et types limités.
//  3. Formule des nouveaux comptes si FORMULE est renseignée : complete (CRM et interventions) ou
//     technicien (interventions seulement). Les comptes existants ne changent pas.
//   node scripts/supabase/setup.mjs            montre ce qui serait fait (aucune écriture)
//   node scripts/supabase/setup.mjs --apply    applique
import { BUCKET, connectDb, http, managementHeaders, need, projectRef, serviceHeaders } from './lib.mjs';

const apply = process.argv.includes('--apply');
const appUrl = need('APP_URL').replace(/\/+$/, '');
if (!/^https:\/\//.test(appUrl) && !/^http:\/\/localhost(:\d+)?$/.test(appUrl)) {
  console.error('APP_URL doit être en https (ou http://localhost pour un essai).');
  process.exit(2);
}
const ref = projectRef();
const formule = process.env.FORMULE?.trim() || null;
if (formule && !['complete', 'technicien'].includes(formule)) {
  console.error('FORMULE doit valoir « complete » ou « technicien ».');
  process.exit(2);
}
const supabaseUrl = need('SUPABASE_URL').replace(/\/+$/, '');

const link = `{{ .SiteURL }}/auth/confirmer?token_hash={{ .TokenHash }}`;
const template = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#101828;max-width:480px">
<p><b>Connexion</b> — Votre code : <b style="font-size:20px;letter-spacing:2px">{{ .Token }}</b></p>
<p><a href="${link}" style="display:inline-block;background:#1849a9;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Se connecter</a></p>
<hr style="border:none;border-top:1px solid #e4e7ec">
<p><b>Aanmelden</b> — Uw code: <b style="font-size:20px;letter-spacing:2px">{{ .Token }}</b></p>
<p><a href="${link}" style="display:inline-block;background:#1849a9;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Aanmelden</a></p>
<p style="color:#667085;font-size:13px">Ce lien et ce code expirent dans une heure. Vous n'avez rien demandé ? Ignorez cet email.<br>
Deze link en code vervallen binnen een uur. Niets aangevraagd? Negeer deze e-mail.</p>
</div>`;

const auth = {
  site_url: appUrl,
  uri_allow_list: `${appUrl}/**`,
  external_email_enabled: true,
  mailer_otp_exp: 3600,
  mailer_otp_length: 6,
  mailer_subjects_magic_link: 'Votre connexion · Uw aanmelding',
  mailer_templates_magic_link_content: template,
  mailer_subjects_confirmation: 'Votre connexion · Uw aanmelding',
  mailer_templates_confirmation_content: template,
};
const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SENDER_EMAIL'].every((k) => process.env[k]);
if (smtp) {
  Object.assign(auth, {
    smtp_host: process.env.SMTP_HOST,
    smtp_port: process.env.SMTP_PORT || '587',
    smtp_user: process.env.SMTP_USER,
    smtp_pass: process.env.SMTP_PASS,
    smtp_admin_email: process.env.SMTP_SENDER_EMAIL,
    smtp_sender_name: process.env.SMTP_SENDER_NAME || 'Sitôt',
  });
}
const EMAILS_PER_HOUR = 30; // pour tout le projet ; sans SMTP, Supabase le bloque à 2 par heure

const bucket = {
  id: BUCKET,
  name: BUCKET,
  public: false,
  file_size_limit: 10 * 1024 * 1024,
  allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
};

console.log(`Projet ${ref} — site ${appUrl}`);
console.log(`Auth : adresse du site, liens autorisés ${auth.uri_allow_list}, emails FR/NL (lien + code, 1 h)${smtp ? `, SMTP personnalisé, ${EMAILS_PER_HOUR} emails par heure` : ''}.`);
if (!smtp) console.log('  SMTP non fourni : sur l’offre gratuite, Supabase refuse de modifier les emails de connexion (docs/demarrage-pc.md, étape 4 bis).');
console.log(`Storage : bucket « ${BUCKET} » privé, 10 Mo maximum, images et PDF.`);
console.log(formule ? `Formule des nouveaux comptes : ${formule}.` : 'Formule des nouveaux comptes : inchangée (FORMULE non renseignée).');
if (!apply) {
  console.log('Rien n’a été modifié. Relancer avec --apply pour appliquer.');
  process.exit(0);
}

let failed = false;
const r1 = await http(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { method: 'PATCH', headers: managementHeaders(), body: auth });
if (r1.ok) console.log('Auth configurée.');
else if (!smtp && /free tier|custom SMTP/i.test(r1.text)) {
  console.log('ÉCHEC Auth : sur l’offre gratuite, Supabase ne laisse modifier les emails de connexion qu’avec un SMTP externe.');
  console.log('  → Brevo › SMTP & API › SMTP : remplir SMTP_HOST, SMTP_USER, SMTP_PASS et SMTP_SENDER_EMAIL dans .env.local, puis relancer (docs/demarrage-pc.md, étape 4 bis).');
} else console.log(`ÉCHEC Auth (${r1.status}) : ${r1.text.slice(0, 300)}`);
failed ||= !r1.ok;

if (r1.ok && smtp) {
  // Requête à part : mêlée aux réglages SMTP, la limite est ignorée sans erreur (constaté en octobre 2026).
  const r = await http(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { method: 'PATCH', headers: managementHeaders(), body: { rate_limit_email_sent: EMAILS_PER_HOUR } });
  const set = r.ok && r.json?.rate_limit_email_sent === EMAILS_PER_HOUR;
  console.log(set ? `Limite : ${EMAILS_PER_HOUR} emails de connexion par heure.` : `ÉCHEC limite d'envoi (${r.status}) : ${r.text.slice(0, 300)}`);
  failed ||= !set;
}

const exists = await http(`${supabaseUrl}/storage/v1/bucket/${BUCKET}`, { headers: serviceHeaders() });
const r2 = exists.ok
  ? await http(`${supabaseUrl}/storage/v1/bucket/${BUCKET}`, { method: 'PUT', headers: serviceHeaders(), body: bucket })
  : await http(`${supabaseUrl}/storage/v1/bucket`, { method: 'POST', headers: serviceHeaders(), body: bucket });
console.log(r2.ok ? `Bucket « ${BUCKET} » ${exists.ok ? 'mis à jour' : 'créé'} (privé).` : `ÉCHEC Storage (${r2.status}) : ${r2.text.slice(0, 300)}`);
failed ||= !r2.ok;

if (formule) {
  const db = await connectDb();
  try {
    await db.query(`insert into private.settings (key, value) values ('formule', $1) on conflict (key) do update set value = excluded.value`, [formule]);
    console.log(`Formule « ${formule} » enregistrée : elle s’applique aux comptes créés à partir de maintenant.`);
  } catch (e) {
    console.log(`ÉCHEC formule : ${e.message} (les migrations sont-elles appliquées ? npm run supabase:migrate -- --apply)`);
    failed = true;
  } finally {
    await db.end();
  }
}
process.exit(failed ? 1 : 0);
