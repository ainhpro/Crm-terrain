// Tâche planifiée Netlify : passage de rattrapage quotidien des envois d'emails (5 h UTC).
// Appelle la route protégée /api/envois du site avec CRON_SECRET ; les envois normaux partent
// juste après la validation, sans attendre ce passage.
export default async function envois(): Promise<Response> {
  const site = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) return new Response('URL ou CRON_SECRET manquant', { status: 503 });
  const r = await fetch(`${site}/api/envois`, { headers: { authorization: `Bearer ${secret}` } });
  return new Response(await r.text(), { status: r.status });
}

export const config = { schedule: '0 5 * * *' };
