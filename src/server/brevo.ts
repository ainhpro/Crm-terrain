/**
 * Envoi d'un email par l'API Brevo (serveur uniquement, clé jamais exposée). Chaque appel renvoie un
 * résultat classé, pour ne jamais envoyer deux fois sans le savoir (relecture D03) :
 * - sent : Brevo a accepté (identifiant du message conservé) ;
 * - failed : refus certain (adresse, clé, contenu) — rien n'est parti ;
 * - retry : rien n'a pu partir (serveur injoignable, trop de demandes) — on peut réessayer sans risque ;
 * - uncertain : la demande a pu arriver (coupure, délai dépassé, erreur Brevo) — on ne renvoie pas
 *   automatiquement, l'utilisateur décide.
 */

export interface OutgoingEmail {
  to: { email: string; name?: string };
  from: { email: string; name: string };
  replyTo?: { email: string; name?: string } | null;
  subject: string;
  text: string;
  attachments?: { name: string; content: Uint8Array }[];
  /** Clé stable de l'opération, transmise à Brevo pour retrouver le message en cas de doute. */
  key: string;
}

export type SendOutcome =
  | { kind: 'sent'; providerId: string }
  | { kind: 'failed' | 'retry' | 'uncertain'; error: string };

export interface BrevoConfig {
  apiKey: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

// Erreurs réseau qui prouvent que la demande n'est jamais arrivée chez Brevo.
const NOT_DELIVERED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

export async function sendWithBrevo(cfg: BrevoConfig, mail: OutgoingEmail): Promise<SendOutcome> {
  const body = {
    sender: mail.from,
    to: [mail.to.name ? mail.to : { email: mail.to.email }],
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    subject: mail.subject,
    textContent: mail.text,
    ...(mail.attachments?.length
      ? { attachment: mail.attachments.map((a) => ({ name: a.name, content: Buffer.from(a.content).toString('base64') })) }
      : {}),
    headers: { 'X-Mailin-custom': mail.key },
    tags: ['crm-terrain'],
  };
  let res: Response;
  try {
    res = await (cfg.fetch ?? fetch)(`${cfg.apiUrl ?? 'https://api.brevo.com'}/v3/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 20000),
      cache: 'no-store',
    });
  } catch (e) {
    const code = String((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code ?? (e as Error).name);
    return NOT_DELIVERED.has(code) ? { kind: 'retry', error: code } : { kind: 'uncertain', error: code };
  }
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    /* corps illisible */
  }
  if (res.ok) {
    let id = '';
    try {
      id = String((JSON.parse(detail) as { messageId?: string }).messageId ?? '');
    } catch {
      /* corps inattendu */
    }
    return id ? { kind: 'sent', providerId: id } : { kind: 'uncertain', error: `réponse ${res.status} sans identifiant` };
  }
  const error = `HTTP ${res.status} ${detail.slice(0, 200)}`.trim();
  if (res.status === 429) return { kind: 'retry', error };
  if (res.status >= 500) return { kind: 'uncertain', error };
  return { kind: 'failed', error };
}
