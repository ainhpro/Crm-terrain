import { notFound } from 'next/navigation';
import { BackLink } from '@/components';
import { requireCtx } from '@/server/context';
import { withUser } from '@/server/db';
import { ReportForm } from './report-form';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const name = await withUser(ctx.userId, async (q) => (await q<{ name: string }>(`select name from clients where id = $1`, [id])).rows[0]?.name);
  if (!name) notFound();
  return (
    <main className="page">
      <div className="row">
        <BackLink href={`/clients/${id}`} label={ctx.t.common.back} />
        <div>
          <h1>{ctx.t.report.title}</h1>
          <p className="faint">{name}</p>
        </div>
      </div>
      <ReportForm clientId={id} t={ctx.t.report} common={ctx.t.common} locale={ctx.locale} />
    </main>
  );
}
