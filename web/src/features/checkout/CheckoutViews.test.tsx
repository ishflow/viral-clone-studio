import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { isGenerateForm } from './draft';
import { FailedView } from './FailedView';
import { MockProvider } from './MockProvider';
import { ConfirmingView, DelayedView, StoppedCheckoutView } from './ReturnViews';
import { SuccessView } from './SuccessView';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
const startCheckout = vi.fn();
vi.mock('./actions', () => ({ settleCheckout: vi.fn(), checkPayment: vi.fn(), startCheckout: (...a: unknown[]) => startCheckout(...a) }));
afterEach(() => {
  cleanup();
  startCheckout.mockReset();
});

const draft = { title: 'Fragrance layering recipe', image: '/samples/a.jpg', products: 4 };
const receipt = { packName: 'Standard', packId: 'pack-standard', credits: 30, amount: '$54.00', at: '2026-03-04T10:00:00Z', invoiceId: 'inv-1' };

describe('isGenerateForm', () => {
  it('recognises the generate form path only', () => {
    expect(isGenerateForm('/templates/tpl-eye/generate')).toBe('tpl-eye');
    expect(isGenerateForm('/templates/tpl-eye/generate?x=1')).toBe('tpl-eye');
    expect(isGenerateForm('/gallery')).toBeNull();
    expect(isGenerateForm('/templates/tpl-eye')).toBeNull();
  });
});

describe('SuccessView', () => {
  it('shows pack, credits, what was paid, date and the invoice link', () => {
    renderWithI18n(<SuccessView receipt={receipt} balance={42} returnTo="/gallery" draft={null} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('30 credits added.');
    expect(screen.getByText('Standard pack')).toBeInTheDocument();
    expect(screen.getByText('$54.00')).toBeInTheDocument();
    expect(screen.queryByText('New balance')).toBeNull();
    expect(screen.getByRole('link', { name: 'Download invoice' })).toHaveAttribute('href', '/invoices/inv-1');
  });
  it('a payment the provider added tax to shows the pack price, the tax and the total that was charged, in both languages', () => {
    const taxed = { ...receipt, taxCents: 1026, totalCents: 6426 };
    const { unmount } = renderWithI18n(<SuccessView receipt={taxed} balance={42} returnTo="/gallery" draft={null} />);
    for (const [label, value] of [['Pack price', '$54.00'], ['Tax', '$10.26'], ['Paid', '$64.26']]) expect(screen.getByText(label!).nextElementSibling).toHaveTextContent(value!);
    unmount();
    renderWithI18n(<SuccessView receipt={taxed} balance={42} returnTo="/gallery" draft={null} />, 'tr');
    for (const [label, value] of [['Paket bedeli', '$54.00'], ['Vergi', '$10.26'], ['Ödenen', '$64.26']]) expect(screen.getByText(label!).nextElementSibling).toHaveTextContent(value!);
  });
  it.each([{}, { taxCents: 0, totalCents: 5400 }])('without a tax (no report of one, or a tax of zero) the receipt is what it was: one "Paid" row with the pack price', (charged) => {
    renderWithI18n(<SuccessView receipt={{ ...receipt, ...charged }} balance={42} returnTo="/gallery" draft={null} />);
    expect(screen.getByText('Paid').nextElementSibling).toHaveTextContent('$54.00');
    expect(screen.queryByText('Tax')).toBeNull();
    expect(screen.queryByText('Pack price')).toBeNull();
  });
  it('a payment with the provider\'s own invoice shows two links, so one is left if the other does not open: "Invoice (Dodo)" to the provider\'s address and the site\'s own page; without one the site\'s page alone, in both languages', () => {
    const dodo = 'https://test.dodopayments.com/invoices/payments/pay_A';
    for (const [locale, provider, site] of [['en', 'Invoice (Dodo)', 'Download invoice'], ['tr', 'Fatura (Dodo)', 'Faturayı indir']] as const) {
      const real = renderWithI18n(<SuccessView receipt={{ ...receipt, invoiceUrl: dodo }} balance={42} returnTo="/gallery" draft={null} />, locale);
      const link = screen.getByRole('link', { name: provider });
      expect(link).toHaveAttribute('href', dodo);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.getByRole('link', { name: site })).toHaveAttribute('href', '/invoices/inv-1');
      real.unmount();
      const own = renderWithI18n(<SuccessView receipt={receipt} balance={42} returnTo="/gallery" draft={null} />, locale);
      expect(screen.getByRole('link', { name: site })).toHaveAttribute('href', '/invoices/inv-1');
      expect(screen.queryByText(/Dodo/)).toBeNull();
      own.unmount();
    }
  });
  it('offers only the gallery when no video is waiting', () => {
    renderWithI18n(<SuccessView receipt={receipt} balance={42} returnTo="/gallery" draft={null} />);
    expect(screen.getByRole('link', { name: 'Browse the gallery' })).toHaveAttribute('href', '/gallery');
    expect(screen.queryByText('Your video is waiting')).toBeNull();
  });
  it('bought from somewhere else (a stopped job): the first button goes back there, the gallery is second', () => {
    renderWithI18n(<SuccessView receipt={receipt} balance={42} returnTo="/jobs/job-1" draft={null} />);
    expect(screen.getByRole('link', { name: 'Back to where you were' })).toHaveAttribute('href', '/jobs/job-1');
    expect(screen.getByRole('link', { name: 'Back to where you were' })).toHaveClass('bg-accent');
    expect(screen.getByRole('link', { name: 'Browse the gallery' })).toHaveAttribute('href', '/gallery');
    expect(screen.getByRole('link', { name: 'Browse the gallery' })).not.toHaveClass('bg-accent');
  });
  it('offers the way back to the confirmation when a video is waiting', () => {
    renderWithI18n(<SuccessView receipt={receipt} balance={42} returnTo="/templates/tpl-eye/generate" draft={draft} />);
    expect(screen.getByText('Your video is waiting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your video' })).toHaveAttribute('href', '/templates/tpl-eye/generate');
    expect(screen.getByText('Fragrance layering recipe')).toBeInTheDocument();
    expect(screen.getByText('Your form is saved.')).toBeInTheDocument();
  });
});

