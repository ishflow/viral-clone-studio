import { getI18n } from '@/core/i18n/server';
import { getBalanceLabel } from '@/core/session/balance';
import { data } from '@/data';
import type { User } from '@/data/ports';
import { BalanceNow } from '@/features/jobs';

/**
 * On `/videos`, after the list was read: listing a stopped job returns its credits (see `BalanceNow`), so the balance is read last, with
 * the owner as stored now.
 */
export async function VideosBalance({ user }: { user: User }) {
  const { t } = await getI18n();
  return <BalanceNow label={await getBalanceLabel((await data.auth.getUser(user.id)) ?? user, t)} />;
}
