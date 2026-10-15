import { BackLink, Flash } from '@/components';
import { requireCtx } from '@/server/context';
import { withUser } from '@/server/db';
import { NewCaseFlow } from './new-case';

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ erreur?: string; message?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const data = await withUser(ctx.userId, async (q) => ({
    types: (await q<{ id: string; name: string }>(`select id, name from intervention_types where archived_at is null order by position, name`)).rows,
    principals: (await q<{ id: string; name: string; default_type_id: string | null }>(`select id, name, default_type_id from principals where archived_at is null order by name`)).rows,
    clients: (await q<{ id: string; name: string }>(`select id, name from clients order by name limit 2000`)).rows,
    // Demande venue d'un email reçu (Emails reçus › Créer une intervention) : objet et texte repris tels quels.
    message: sp.message && /^[0-9a-f-]{36}$/i.test(sp.message)
      ? (await q<{ id: string; subject: string | null; body_text: string | null }>(
          `select id, subject, body_text from inbound_messages where id = $1 and status = 'pending'`, [sp.message],
        )).rows[0]
      : undefined,
  }));
  const types = ctx.typeIds.length ? data.types.filter((x) => ctx.typeIds.includes(x.id)) : data.types;
  return (
    <main className="page">
      <div className="row">
        <BackLink href="/interventions" label={ctx.t.common.back} />
        <h1>{ctx.t.interventions.new}</h1>
      </div>
      {sp.erreur && <Flash kind="bad">{sp.erreur === 'client' ? ctx.t.clients.name : sp.erreur === '23505' ? ctx.t.interventions.ticketExists : ctx.t.common.error}</Flash>}
      <NewCaseFlow
        t={ctx.t}
        types={types.length ? types : data.types}
        principals={data.principals}
        clients={data.clients}
        showWarranty={ctx.options.warranty}
        defaultLanguage={ctx.locale}
        fromMessage={data.message ? { id: data.message.id, subject: data.message.subject ?? '', body: data.message.body_text ?? '' } : undefined}
      />
    </main>
  );
}