describe('FailedView', () => {
  it('"Try again" is a form (a POST) that opens a new checkout of the same pack with the same returnTo; no address opens one', async () => {
    const { container } = renderWithI18n(<FailedView packId="pack-standard" packName="Standard" credits={30} price="$54" balance={12} returnTo="/templates/tpl-eye/generate" draft={draft} />);
    expect(container.querySelector('a[href*="/checkout/start"]')).toBeNull();
    const retry = screen.getByRole('button', { name: /Try another payment method/ });
    expect(retry).toHaveTextContent('Standard pack · 30 credits · $54');
    await userEvent.click(retry);
    await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
    expect(startCheckout.mock.calls[0]!.slice(0, 2)).toEqual(['pack-standard', '/templates/tpl-eye/generate']);
  });
  it('the text says what the button does: trying again opens a new payment page where the details are entered again, not the same one, in both languages', () => {
    for (const [locale, said] of [['en', 'Trying again opens a new secure payment page, where you enter your details again.'], ['tr', 'Tekrar denemek yeni bir güvenli ödeme sayfası açar; bilgilerini orada yeniden girersin.']] as const) {
      const { unmount } = renderWithI18n(<FailedView packId="pack-standard" packName="Standard" credits={30} price="$54" balance={12} returnTo="/gallery" draft={null} />, locale);
      expect(screen.getByText(said, { exact: false })).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/the same secure payment page|aynı güvenli ödeme sayfasını/);
      unmount();
    }
  });
  it('the other ways out: another pack (keeping the way back), support, and the saved form', () => {
    renderWithI18n(<FailedView packId="pack-standard" packName="Standard" credits={30} price="$54" balance={12} returnTo="/templates/tpl-eye/generate" draft={draft} />);
    expect(screen.getByRole('link', { name: /Choose another pack/ })).toHaveAttribute('href', '/pricing?returnTo=%2Ftemplates%2Ftpl-eye%2Fgenerate');
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact');
    expect(screen.getByText('Nothing is lost')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your video' })).toHaveAttribute('href', '/templates/tpl-eye/generate');
  });
  it('says declined, and that nothing was charged', () => {
    renderWithI18n(<FailedView packId="pack-standard" packName="Standard" credits={30} price="$54" balance={12} returnTo="/gallery" draft={null} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The payment was declined.');
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.getByText('Nothing was charged. Your balance is still 12 credits.')).toBeInTheDocument();
  });
  it('the declined page shows no square-bracket placeholder, in either language', () => {
    for (const locale of ['en', 'tr'] as const) {
      const { container } = renderWithI18n(<FailedView packId="pack-standard" packName="Standard" credits={30} price="$54" balance={12} returnTo="/gallery" draft={null} />, locale);
      expect(container.textContent).not.toMatch(/\[[A-Z ]+\]/);
      cleanup();
    }
  });
  it('hides the saved-form card when no video is waiting, and "another pack" is plain pricing when there is no way back', () => {
    renderWithI18n(<FailedView packId="pack-standard" packName="Standard" credits={30} price="$54" balance={12} returnTo="/gallery" draft={null} />);
    expect(screen.queryByText('Nothing is lost')).toBeNull();
    expect(screen.getByRole('link', { name: /Choose another pack/ })).toHaveAttribute('href', '/pricing');
  });
});

