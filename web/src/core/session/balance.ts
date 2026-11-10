import { data } from '@/data';
import type { User } from '@/data/ports';
import type { Translate } from '@/core/i18n/types';

/** Text of the balance chip: "12 credits", or "1 free video" while the free video is unused and the balance is 0. */
export async function getBalanceLabel(user: User, t: Translate): Promise<string> {
  const balance = await data.ledger.balance(user.id);
  if (balance === 0 && user.freeVideoAvailable) return t('common.credits.freeVideo');
  return t('common.credits.count', { count: balance });
}
