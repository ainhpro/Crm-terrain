import { getMessages, isLocale } from '@/i18n';
import { withUser } from '@/server/db';
import { renderReportPdf } from '@/server/pdf';
import { sessionUserId } from '@/server/session';

/** PDF d'une version validée (figée) du rapport d'intervention. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 404 });
  const pdf = await withUser(userId, async (q) => {
    const lang = (await q<{ language: string }>(`select language from report_versions where id = $1 and status = 'validated'`, [id])).rows[0]?.language;
    if (!lang) return null;
    return renderReportPdf(q, id, getMessages(isLocale(lang) ? lang : 'fr'));
  });
  if (!pdf) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="rapport-${id.slice(0, 8)}.pdf"`, 'cache-control': 'private, no-store' },
  });
}
