/**
 * Emails reçus par transfert (réception Brevo) : lecture prudente de ce que le service transmet,
 * jetons des adresses de réception, expéditeur et objet d'origine d'un email transféré.
 * Aucun accès réseau ni base ; le texte est toujours affiché tel quel, jamais comme du HTML (règle 7).
 */

export interface InboundAttachment {
  name: string;
  type: string;
  size: number;
}

export interface InboundEmail {
  messageId: string | null;
  /** Adresse de l'en-tête From (celui qui a transféré, pour un transfert à la main). */
  from: string | null;
  /** Destinataires en minuscules : enveloppe d'abord (règle de transfert automatique), puis To et Cc. */
  recipients: string[];
  subject: string;
  text: string;
  attachments: InboundAttachment[];
}

export const MAX_ITEMS = 20;
export const MAX_TEXT = 50_000;
const MAX_SUBJECT = 500;
const TOKEN = /^[0-9a-f]{20}$/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const unique = <T,>(xs: T[]): T[] => [...new Set(xs)];

/** Adresse email d'une valeur « Nom <a@b.c> », « a@b.c » ou { Address, Name } ; null sinon. */
export function emailAddress(v: unknown): string | null {
  if (v && typeof v === 'object' && 'Address' in v) return emailAddress((v as { Address: unknown }).Address);
  if (typeof v !== 'string') return null;
  const inBrackets = v.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  const bare = v.match(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+\.[^\s<>"'(),;:]+/);
  const a = (inBrackets?.[1] ?? bare?.[0] ?? '').trim().toLowerCase().replace(/^mailto:/, '');
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a) ? a : null;
}

const addresses = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v]).map(emailAddress).filter((a): a is string => a !== null);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

function decodeEntities(s: string): string {
  // Un seul passage : « &amp;lt; » donne « &lt; », pas « < ».
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Texte lisible d'un email en HTML (quand il n'a pas de version texte). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyText(item: Record<string, unknown>): string {
  const text = str(item.RawTextBody).trim() || htmlToText(str(item.RawHtmlBody)) || str(item.ExtractedMarkdownMessage).trim();
  return text.replace(/\r\n?/g, '\n').slice(0, MAX_TEXT);
}

/**
 * Emails d'un appel de la réception Brevo ({ items: [...] }). Toute valeur inattendue est ignorée
 * plutôt que de faire échouer l'appel ; au plus MAX_ITEMS emails par appel.
 */
export function parseBrevoInbound(payload: unknown): InboundEmail[] {
  const items = payload && typeof payload === 'object' ? (payload as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return [];
  return items.slice(0, MAX_ITEMS).flatMap((raw): InboundEmail[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const attachments = (Array.isArray(item.Attachments) ? item.Attachments : []).flatMap((a): InboundAttachment[] => {
      if (!a || typeof a !== 'object') return [];
      const x = a as Record<string, unknown>;
      const name = str(x.Name).slice(0, 200);
      return name ? [{ name, type: str(x.ContentType).slice(0, 100), size: Number(x.ContentLength) || 0 }] : [];
    });
    return [{
      messageId: str(item.MessageId).trim().slice(0, 500) || null,
      from: emailAddress(item.From),
      recipients: unique([...addresses(item.Recipients), ...addresses(item.To), ...addresses(item.Cc)]),
      subject: str(item.Subject).trim().slice(0, MAX_SUBJECT),
      text: bodyText(item),
      attachments: attachments.slice(0, 50),
    }];
  });
}

/** Adresse de réception d'un compte. */
export function inboundAddress(token: string, domain: string): string {
  return `${token}@${domain.trim().toLowerCase()}`;
}

/** Jetons des adresses de réception (« <jeton>@<domaine> ») parmi les destinataires. */
export function inboundTokens(recipients: readonly string[], domain: string): string[] {
  const d = domain.trim().toLowerCase();
  return unique(
    recipients.flatMap((r) => {
      const at = r.lastIndexOf('@');
      const local = r.slice(0, at);
      return at > 0 && r.slice(at + 1) === d && TOKEN.test(local) ? [local] : [];
    }),
  );
}

// Débuts d'un email transféré : Gmail, Apple Mail, Outlook, en anglais, français, néerlandais et allemand.
const FORWARD_MARKERS = [
  /-{2,}\s*(?:forwarded message|message transf[ée]r[ée]|doorgestuurd bericht|weitergeleitete nachricht)\s*-{2,}/i,
  /^\s*(?:begin forwarded message|d[ée]but du message r[ée]exp[ée]di[ée]|begin doorgestuurd bericht|anfang der weitergeleiteten nachricht)\s*:/im,
  /-{2,}\s*(?:original message|message d['’]origine|oorspronkelijk bericht|urspr[üu]ngliche nachricht)\s*-{2,}/i,
  /^_{10,}\s*\n(?=\s*\*?(?:from|de|van|von)\s*\*?\s*:)/im,
];
const FROM_LINE = /^\s*\*?(?:from|de|van|von)\s*\*?\s*:\s*(.+)$/im;
const SUBJECT_LINE = /^\s*\*?(?:subject|objet|onderwerp|betreff)\s*\*?\s*:\s*(.+)$/im;

/** Expéditeur et objet d'origine d'un email transféré à la main ; null si ce n'est pas un transfert. */
export function forwardedOriginal(text: string): { from: string | null; subject: string | null } | null {
  let start = -1;
  for (const re of FORWARD_MARKERS) {
    const m = re.exec(text);
    if (m && (start < 0 || m.index < start)) start = m.index;
  }
  if (start < 0) return null;
  const block = text.slice(start, start + 2000); // en-têtes juste après le début du transfert
  const subject = SUBJECT_LINE.exec(block)?.[1]?.trim().replace(/^\*+|\*+$/g, '').trim() || null;
  return { from: emailAddress(FROM_LINE.exec(block)?.[1] ?? null), subject };
}

/** Objet sans les préfixes de transfert (« Fwd: », « TR : », « Doorst: »…). */
export function cleanSubject(subject: string): string {
  let out = subject.trim();
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/^(?:fwd?|tr|wg|doorst|trans)\s*:\s*/i, '');
  }
  return out;
}

/** Expéditeur et objet à montrer : ceux de l'email d'origine quand c'est un transfert à la main. */
export function originOf(email: Pick<InboundEmail, 'from' | 'subject' | 'text'>): { from: string | null; subject: string } {
  const fwd = forwardedOriginal(email.text);
  return { from: fwd?.from ?? email.from, subject: cleanSubject(fwd?.subject ?? email.subject) };
}
