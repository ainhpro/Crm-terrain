// Déclare chez Brevo la réception des emails transférés (« inbound parsing »), une fois l'application en ligne :
// les emails envoyés à <jeton>@INBOUND_DOMAIN sont transmis à APP_URL/api/reception?cle=INBOUND_SECRET.
// Prérequis : enregistrements MX de INBOUND_DOMAIN vers Brevo (voir docs/supabase.md) et domaine vérifié chez Brevo.
//   npm run brevo:reception            montre ce qui serait fait (aucune écriture)
//   npm run brevo:reception -- --apply crée la déclaration chez Brevo (rien si elle existe déjà)
import { http, need } from './supabase/lib.mjs';

const apply = process.argv.includes('--apply');
const key = need('BREVO_API_KEY');
const appUrl = need('APP_URL').replace(/\/+$/, '');
const domain = need('INBOUND_DOMAIN').toLowerCase();
const secret = need('INBOUND_SECRET');
if (!/^https:\/\//.test(appUrl)) {
  console.error('APP_URL doit être l’adresse https de l’application en ligne : Brevo ne peut pas joindre ce PC.');
  process.exit(2);
}
if (secret.length < 24) {
  console.error('INBOUND_SECRET doit compter au moins 24 caractères (npm run config:secret en donne un).');
  process.exit(2);
}
const url = `${appUrl}/api/reception?cle=${encodeURIComponent(secret)}`;
const shown = url.replace(encodeURIComponent(secret), '••••••');
const headers = { 'api-key': key, accept: 'application/json' };

const list = await http('https://api.brevo.com/v3/webhooks?type=inbound', { headers });
if (!list.ok) {
  console.error(`Brevo refuse la lecture des déclarations (HTTP ${list.status}) : ${list.text.slice(0, 200)}`);
  process.exit(1);
}
const existing = (list.json?.webhooks ?? []).find((w) => w.url === url);
console.log(`Domaine de réception : ${domain}`);
console.log(`Adresse d'appel : ${shown}`);
if (existing) {
  console.log(`Déjà déclarée chez Brevo (n° ${existing.id}). Rien à faire.`);
  process.exit(0);
}
const others = (list.json?.webhooks ?? []).filter((w) => String(w.url ?? '').includes('/api/reception'));
if (others.length) console.log(`Attention : ${others.length} autre(s) déclaration(s) vers /api/reception (ancienne clé ?) : à supprimer dans Brevo si elles ne servent plus.`);
if (!apply) {
  console.log('Rien n’a été modifié. Relancer avec --apply pour déclarer la réception chez Brevo.');
  process.exit(0);
}
const r = await http('https://api.brevo.com/v3/webhooks', {
  method: 'POST',
  headers,
  body: { type: 'inbound', events: ['inboundEmailProcessed'], url, domain, description: 'Réception des emails transférés' },
});
console.log(r.ok ? `Réception déclarée chez Brevo (n° ${r.json?.id ?? '?'}).` : `ÉCHEC (HTTP ${r.status}) : ${r.text.slice(0, 300)}`);
process.exit(r.ok ? 0 : 1);
