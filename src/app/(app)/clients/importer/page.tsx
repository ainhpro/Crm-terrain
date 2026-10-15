import { BackLink } from '@/components';
import { requireModule } from '@/server/context';
import { ImportFlow } from './import-flow';

export default async function ImportPage() {
  const { t } = await requireModule('crm');
  return (
    <main className="page">
      <div className="row">
        <BackLink href="/clients" label={t.common.back} />
        <h1>{t.import.title}</h1>
      </div>
      <p className="muted">{t.import.lead}</p>
      <ImportFlow t={t.import} fields={t.clients} common={t.common} />
    </main>
  );
}
