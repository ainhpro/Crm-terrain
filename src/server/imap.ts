import 'server-only';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { after } from 'next/server';
import { fromParsedMail, type InboundEmail } from '@/modules/interventions/inbound';
import { imapConfig } from './config';
import { type ReceptionResult, storeInbound } from './reception';

const MAX_PER_RUN = 25;
const MAX_BYTES = 40_000_000;
const EVERY_MS = 60_000;

let running: Promise<ReceptionResult | null> | null = null;
let lastRun = 0;

/**
 * Traitement nommé « relève de la boîte de réception » : lit les emails non lus de la boîte IMAP, les
 * range par le traitement « réception d'emails » (le jeton de « <boîte>+<jeton>@… » désigne le compte),
 * puis les marque lus. Rien n'est supprimé de la boîte. Si le rangement échoue, ils restent non lus et
 * seront repris ; un email déjà rangé n'est jamais gardé deux fois.
 */
export async function fetchMailbox(): Promise<ReceptionResult | null> {
  const cfg = imapConfig();
  if (!cfg) return null;
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    socketTimeout: 60_000,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const unseen = ((await client.search({ seen: false }, { uid: true })) || []).slice(0, MAX_PER_RUN);
      if (!unseen.length) return { received: 0, duplicates: 0, ignored: 0 };
      const emails: InboundEmail[] = [];
      const read: number[] = [];
      for await (const msg of client.fetch(unseen, { uid: true, size: true, source: true }, { uid: true })) {
        read.push(msg.uid);
        if (!msg.source || (msg.size ?? 0) > MAX_BYTES) continue; // trop gros : laissé dans la boîte, marqué lu
        emails.push(fromParsedMail(await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true })));
      }
      const result = await storeInbound(emails, { kind: 'plus', mailbox: cfg.user });
      if (read.length) await client.messageFlagsAdd(read, ['\\Seen'], { uid: true });
      return { ...result, ignored: result.ignored + (read.length - emails.length) };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Relève tout de suite (bouton « Relever maintenant ») ; une seule relève à la fois. */
export async function fetchMailboxNow(): Promise<ReceptionResult | null> {
  running ??= fetchMailbox().finally(() => {
    lastRun = Date.now();
    running = null;
  });
  return running;
}

/** À l'ouverture de l'accueil ou des emails reçus : relève en arrière-plan, au plus une fois par minute. */
export function scheduleMailboxFetch(): void {
  if (!imapConfig() || running || Date.now() - lastRun < EVERY_MS) return;
  lastRun = Date.now();
  after(() =>
    fetchMailboxNow().catch((e: unknown) => {
      console.error('relève de la boîte : interrompue', (e as Error).message);
    }),
  );
}
