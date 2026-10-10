import { redirect } from 'next/navigation';
import { Flash } from '@/components';
import { getServerMessages } from '@/i18n/server';
import { createAccount } from '@/server/actions/onboarding';
import { currentUser } from '@/server/context';
import { withUser } from '@/server/db';

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/connexion');
  const hasOrg = await withUser(user.userId, async (q) => (await q(`select 1 from organization_members where user_id = $1`, [user.userId])).rowCount);
  if (hasOrg) redirect('/');
  const { t } = await getServerMessages();
  const { erreur } = await searchParams;
  const profiles = [
    ['commercial', t.welcome.commercial, t.welcome.commercialHint],
    ['technician', t.welcome.technician, t.welcome.technicianHint],
    ['both', t.welcome.both, t.welcome.bothHint],
  ] as const;
  return (
    <main className="shell">
      <form action={createAccount} className="page" style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
        <div className="brand">
          <i>C</i>
          {t.app.name}
        </div>
        <h1>{t.welcome.title}</h1>
        <p className="muted">{t.welcome.lead}</p>
        {erreur && <Flash kind="bad">{t.common.error}</Flash>}
        <label className="field">
          {t.welcome.orgName}
          <input type="text" name="orgName" id="orgName" required maxLength={120} />
        </label>
        <fieldset className="stack">
          <legend>{t.welcome.profileQuestion}</legend>
          {profiles.map(([value, title, hint], i) => (
            <label key={value} className="big-choice">
              <input type="radio" name="profile" value={value} defaultChecked={i === 0} />
              <span>
                <b>{title}</b>
                <small>{hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="faint">{t.welcome.changeLater}</p>
        <button className="btn primary block" type="submit">
          {t.welcome.create}
        </button>
      </form>
    </main>
  );
}
