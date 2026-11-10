import type { ReactNode } from 'react';
import { FullMessages } from '@/core/i18n/FullMessages';
import { requireAdmin } from '@/core/session/guards';
import { HeaderPanel, PageFrame } from '@/shared/ui';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <FullMessages>
      <PageFrame header={<HeaderPanel />}>{children}</PageFrame>
    </FullMessages>
  );
}