describe('MockProvider', () => {
  const checkout = { id: 'c1', userId: 'u', pack: { id: 'pack-standard', name: 'Standard', credits: 30, price: null, priceCents: null }, returnTo: '/gallery', status: 'open', purchaseId: null,
    startedAt: '2026-10-04T12:00:00Z', reference: null, delayed: false } as const;
  it('is labelled as a demo and offers Pay and Decline', () => {
    renderWithI18n(<MockProvider checkout={checkout} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Payment provider (demo)' })).toBeInTheDocument();
    expect(screen.getByText('Standard pack')).toBeInTheDocument();
    expect(screen.getByText('[PRICE]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay' })).toHaveAttribute('value', 'paid');
    expect(screen.getByRole('button', { name: 'Decline' })).toHaveAttribute('value', 'declined');
  });
  it('offers the provider answers that are not final: Pending, Cancel and Expire, next to Pay and Decline', () => {
    renderWithI18n(<MockProvider checkout={checkout} />);
    expect(screen.getByRole('button', { name: 'Pending' })).toHaveAttribute('value', 'pending');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('value', 'cancelled');
    expect(screen.getByRole('button', { name: 'Expire' })).toHaveAttribute('value', 'expired');
  });
  it('sends only the checkout id (nothing else is trusted)', () => {
    const { container } = renderWithI18n(<MockProvider checkout={checkout} />);
    expect(Array.from(container.querySelectorAll('input[type=hidden]')).map((i) => (i as HTMLInputElement).name)).toEqual(['checkoutId']);
  });
  it('shows an already settled state with a link to the result instead of Pay / Decline', () => {
    renderWithI18n(<MockProvider checkout={{ ...checkout, status: 'paid', purchaseId: 'p1' }} />);
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
    expect(screen.getByText('This payment is already settled.')).toBeInTheDocument();
    const href = screen.getByRole('link', { name: 'See the result' }).getAttribute('href')!;
    expect(href).toBe('/checkout/return?checkout=c1&returnTo=%2Fgallery');
  });
});

describe('return states (B4)', () => {
  const checkout = { id: 'c1', userId: 'u', pack: { id: 'pack-standard', name: 'Standard', credits: 30, price: '$54', priceCents: 5400 }, returnTo: '/templates/tpl-eye/generate', status: 'pending', purchaseId: null,
    startedAt: '2026-10-04T12:00:00Z', reference: 'PAY-77', delayed: false } as const;

  it('Confirming: says to wait and not to pay again, shows the order and the saved form, and has no button that takes a payment', () => {
    renderWithI18n(<ConfirmingView checkout={checkout} returnTo="/templates/tpl-eye/generate" draft={draft} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Confirming your payment…');
    expect(screen.getByText('This usually takes a few seconds. Do not pay again.')).toBeInTheDocument();
    expect(screen.getByText('$54')).toBeInTheDocument();
    expect(screen.getByText('Your form is saved.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to your video' })).toHaveAttribute('href', '/templates/tpl-eye/generate');
  });
  it('Confirming asks the server again on a timer (a refresh, nothing is paid or completed by it)', () => {
    vi.useFakeTimers();
    try {
      renderWithI18n(<ConfirmingView checkout={checkout} returnTo="/gallery" draft={null} />);
      vi.advanceTimersByTime(9_000);
      expect(refresh).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it('Delayed: the reference, "Check again" POST for this checkout, support for payments; nothing to pay with', () => {
    renderWithI18n(<DelayedView checkout={{ ...checkout, delayed: true }} returnTo="/templates/tpl-eye/generate" draft={draft} />);
    expect(screen.getByText('We are still waiting for the payment provider.')).toBeInTheDocument();
    expect(screen.getByText(/You do not need to pay again\./)).toBeInTheDocument();
    expect(screen.getByText('Reference PAY-77')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toHaveAttribute('type', 'submit');
    expect(document.querySelector('input[name=checkoutId]')).toHaveAttribute('value', 'c1');
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact?topic=payment');
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
  });
  it('Cancelled and Expired: nothing was charged, back to pricing keeps the way back', () => {
    const { unmount } = renderWithI18n(<StoppedCheckoutView status="cancelled" returnTo="/templates/tpl-eye/generate" draft={draft} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You left the checkout.');
    expect(screen.getByText('Nothing was charged.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to pricing' })).toHaveAttribute('href', '/pricing?returnTo=%2Ftemplates%2Ftpl-eye%2Fgenerate');
    unmount();
    renderWithI18n(<StoppedCheckoutView status="expired" returnTo="/gallery" draft={null} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This checkout expired.');
    expect(screen.getByText('Nothing was charged. Start again from pricing.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to pricing' })).toHaveAttribute('href', '/pricing');
  });
});
