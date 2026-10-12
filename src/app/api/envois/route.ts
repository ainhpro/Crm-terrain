import { timingSafeEqual } from 'node:crypto';
import { runOutbox } from '@/server/outbox-run';

/**
 * Passage de rattrapage du traitement d'envoi (fonction planifiée Netlify ou tâche Vercel) : envois restés en file,
 * traitements interrompus (passés « à vérifier »). Protégé par CRON_SECRET (en-tête Authorization).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return new Response(null, { status: 503 });
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response(null, { status: 401 });
  const result = await runOutbox();
  return Response.json(result ?? { configured: false }, { headers: { 'cache-control': 'no-store' } });
}
