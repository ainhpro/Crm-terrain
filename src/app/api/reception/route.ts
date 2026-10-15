import { timingSafeEqual } from 'node:crypto';
import { inboundConfig } from '@/server/config';
import { receiveInbound } from '@/server/reception';

const MAX_BYTES = 4_000_000; // sous la limite des fonctions Vercel

/**
 * Réception des emails transférés (appel du service de réception Brevo, « inbound parsing »).
 * Brevo ne signe pas ses appels : l'adresse d'appel porte une clé secrète (?cle=INBOUND_SECRET),
 * comparée en temps constant. Le compte est ensuite déterminé par l'adresse de réception de l'email.
 */
export async function POST(request: Request) {
  const cfg = inboundConfig();
  if (!cfg) return new Response(null, { status: 503 });
  const given = Buffer.from(new URL(request.url).searchParams.get('cle') ?? '');
  const expected = Buffer.from(cfg.secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response(null, { status: 401 });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return new Response(null, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const result = await receiveInbound(payload, cfg.domain);
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
}
