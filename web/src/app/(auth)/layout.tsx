import type { ReactNode } from 'react';
import { getCookieConsent } from '@/core/consent/server';
import { FullMessages } from '@/core/i18n/FullMessages';
import { freeOffer } from '@/core/free-offer';
import { inviteOnly } from '@/core/invite';
import { AuthFrame, CookieNotice } from '@/shared/ui';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const answered = (await getCookieConsent()) !== null;
  const invite = inviteOnly();
  return (
    <FullMessages>
      <AuthFrame freeOffer={(await freeOffer(null)) && !invite} invite={invite}>{children}</AuthFrame>
      <CookieNotice answered={answered} inFlow />
    </FullMessages>
  );
}
