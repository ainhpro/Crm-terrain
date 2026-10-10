import { getMessages, isLocale } from '@/i18n';
import { withUser } from '@/server/db';
import { renderReportPdf } from '@/server/pdf';
import { sessionUserId } from '@/server/session';
import { readStored } from '@/server/storage';

/**
 * PDF d'une version validée. Sert le PDF figé à la validation (relecture D02) ; « ?pour=client » donne
 * la version client final (R02). Les versions validées avant cette correction n'ont pas de PDF figé :
 * il est alors produit à la demande depuis les valeurs figées de la version.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 404 });
  const audience = new URL(request.url).searchParams.get('pour') === 'client' ? 'client' : 'principal';
  const pdf = await withUser(userId, async (q) => {
    const rv = (
      await q<{ language: string; pdf_path: string | null; client_pdf_path: string | null }>(
        `select language, pdf_path, client_pdf_path from report_versions where id = $1 and status = 'validated'`,
        [id],
      )
    ).rows[0];
    if (!rv) return null;
    const stored = audience === 'client' ? rv.client_pdf_path : rv.pdf_path;
    if (stored) return readStored(stored);
    return renderReportPdf(q, id, getMessages(isLocale(rv.language) ? rv.language : 'fr'), audience);
  });
  if (!pdf) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="rapport-${id.slice(0, 8)}${audience === 'client' ? '-client' : ''}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}
