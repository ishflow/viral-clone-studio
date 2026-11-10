import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { FullMessages } from '@/core/i18n/FullMessages';
import { getI18n } from '@/core/i18n/server';
import { personSwapOpen } from '@/core/person-swap';
import { getBalanceLabel } from '@/core/session/balance';
import { requireUser } from '@/core/session/guards';
import { ShownBalance } from '@/features/jobs';
import { HeaderCustomer, PageFrame } from '@/shared/ui';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser((await headers()).get('x-path') ?? '/gallery');
  const { t } = await getI18n();
  const balanceLabel = await getBalanceLabel(user, t);
  const swap = await personSwapOpen();
  return (
    <FullMessages>
      <ShownBalance label={balanceLabel}>
        <PageFrame header={<HeaderCustomer isAdmin={user.role === 'admin'} balanceLabel={balanceLabel} swap={swap} />}>{children}</PageFrame>
      </ShownBalance>
    </FullMessages>
  );
}
