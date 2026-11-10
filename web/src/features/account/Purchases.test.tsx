import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { loadMessages } from '@/core/i18n/messages';
import type { Purchase } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { DeleteAccount } from './DeleteAccount';
import { Purchases } from './Purchases';

const requestRefund = vi.fn();
const cancelRefund = vi.fn();
const deleteAccount = vi.fn();
vi.mock('./actions', () => ({
  requestRefund: (...a: unknown[]) => requestRefund(...a),
  cancelRefund: (...a: unknown[]) => cancelRefund(...a),
  deleteAccount: (...a: unknown[]) => deleteAccount(...a),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const purchase = (over: Partial<Purchase> = {}): Purchase => ({
  id: 'pur-1', userId: 'u', packId: 'pack-starter', packName: 'Starter', credits: 10, amount: '$19.00', amountCents: 1900, at: '2026-10-01T10:00:00Z',
  status: 'paid', invoiceId: 'inv-1', refundable: { ok: true, until: '2026-10-15T10:00:00Z' }, refund: null, ...over,
});

describe('Purchases', () => {
  it('a pack whose payment has the provider\'s own invoice shows two links, so one is left if the other does not open: "Invoice (Dodo)" to the provider\'s address and the site\'s own page; without one the site\'s page alone, in both languages', () => {
    const dodo = 'https://test.dodopayments.com/invoices/payments/pay_A';
    for (const [locale, provider, site] of [['en', 'Invoice (Dodo)', 'Download invoice'], ['tr', 'Fatura (Dodo)', 'Faturayı indir']] as const) {
      const view = renderWithI18n(<Purchases purchases={[purchase({ id: 'real', invoiceUrl: dodo }), purchase({ id: 'own', invoiceId: 'inv-2' })]} />, locale);
      const real = screen.getByRole('link', { name: provider });
      expect(real).toHaveAttribute('href', dodo);
      expect(real).toHaveAttribute('target', '_blank');
      expect(real).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.getAllByRole('link', { name: site }).map((link) => link.getAttribute('href'))).toEqual(['/invoices/inv-1', '/invoices/inv-2']);
      view.unmount();
    }
  });
  it('a pack the provider added tax to shows the total that was charged and what it is made of, in both languages; without a tax the line is what it was', () => {
    const { unmount } = renderWithI18n(<Purchases purchases={[purchase({ taxCents: 361, totalCents: 2261 })]} />);
    expect(screen.getByText('Paid · Oct 1, 2026 · $22.61 ($19.00 + $3.61 tax)')).toBeInTheDocument();
    unmount();
    const tr = renderWithI18n(<Purchases purchases={[purchase({ taxCents: 361, totalCents: 2261 })]} />, 'tr');
    expect(screen.getByText('Ödendi · 1 Eki 2026 · $22.61 ($19.00 + $3.61 vergi)')).toBeInTheDocument();
    tr.unmount();
    for (const charged of [{}, { taxCents: 0, totalCents: 1900 }]) {
      const view = renderWithI18n(<Purchases purchases={[purchase(charged)]} />);
      expect(screen.getByText('Paid · Oct 1, 2026 · $19.00')).toBeInTheDocument();
      view.unmount();
    }
  });
  it('the refund of a pack the provider added tax to is of the whole payment: the refund window and the refunded line say the total, in both languages', async () => {
    const taxed = { taxCents: 361, totalCents: 2261 };
    const settled = { status: 'refunded' as const, refundable: null, refund: { requestedAt: '2026-10-02T10:00:00Z', sentAt: '2026-10-03T10:00:00Z', settledAt: '2026-10-04T10:00:00Z', by: null } };
    const en = renderWithI18n(<Purchases purchases={[purchase({ id: 'a', ...taxed }), purchase({ id: 'b', ...taxed, ...settled })]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Request a refund' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Request a refund for Starter · 10 credits · $22.61?');
    expect(screen.getByText('Refunded on Oct 4, 2026. $22.61 went back to your payment method.')).toBeInTheDocument();
    en.unmount();
    renderWithI18n(<Purchases purchases={[purchase({ id: 'a', ...taxed }), purchase({ id: 'b', ...taxed, ...settled })]} />, 'tr');
    await userEvent.click(screen.getByRole('button', { name: 'İade iste' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Starter · 10 kredi · $22.61 için iade istensin mi?');
    expect(screen.getByText('4 Eki 2026 tarihinde iade edildi. $22.61 ödeme yöntemine geri döndü.')).toBeInTheDocument();
  });
  it('the refund of a pack with no tax (the offline fake, or a tax of zero) says the price, as before', async () => {
    const settled = { status: 'refunded' as const, refundable: null, refund: { requestedAt: '2026-10-02T10:00:00Z', sentAt: '2026-10-03T10:00:00Z', settledAt: '2026-10-04T10:00:00Z', by: null } };
    for (const charged of [{}, { taxCents: 0, totalCents: 1900 }]) {
      const view = renderWithI18n(<Purchases purchases={[purchase({ id: 'a', ...charged }), purchase({ id: 'b', ...charged, ...settled })]} />);
      await userEvent.click(screen.getByRole('button', { name: 'Request a refund' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Request a refund for Starter · 10 credits · $19.00?');
      expect(screen.getByText('Refunded on Oct 4, 2026. $19.00 went back to your payment method.')).toBeInTheDocument();
      view.unmount();
    }
  });
  it('a paid, eligible pack offers "Request a refund" and a link to its invoice; nothing is sent by the button itself', async () => {
    renderWithI18n(<Purchases purchases={[purchase()]} />);
    expect(screen.getByRole('link', { name: 'Download invoice' })).toHaveAttribute('href', '/invoices/inv-1');
    await userEvent.click(screen.getByRole('button', { name: 'Request a refund' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Request a refund for Starter · 10 credits · $19.00?');
    expect(screen.getByText('The 10 credits are held until we answer.')).toBeInTheDocument();
    expect(requestRefund).not.toHaveBeenCalled();
  });

  it('"Keep the credits" closes the window and asks for nothing', async () => {
    renderWithI18n(<Purchases purchases={[purchase()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Request a refund' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep the credits' }));
    expect(requestRefund).not.toHaveBeenCalled();
  });

  it('"Request refund" calls the action once, with the purchase id', async () => {
    requestRefund.mockResolvedValue({ status: 'requested', credits: 10 });
    renderWithI18n(<Purchases purchases={[purchase()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Request a refund' }));
    await userEvent.click(screen.getByRole('button', { name: 'Request refund' }));
    expect(requestRefund).toHaveBeenCalledTimes(1);
    expect((requestRefund.mock.calls[0]?.[1] as FormData).get('purchaseId')).toBe('pur-1');
  });

  it('a pack that cannot be refunded says why: used, or too old (with the 14 days)', () => {
    renderWithI18n(<Purchases purchases={[purchase({ refundable: { ok: false, reason: 'used' } }), purchase({ id: 'pur-2', refundable: { ok: false, reason: 'too-old' } })]} />);
    expect(screen.getByText('Not refundable: credits from this pack were used.')).toBeInTheDocument();
    expect(screen.getByText('Not refundable: more than 14 days ago.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request a refund' })).toBeNull();
  });

  it('a requested refund shows the 2 business days, the held credits and "Cancel request"; cancelling calls the action', async () => {
    cancelRefund.mockResolvedValue({ status: 'cancelled', credits: 10 });
    const { rerender } = renderWithI18n(<Purchases purchases={[purchase({ status: 'refund-requested', refundable: null })]} />);
    expect(screen.getByText('We answer within 2 business days. The 10 credits are held until then.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(cancelRefund).toHaveBeenCalledTimes(1);
    // The page comes back from the server with the pack `paid` again; the row keeps the answer of its action.
    rerender(<I18nProvider locale="en" messages={loadMessages('en')}><Purchases purchases={[purchase()]} /></I18nProvider>);
    expect(await screen.findByText('Request cancelled. Your 10 credits are available again.')).toBeInTheDocument();
  });

  it('sent, refunded and failed show their sentences; failed offers support with the refund topic', () => {
    renderWithI18n(
      <Purchases purchases={[
        purchase({ id: 'a', status: 'refund-sent', refundable: null }),
        purchase({ id: 'b', status: 'refunded', refundable: null, refund: { requestedAt: '2026-10-02T10:00:00Z', sentAt: '2026-10-03T10:00:00Z', settledAt: '2026-10-04T10:00:00Z', by: null } }),
        purchase({ id: 'c', status: 'refund-failed', refundable: null }),
      ]} />,
    );
    expect(screen.getByText(/10 credits were removed\. The money is on its way/)).toBeInTheDocument();
    expect(screen.getByText(/Refunded on .*\$19\.00 went back to your payment method\./)).toBeInTheDocument();
    expect(screen.getByText(/The refund did not go through\. Your 10 credits are back in your balance\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact?topic=refund');
  });

  // What the buyer sees when the provider refused the refund outright (its wallet could not cover it): the purchase is "Refund failed" at once.
  it.each([
    ['en', 'Refund failed', 'The refund did not go through. Your 10 credits are back in your balance. Contact support and we sort it out.'],
    ['tr', 'İade olmadı', 'İade gerçekleşmedi. 10 kredin bakiyene geri döndü. Destekle iletişime geç, birlikte çözelim.'],
  ] as const)('a refund that failed says so in plain words, with the credits back and nobody blamed, and never that money is on its way (%s)', (locale, status, text) => {
    renderWithI18n(<Purchases purchases={[purchase({ status: 'refund-failed', refundable: null })]} />, locale);
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent(status);
    expect(row).toHaveTextContent(text);
    expect(row).not.toHaveTextContent(/on its way|yolda|Dodo|wallet|cüzdan/);
  });

  it('has the invoice help line pointing to /contact, and an empty state', () => {
    renderWithI18n(<Purchases purchases={[]} />);
    expect(screen.getByText('No purchases yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact support.' })).toHaveAttribute('href', '/contact');
  });
});

describe('DeleteAccount states', () => {
  it('a running job disables "Delete account" in the window and says why', async () => {
    renderWithI18n(<DeleteAccount balanceLabel="12 credits" jobRunning />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByText('You have a job running.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect(screen.getAllByRole('button', { name: 'Delete account' }).at(-1)).toBeDisabled();
  });
  it.each([['en', 'removed from your account at once'], ['tr', 'hesabından hemen kaldırılır']] as const)('the delete window does not say the files are deleted, in %s: they leave the account at once', async (locale, text) => {
    renderWithI18n(<DeleteAccount balanceLabel="12 credits" />, locale);
    await userEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Delete account' : 'Hesabı sil' }));
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/^(deleted|silinir)$/)).toBeNull();
  });
  it('lists what is deleted and the invoice sentence; a failure keeps the window with its message', async () => {
    deleteAccount.mockResolvedValue({ status: 'failed' });
    renderWithI18n(<DeleteAccount balanceLabel="12 credits" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByText('Your videos, images and templates')).toBeInTheDocument();
    expect(screen.getByText('Invoices are kept for as long as tax law requires.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete account' }).at(-1)!);
    expect(await screen.findByText('Could not delete your account.')).toBeInTheDocument();
    expect(screen.getByText('Nothing was removed. Try again.')).toBeInTheDocument();
  });
});
