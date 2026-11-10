import { allowedRecipient, mailConfig } from '@/core/payments/mail-config';

/**
 * Invite mode. With real mail (`VC_MAIL=resend`) a verification link goes only to the addresses of `VC_MAIL_ALLOW`, so that list is
 * the guest list: an address outside it could never be verified, and it may not open an account either (no pile of accounts nobody
 * can finish). `*` invites everyone. Without real mail (the demo, the tests) there is no list and sign-up is open.
 */
export function inviteOnly(): boolean {
  const mail = mailConfig();
  return mail.mode === 'resend' && !(mail.allow.length === 1 && mail.allow[0] === '*');
}

export function invited(email: string): boolean {
  const mail = mailConfig();
  return mail.mode !== 'resend' || allowedRecipient(email.trim(), mail.allow);
}
