import { BackLink, Flash, formatDate } from '@/components';
import { addressFor } from '@/modules/interventions/inbound';
import { fetchMailboxAction } from '@/server/actions/interventions';
import { imapConfig, receptionScheme } from '@/server/config';
import { requireCtx } from '@/server/context';
import { withUser } from '@/server/db';
import { scheduleMailboxFetch } from '@/server/imap';
import { loadPendingInbound } from '@/server/interventions';
import { AddressCard } from './address-card';
import { InboundForm } from './inbound-form';

/** Emails reçus : adresse de réception du compte, emails à traiter, et collage à la main en secours. */
export default async function InboundPage({ searchParams }: { searchParams: Promise<{ releve?: string }> }) {
  const ctx = await requireCtx();
  const { t, locale } = ctx;
  const { releve } = await searchParams;
  const cfg = receptionScheme();
  const mailbox = imapConfig() !== null;
  if (mailbox && releve === undefined) scheduleMailboxFetch();
  const data = await withUser(ctx.userId, async (q) => ({
    token: (await q<{ inbound_token: string }>(`select inbound_token from organizations where id = $1`, [ctx.orgId])).rows[0]?.inbound_token,
    pending: await loadPendingInbound(q),
  }));
  return (
    <main className="page">
      <div className="row">
        <BackLink href="/interventions" label={t.common.back} />
        <h1>{t.inbox.title}</h1>
      </div>
      {releve !== undefined && (
        <Flash kind={releve === 'erreur' ? 'bad' : 'ok'}>{releve === 'erreur' ? t.inbox.fetchError : t.inbox.fetched.replace('{n}', releve)}</Flash>
      )}
      {cfg && data.token ? (
        <AddressCard
          address={addressFor(cfg, data.token)}
          labels={{ title: t.inbox.address, hint: t.inbox.addressHint, copy: t.inbox.copy, copied: t.inbox.copied }}
        />
      ) : (
        <p className="note info">{t.inbox.notConfigured}</p>
      )}

      <section className="stack">
        <div className="page-head">
          <h2>{t.inbox.toProcess}</h2>
          {mailbox && (
            <form action={fetchMailboxAction}>
              <button className="btn small" type="submit">{t.inbox.fetchNow}</button>
            </form>
          )}
        </div>
        {data.pending.length === 0 ? (
          <p className="faint">{t.inbox.empty}</p>
        ) : (
          <div className="card list">
            {data.pending.map((m) => (
              <a key={m.id} href={`/interventions/emails/${m.id}`}>
                <span className="main">
                  <span>{m.subject || '—'}</span>
                  <small>
                    {[
                      m.from_address,
                      formatDate(m.received_at, locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, ctx.timezone),
                      m.suggested_label && `${t.interventions.suggested} : ${m.suggested_label}`,
                    ].filter(Boolean).join(' · ')}
                  </small>
                </span>
                <span className="tag">{m.channel === 'forward' ? t.inbox.forwarded : t.inbox.pasted}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Sans réception par transfert, coller est le seul moyen : le formulaire est déjà ouvert. */}
      <details className="card pad" open={!cfg}>
        <summary>{t.inbox.paste}</summary>
        <div style={{ marginTop: 12 }}>
          <InboundForm t={t} />
        </div>
      </details>
    </main>
  );
}
