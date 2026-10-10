import { redirect } from 'next/navigation';
import { Flash } from '@/components';
import { getServerMessages } from '@/i18n/server';
import { acceptInvitation } from '@/server/actions/settings';
import { currentUser } from '@/server/context';

export default async function InvitationPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ erreur?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/connexion');
  const { t } = await getServerMessages();
  const { token } = await params;
  const sp = await searchParams;
  return (
    <main className="shell">
      <form action={acceptInvitation} className="page" style={{ maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <h1>{t.settings.team}</h1>
        <p className="muted">{user.email}</p>
        {sp.erreur && <Flash kind="bad">{t.common.notAllowed}</Flash>}
        <input type="hidden" name="token" value={token} />
        <button className="btn primary block" type="submit">{t.common.validate}</button>
      </form>
    </main>
  );
}
