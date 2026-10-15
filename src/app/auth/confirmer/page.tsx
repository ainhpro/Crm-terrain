import type { Metadata } from 'next';
import { getServerMessages } from '@/i18n/server';
import { confirmLoginLink } from '@/server/actions/auth';
import { brand } from '@/server/formule';

/**
 * Lien de l'email de connexion. Ouvrir la page ne consomme rien (les antivirus de messagerie ouvrent
 * les liens) : c'est le bouton qui vérifie le lien auprès de Supabase, côté serveur.
 */
// Le jeton est dans l'adresse : il ne doit fuiter vers aucun autre site.
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false } };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string }> }) {
  const { t } = await getServerMessages();
  const { token_hash: tokenHash = '' } = await searchParams;
  const { name: productName } = await brand(t);
  return (
    <main className="shell">
      <div className="page" style={{ justifyContent: 'center', maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <div className="brand">
          <i>{productName.slice(0, 1)}</i>
          {productName}
        </div>
        <h1>{t.auth.confirmTitle}</h1>
        <p className="muted">{t.auth.confirmLead}</p>
        <form action={confirmLoginLink} className="stack">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <button className="btn primary block" type="submit">{t.auth.verify}</button>
        </form>
      </div>
    </main>
  );
}
