import 'server-only';
import { type OutgoingEmail, type SendOutcome } from './brevo';
import { getMessages, isLocale } from '@/i18n';
import { withService } from './db';
import { renderReportPdf } from './pdf';
import { readStored } from './storage';

/**
 * Traitement serveur nommé « envois » (règle 2 : clé de service, il vérifie lui-même l'entreprise :
 * chaque message n'est construit qu'avec les données de sa propre entreprise).
 * 1. Les messages restés « sending » au-delà de leur verrou passent « uncertain » (traitement
 *    interrompu : on ne sait pas si Brevo a reçu la demande) — jamais renvoyés d'office.
 * 2. Prise en charge avec « for update skip locked » : deux traitements simultanés ne prennent jamais
 *    le même message.
 * 3. Envoi, puis enregistrement du résultat classé (sent / failed / queued si rien n'est parti /
 *    uncertain), seulement si le message est toujours à nous (status = 'sending').
 */

export type Send = (mail: OutgoingEmail) => Promise<SendOutcome>;

export interface OutboxResult {
  sent: number;
  failed: number;
  retry: number;
  uncertain: number;
  expired: number;
}

interface Claimed {
  id: string;
  organization_id: string;
  kind: string;
  audience: 'principal' | 'client';
  recipient_label: string;
  recipient_email: string | null;
  subject: string | null;
  body: string | null;
  idempotency_key: string;
  report_version_id: string | null;
}

export async function processOutbox(send: Send, opts: { sender: { email: string; name?: string }; limit?: number; lockSeconds?: number }): Promise<OutboxResult> {
  const result: OutboxResult = { sent: 0, failed: 0, retry: 0, uncertain: 0, expired: 0 };
  result.expired = await withService(async (q) =>
    (await q(
      `update outbound_messages set status = 'uncertain', locked_until = null, updated_at = now(),
              last_error = 'traitement interrompu pendant l''envoi : vérifier avant de renvoyer'
       where status = 'sending' and locked_until < now()`,
    )).rowCount ?? 0,
  );

  const claimed = await withService(async (q) =>
    (await q<Claimed>(
      `update outbound_messages m set status = 'sending', attempts = m.attempts + 1, updated_at = now(),
              locked_until = now() + make_interval(secs => $2)
       where m.id in (select id from outbound_messages where status = 'queued' order by created_at limit $1 for update skip locked)
       returning m.id, m.organization_id, m.kind, m.audience, m.recipient_label, m.recipient_email, m.subject, m.body,
                 m.idempotency_key, m.report_version_id`,
      [opts.limit ?? 20, opts.lockSeconds ?? 120],
    )).rows,
  );

  for (const m of claimed) {
    let outcome: SendOutcome;
    try {
      outcome = m.recipient_email ? await send(await compose(m, opts.sender)) : { kind: 'failed', error: 'adresse email manquante' };
    } catch (e) {
      // Erreur avant l'appel (pièce jointe illisible…) : rien n'est parti.
      outcome = { kind: 'retry', error: (e as Error).message.slice(0, 200) };
    }
    await withService((q) =>
      q(
        `update outbound_messages set updated_at = now(), locked_until = null,
                -- Rien n'est parti : on réessaie, au plus 5 tentatives au total, puis échec visible.
                status = case $2 when 'sent' then 'sent' when 'failed' then 'failed'
                                 when 'retry' then (case when attempts >= 5 then 'failed' else 'queued' end) else 'uncertain' end,
                sent_at = case when $2 = 'sent' then now() else sent_at end,
                provider_message_id = coalesce($3, provider_message_id),
                last_error = case when $2 = 'sent' then null else $4 end
         where id = $1 and status = 'sending'`,
        [m.id, outcome.kind, outcome.kind === 'sent' ? outcome.providerId : null, outcome.kind === 'sent' ? null : outcome.error],
      ),
    );
    result[outcome.kind]++;
  }
  return result;
}

/** Construit l'email avec les données de l'entreprise du message (expéditeur, réponse, PDF figé du bon public). */
async function compose(m: Claimed, sender: { email: string; name?: string }): Promise<OutgoingEmail> {
  const org = (await withService((q) =>
    q<{ name: string; company_name: string | null; email: string | null; pdf: string | null; version: number | null }>(
      `select o.name, o.company_name, o.email,
              (select case when $2 = 'client' then rv.client_pdf_path else rv.pdf_path end
               from report_versions rv where rv.id = $3 and rv.organization_id = o.id) as pdf,
              (select rv.version from report_versions rv where rv.id = $3 and rv.organization_id = o.id) as version
       from organizations o where o.id = $1`,
      [m.organization_id, m.audience, m.report_version_id],
    ),
  )).rows[0];
  if (!org) throw new Error('entreprise introuvable');
  let pdf: Uint8Array | null = org.pdf ? await readStored(org.pdf) : null;
  if (!pdf && m.kind === 'report_email' && m.report_version_id) {
    // Version validée avant les PDF figés : produit à partir des valeurs figées de la version.
    pdf = await withService(async (q) => {
      const lang = (await q<{ language: string }>(`select language from report_versions where id = $1 and organization_id = $2`, [m.report_version_id, m.organization_id])).rows[0]?.language;
      return lang ? renderReportPdf(q, m.report_version_id!, getMessages(isLocale(lang) ? lang : 'fr'), m.audience) : null;
    });
    if (!pdf) throw new Error('rapport introuvable');
  }
  const attachments = pdf ? [{ name: `rapport-v${org.version ?? 1}${m.audience === 'client' ? '-client' : ''}.pdf`, content: pdf }] : [];
  return {
    to: { email: m.recipient_email!, name: m.recipient_label },
    from: { email: sender.email, name: org.company_name || org.name || sender.name || 'Sitôt' },
    replyTo: org.email ? { email: org.email, name: org.company_name || org.name } : null,
    subject: m.subject ?? '',
    text: m.body ?? '',
    attachments,
    key: m.idempotency_key,
  };
}
