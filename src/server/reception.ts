import 'server-only';
import { createHash } from 'node:crypto';
import { type InboundEmail, originOf, parseBrevoInbound, type ReceptionScheme, tokensFor } from '@/modules/interventions/inbound';
import { extractTicketNumbers, normalizeTicket } from '@/modules/interventions/references';
import { withService } from './db';

export interface ReceptionResult {
  received: number;
  duplicates: number;
  ignored: number;
}

/** Appel du service de réception Brevo (adresses « <jeton>@<domaine> »). */
export function receiveInbound(payload: unknown, domain: string): Promise<ReceptionResult> {
  return storeInbound(parseBrevoInbound(payload), { kind: 'domain', domain });
}

/**
 * Traitement nommé « réception d'emails » (règle 2 : sans RLS, le contrôle est fait ici), commun à Brevo
 * et à la relève IMAP. Le compte est celui du jeton de l'adresse de réception, jamais celui du ticket ou de
 * l'expéditeur ; chaque requête filtre sur ce compte. L'email est rangé « à traiter » et ne déclenche rien
 * d'autre (cahier § 6 ter). Un même email reçu deux fois n'est gardé qu'une fois.
 */
export async function storeInbound(emails: InboundEmail[], scheme: ReceptionScheme): Promise<ReceptionResult> {
  const result: ReceptionResult = { received: 0, duplicates: 0, ignored: 0 };
  if (!emails.length) return result;
  await withService(async (q) => {
    for (const email of emails) {
      const tokens = tokensFor(scheme, email.recipients);
      const orgs = tokens.length ? (await q<{ id: string }>(`select id from organizations where inbound_token = any($1::text[])`, [tokens])).rows : [];
      if (!orgs.length) {
        result.ignored++;
        continue;
      }
      const origin = originOf(email);
      const fingerprint = createHash('sha256')
        .update(email.messageId ? `message-id\n${email.messageId}` : `${email.from}\n${email.subject}\n${email.text}`)
        .digest('hex');
      const tickets = extractTicketNumbers(origin.subject, email.text).map(normalizeTicket);
      for (const org of orgs) {
        const cases = tickets.length
          ? (await q<{ id: string }>(
              `select distinct case_id as id from case_references where organization_id = $1 and lower(trim(number)) = any($2::text[])`,
              [org.id, tickets],
            )).rows
          : [];
        const ins = await q(
          `insert into inbound_messages (organization_id, channel, message_id, from_address, subject, body_text, attachments, fingerprint, suggested_case_id)
           values ($1, 'forward', $2, $3, $4, $5, $6, $7, $8) on conflict (organization_id, fingerprint) do nothing`,
          [org.id, email.messageId, origin.from, origin.subject, email.text, JSON.stringify(email.attachments), fingerprint, cases.length === 1 ? cases[0]!.id : null],
        );
        if (ins.rowCount) result.received++;
        else result.duplicates++;
      }
    }
  });
  return result;
}
