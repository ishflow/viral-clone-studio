import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { keepEmail } from '@/data/mock/mailer';
import { resetStore } from '@/data/mock/store';
import { paymentStore } from '@/data/real/payments-store';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/core/i18n/server', async () => {
  const { createTranslate } = await import('@/core/i18n/translate');
  const { loadMessages } = await import('@/core/i18n/messages');
  const messages = loadMessages('en');
  return { getI18n: async () => ({ locale: 'en', t: createTranslate('en', messages), messages }) };
});
vi.mock('./actions', () => ({ sendEmailAgain: vi.fn() }));

import { DeliveryStatus } from './DeliveryStatus';

beforeEach(() => resetStore());
afterEach(cleanup);

describe('DeliveryStatus', () => {
  it('lists every email, with "Send again" only on a failed or blocked one, and holds no second main landmark', async () => {
    keepEmail('verify', 'a@example.com', { token: 'x' });
    keepEmail('reset', 'b@example.com', { token: 'y' });
    keepEmail('ready', 'c@example.com', { jobId: 'j' });
    const mails = (await import('@/data/mock/store')).getStore().outbox;
    paymentStore().deliveries.push(
      { emailId: mails[0]!.id, status: 'failed', attempts: 5, nextTryAt: 0 },
      { emailId: mails[1]!.id, status: 'blocked-by-allowlist', attempts: 0, nextTryAt: 0 },
      { emailId: mails[2]!.id, status: 'sent', attempts: 1, nextTryAt: 0 },
    );
    const { container } = renderWithI18n(await DeliveryStatus());
    expect(screen.getByRole('heading', { level: 1, name: 'Email delivery' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Send again' })).toHaveLength(2);
    expect(container.querySelectorAll('main')).toHaveLength(0);   // the admin frame already has the page's main
  });

  it('names the mail that confirms a new address by its own subject, not by the sign-up one', async () => {
    keepEmail('verify', 'old@example.com', { token: 'x', purpose: 'email-change' });
    keepEmail('verify', 'new@example.com', { token: 'y' });
    renderWithI18n(await DeliveryStatus());
    expect(screen.getAllByText('Confirm your new email')).toHaveLength(1);
    expect(screen.getAllByText('Verify your email')).toHaveLength(1);
  });

  it('names the mail that says a refund was sent, apart from the receipt and from the refund-complete mail', async () => {
    keepEmail('payment', 'a@example.com', { credits: '10' });
    keepEmail('payment', 'b@example.com', { refund: 'sent', credits: '10' });
    keepEmail('payment', 'c@example.com', { refund: 'true', credits: '10' });
    renderWithI18n(await DeliveryStatus());
    expect(screen.getAllByText('Your refund is on its way')).toHaveLength(1);
    expect(screen.getAllByText('Your refund is complete')).toHaveLength(1);
    expect(screen.getAllByText('Payment received: 10 credits added')).toHaveLength(1);
  });
});
