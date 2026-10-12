import { BackLink, Flash } from '@/components';
import { requireCtx } from '@/server/context';
import { RepriseFlow } from './reprise-flow';

export default async function ReprisePage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { t, role } = await requireCtx();
  const { erreur } = await searchParams;
  return (
    <main className="page">
      <div className="row">
        <BackLink href="/clients/importer" label={t.common.back} />
        <h1>{t.reprise.title}</h1>
      </div>
      <p className="muted">{t.reprise.lead}</p>
      {erreur && <Flash kind="bad">{t.reprise.errors[erreur as keyof typeof t.reprise.errors] ?? t.common.error}</Flash>}
      {role === 'owner' ? <RepriseFlow t={t.reprise} /> : <Flash kind="warn">{t.reprise.errors.owner}</Flash>}
    </main>
  );
}
