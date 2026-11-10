import { cookies } from 'next/headers';
import { requireUser } from '@/core/session/guards';
import { THEME_COOKIE } from '@/core/theme/theme';
import { AccountView, loadAccount } from '@/features/account';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('account');

export default async function AccountPage() {
  const user = await requireUser('/account');
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return <AccountView account={await loadAccount(user, theme)} />;
}
