'use client';

import { MAIL_CSS, MailView, type MailContent } from '@/core/payments/mail-view';

/**
 * The preview draws the very markup that is sent (`MailView`): same tables, same inline styles. Always light, whatever the site theme is.
 * The phone rules of the sent mail's `<head>` ride along as a style text, so a narrow window shows the phone mail.
 */
export function EmailFrame({ mail }: { mail: MailContent }) {
  return (
    <div data-theme="light" className="mx-auto w-full max-w-[600px]">
      <style href="mail-phone" precedence="default">{MAIL_CSS}</style>
      <MailView mail={mail} />
    </div>
  );
}
