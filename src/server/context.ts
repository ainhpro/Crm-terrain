import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getMessages, type Locale } from '@/i18n';
import { getLocale } from '@/i18n/server';
import { readOptions, type MemberOptions } from '@/modules/interventions/options';
import { withUser } from './db';
import { sessionUserId } from './session';

export type Profile = 'commercial' | 'technician' | 'both';

export interface Ctx {
  userId: string;
  email: string;
  fullName: string | null;
  orgId: string;
  orgName: string;
  role: 'owner' | 'member';
  profile: Profile;
  options: MemberOptions;
  typeIds: string[];
  timezone: string;
  today: string;
  locale: Locale;
  t: ReturnType<typeof getMessages>;
}

/** « Aujourd'hui » dans le fuseau du compte, au format AAAA-MM-JJ (règle n°9). */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Utilisateur connecté, sans exiger d'organisation. */
export const currentUser = cache(async () => {
  const userId = await sessionUserId();
  if (!userId) return null;
  return withUser(userId, async (q) => {
    const { rows } = await q<{ email: string; full_name: string | null }>(`select email, full_name from profiles where id = $1`, [userId]);
    return rows[0] ? { userId, email: rows[0].email, fullName: rows[0].full_name } : null;
  });
});

/** Contexte complet d'une page de l'application ; redirige vers la connexion ou l'accueil si besoin. */
export const requireCtx = cache(async (): Promise<Ctx> => {
  const user = await currentUser();
  if (!user) redirect('/connexion');
  const locale = await getLocale();
  const row = await withUser(user.userId, async (q) => {
    const { rows } = await q<{
      id: string; name: string; role: 'owner' | 'member'; timezone: string; org_profile: Profile;
      profile: Profile | null; options: unknown; type_ids: string[] | null;
    }>(
      `select o.id, o.name, m.role, o.timezone, o.profile as org_profile, s.profile, s.options, s.type_ids
       from organization_members m
       join organizations o on o.id = m.organization_id
       left join member_settings s on s.organization_id = m.organization_id and s.user_id = m.user_id
       where m.user_id = $1
       order by m.created_at limit 1`,
      [user.userId],
    );
    return rows[0];
  });
  if (!row) redirect('/bienvenue');
  return {
    ...user,
    orgId: row.id,
    orgName: row.name,
    role: row.role,
    profile: row.profile ?? row.org_profile,
    options: readOptions(row.options),
    typeIds: row.type_ids ?? [],
    timezone: row.timezone,
    today: todayIn(row.timezone),
    locale,
    t: getMessages(locale),
  };
});

export function isTechnician(ctx: Pick<Ctx, 'profile'>): boolean {
  return ctx.profile === 'technician' || ctx.profile === 'both';
}

export function isCommercial(ctx: Pick<Ctx, 'profile'>): boolean {
  return ctx.profile === 'commercial' || ctx.profile === 'both';
}
