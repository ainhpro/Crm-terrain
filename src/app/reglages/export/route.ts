import { buildExport } from '@/server/account';
import { requireCtx } from '@/server/context';
import { withUser } from '@/server/db';
import { tar } from '@/server/tar';

/** Export complet (règle 10), réservé au propriétaire de l'entreprise. */
export async function GET() {
  const ctx = await requireCtx();
  if (ctx.role !== 'owner') return new Response(null, { status: 403 });
  const { entries } = await withUser(ctx.userId, (q) => buildExport(q, ctx.orgId));
  const slug = ctx.orgName.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'entreprise';
  return new Response(new Uint8Array(tar(entries)), {
    headers: {
      'content-type': 'application/x-tar',
      'content-disposition': `attachment; filename="export-${slug}-${ctx.today}.tar"`,
      'cache-control': 'private, no-store',
    },
  });
}
