'use client';

import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { LedgerEntry, Purchase, User } from '@/data/ports';
import type { ThemeChoice } from '@/core/theme/theme';
import { Card, LinkButton, buttonClass } from '@/shared/ui';
import { LogOutForm } from '@/shared/ui/LogOutForm';
import { CreditActivity } from './CreditActivity';
import { DeleteAccount } from './DeleteAccount';
import { ProfileForm } from './ProfileForm';
import { Purchases } from './Purchases';

/**
 * Board rule: on the phone the cards read balance, credit activity, invoices, profile, then log out / delete (below the cards).
 * On desktop the grid reads balance, activity, profile, invoices. The DOM order is the desktop one; these two cards swap on the phone.
 */
const PHONE_ORDER = { invoices: 'order-3 nav:order-4', profile: 'order-4 nav:order-3' };

export interface AccountData {
  isAdmin?: boolean;
  name: string;
  email: string;
  /** The theme cookie. The language is not here: the profile form shows the one the site is in (`useLocale`, the locale cookie). */
  theme: ThemeChoice;
  balance: number;
  entries: LedgerEntry[];
  packNames: string[];
  purchases: Purchase[];
  /** Credits held for open refund requests; `balance` is without them. */
  held: number;
  authProvider: User['authProvider'];
  pendingEmail: string | null;
  /** A job is queued or running: the account cannot be deleted now. */
  jobRunning: boolean;
}

function Actions({ balanceLabel, jobRunning, phone }: { balanceLabel: string; jobRunning: boolean; phone?: boolean }) {
  const t = useT();
  return (
    <>
      <LogOutForm className={phone ? 'w-full' : undefined}>
        <button
          type="submit"
          className={phone ? buttonClass('secondary', 'm', true) : 'flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-15 text-text'}
        >
          {t('common.nav.logOut')}
        </button>
      </LogOutForm>
      <DeleteAccount balanceLabel={balanceLabel} jobRunning={jobRunning} />
    </>
  );
}

export function AccountView({ account }: { account: AccountData }) {
  const t = useT();
  const locale = useLocale();
  const balanceLabel = t('common.credits.count', { count: account.balance });
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="m-0 heading-2">{t('account.title')}</h1>{account.isAdmin && <LinkButton href="/admin" variant="secondary">{t('common.nav.adminPanel')}</LinkButton>}</div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-6">
        <Card as="section" aria-labelledby="h-balance" className="flex flex-col gap-6">
          <h2 id="h-balance" className="m-0 text-15 font-semibold text-text-2">{t('account.balance.title')}</h2>
          <p className="m-0 font-display text-[clamp(48px,15vw,80px)] leading-[0.9] font-extrabold tracking-[-0.04em] wrap-anywhere" aria-label={balanceLabel}>
            {account.balance}
          </p>
          {account.held > 0 && <p className="m-0 -mt-3 text-13 leading-snug text-text-3">{t('account.balance.held', { credits: account.held })}</p>}
          <LinkButton href="/pricing" className="mt-auto nav:self-start">{t('account.balance.buy')}</LinkButton>
        </Card>
        <CreditActivity entries={account.entries} packNames={account.packNames} />
        <ProfileForm name={account.name} email={account.email} pendingEmail={account.pendingEmail} authProvider={account.authProvider} locale={locale} theme={account.theme} className={PHONE_ORDER.profile} />
        <div className={`${PHONE_ORDER.invoices} flex flex-col gap-4`}>
          <Purchases purchases={account.purchases} />
          <div className="hidden flex-wrap gap-x-6 gap-y-2 nav:flex">
            <Actions balanceLabel={balanceLabel} jobRunning={account.jobRunning} />
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2 nav:hidden">
        <Actions balanceLabel={balanceLabel} jobRunning={account.jobRunning} phone />
      </div>
    </div>
  );
}
