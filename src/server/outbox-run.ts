import 'server-only';
import { after } from 'next/server';
import { sendWithBrevo } from './brevo';
import { brevoConfig } from './config';
import { type OutboxResult, processOutbox } from './outbox';

/** Vide la file d'envoi si Brevo est configuré ; sinon rien ne part et les messages restent « en file ». */
export async function runOutbox(): Promise<OutboxResult | null> {
  const cfg = brevoConfig();
  if (!cfg) return null;
  return processOutbox((mail) => sendWithBrevo({ apiKey: cfg.apiKey, apiUrl: cfg.apiUrl }, mail), { sender: { email: cfg.senderEmail, name: cfg.senderName } });
}

/** Après la réponse à l'utilisateur (validation, commande) : envoi sans le faire attendre. */
export function scheduleOutbox(): void {
  if (!brevoConfig()) return;
  after(() =>
    runOutbox().catch((e: unknown) => {
      console.error('envois : traitement interrompu', (e as Error).message);
    }),
  );
}
