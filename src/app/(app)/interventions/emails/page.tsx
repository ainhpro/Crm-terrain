import { BackLink } from '@/components';
import { requireCtx } from '@/server/context';
import { InboundForm } from './inbound-form';

export default async function InboundPage() {
  const ctx = await requireCtx();
  return (
    <main className="page">
      <div className="row">
        <BackLink href="/interventions" label={ctx.t.common.back} />
        <h1>{ctx.t.interventions.integrateEmail}</h1>
      </div>
      <InboundForm t={ctx.t} />
    </main>
  );
}
