import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const refundPurchase = vi.fn();
vi.mock('./actions', () => ({ refundPurchase: (...a: unknown[]) => refundPurchase(...a) }));

import { CreditsView, type CreditsViewProps } from './CreditsView';
import { RevenueView, type RevenueViewProps } from './RevenueView';

afterEach(cleanup);
beforeEach(() => { refundPurchase.mockReset(); refresh.mockReset(); });

const revenue = (over: Partial<RevenueViewProps> = {}): RevenueViewProps => ({
  period: '30d', mark: null, chart: null, uncredited: [],
  tiles: { revenue: null, purchases: 3, average: null, paying: 2, notCompleted: 1, refunds: null },
  packs: [
    { id: 'pack-starter', name: 'Starter', credits: 10, price: null, sold: 1, revenue: null },
    { id: 'pack-standard', name: 'Standard', credits: 30, price: null, sold: 2, revenue: null },
  ],
  purchases: [
    { id: 'p1', at: '2026-10-01T10:00:00Z', userId: 'usr-demo', email: 'demo@viralclone.app', packName: 'Standard', credits: 30, amount: null, status: 'paid', invoiceId: 'inv-1', invoiceNumber: 'VC-0001', by: null, review: null, balance: 12 },
    { id: 'p2', at: '2026-10-02T10:00:00Z', userId: 'usr-free', email: 'free-only@example.com', packName: 'Starter', credits: 10, amount: null, status: 'not-completed', invoiceId: null, invoiceNumber: null, by: null, review: null, balance: 3 },
    { id: 'p3', at: '2026-10-03T10:00:00Z', userId: 'usr-paying', email: 'paying@example.com', packName: 'Studio', credits: 100, amount: null, status: 'refunded', invoiceId: 'inv-3', invoiceNumber: 'VC-0003', by: 'Admin Ada', review: null, balance: 0 },
    { id: 'p4', at: '2026-10-04T10:00:00Z', userId: 'usr-demo', email: 'demo@viralclone.app', packName: 'Starter', credits: 10, amount: '$19', status: 'refund-requested', invoiceId: 'inv-4', invoiceNumber: 'VC-0004', by: null, review: null, balance: 12 },
    { id: 'p5', at: '2026-10-05T10:00:00Z', userId: 'usr-paying', email: 'paying@example.com', packName: 'Starter', credits: 10, amount: '$19', status: 'refund-failed', invoiceId: 'inv-5', invoiceNumber: 'VC-0005', by: 'Admin Ada', review: null, balance: 10 },
  ],
  ...over,
});

describe('RevenueView', () => {
  it('has the Purchases / Credits tabs, the period links and a real CSV download for the period', () => {
    renderWithI18n(<RevenueView {...revenue({ period: '7d' })} />);
    const nav = screen.getByRole('navigation', { name: 'Revenue sections' });
    expect(within(nav).getByRole('link', { name: 'Purchases' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Credits' })).toHaveAttribute('href', '/admin/revenue/credits');
    const period = screen.getByRole('group', { name: 'Period' });
    expect(within(period).getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page');
    expect(within(period).getByRole('link', { name: 'All time' })).toHaveAttribute('href', '/admin/revenue?period=all');
    const csv = screen.getByRole('link', { name: 'Export CSV' });
    expect(csv).toHaveAttribute('href', '/admin/revenue/export?period=7d');
    expect(csv).toHaveAttribute('download');
  });

  it('tiles: real counts, money placeholders; pack table placeholders for price, revenue, share', () => {
    renderWithI18n(<RevenueView {...revenue()} />);
    const tile = (l: string) => screen.getByText(l, { selector: 'span' }).parentElement!;
    expect(tile('Purchases')).toHaveTextContent('3');
    expect(tile('Paying users')).toHaveTextContent('2');
    expect(tile('Payments not completed')).toHaveTextContent('1');
    for (const l of ['Revenue', 'Average purchase', 'Refunds']) expect(tile(l)).toHaveTextContent('—');
    const packs = screen.getByRole('table', { name: 'Revenue by credit pack' });
    const standard = within(packs).getByRole('row', { name: /Standard pack/ });
    expect(standard).toHaveTextContent('[PRICE]');
    expect(standard).toHaveTextContent('—');
    expect(standard).toHaveTextContent('30');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the chart.'); // chart: null = the card's own error state
  });

  it.each([
    ['en', 'Refunds', 'Money refunded to customers', '$19.00 more sent, result awaited'],
    ['tr', 'İadeler', 'Müşterilere iade edilen para', '$19.00 daha gönderildi, sonucu bekleniyor'],
  ] as const)('the refunds tile says the money that is back; refunds that were sent and are not settled stand under it as awaited, and are not in the sum (%s)', (locale, label, plain, awaited) => {
    const tiles = { ...revenue().tiles, refunds: '$41.61' };
    const { unmount } = renderWithI18n(<RevenueView {...revenue({ tiles })} />, locale);
    const tile = () => screen.getByText(label, { selector: 'span' }).parentElement!;
    expect(tile()).toHaveTextContent('$41.61');
    expect(tile()).toHaveTextContent(plain);
    unmount();
    renderWithI18n(<RevenueView {...revenue({ tiles: { ...tiles, refundsPending: '$19.00' } })} />, locale);
    expect(tile()).toHaveTextContent('$41.61');
    expect(tile()).toHaveTextContent(awaited);
  });

  it('the Tax column shows the tax the provider added and the total it charged, in both languages; the amount stays the pack price, and a purchase without a tax keeps the dash', () => {
    const [first, second] = revenue().purchases;
    const rows = [{ ...first!, amount: '$54.00', tax: '$10.26', total: '$64.26' }, second!];
    const { unmount } = renderWithI18n(<RevenueView {...revenue({ purchases: rows })} />);
    const cells = () => within(screen.getAllByRole('row').find((row) => /VC-0001/.test(row.textContent ?? ''))!).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells()).toEqual(expect.arrayContaining(['$54.00', '$10.26Charged $64.26']));
    expect(within(screen.getAllByRole('row').find((row) => /free-only/.test(row.textContent ?? ''))!).getAllByText('—').length).toBeGreaterThan(0);
    unmount();
    renderWithI18n(<RevenueView {...revenue({ purchases: rows })} />, 'tr');
    expect(cells()).toEqual(expect.arrayContaining(['$54.00', '$10.26Çekilen $64.26']));
  });
  it('the invoice link of a purchase is "PDF" and goes to the provider\'s own invoice where the payment has one; the site\'s own page is "View", in both languages', () => {
    const dodo = 'https://test.dodopayments.com/invoices/payments/pay_A';
    const [first, , , fourth] = revenue().purchases;
    for (const [locale, view] of [['en', 'View'], ['tr', 'Görüntüle']] as const) {
      const { unmount } = renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...first!, invoiceUrl: dodo }, fourth!] })} />, locale);
      const real = screen.getByRole('link', { name: 'PDF' });
      expect(real).toHaveAttribute('href', dodo);
      // The provider's site opens in a new tab and is told nothing of the admin page it was opened from.
      expect(real).toHaveAttribute('target', '_blank');
      expect(real).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.getByRole('link', { name: view })).toHaveAttribute('href', '/invoices/inv-4');
      unmount();
    }
  });
  it('Refund is on a row with a refund request, Try the refund again on a failed one; paid, sent and refunded rows have none; statuses are translated and the sender is named', () => {
    renderWithI18n(<RevenueView {...revenue()} />);
    const table = screen.getByRole('table', { name: 'Purchases' });
    expect(within(table).getAllByRole('button')).toHaveLength(2);
    const requested = within(table).getByRole('row', { name: /VC-0004/ });
    expect(within(requested).getByRole('button', { name: 'Refund' })).toBeInTheDocument();
    const failed = within(table).getByRole('row', { name: /VC-0005/ });
    expect(within(failed).getByRole('button', { name: 'Try the refund again' })).toBeInTheDocument();
    expect(within(failed).getByText('By Admin Ada')).toBeInTheDocument();
    const paid = within(table).getByRole('row', { name: /VC-0001/ });
    expect(within(paid).queryByRole('button')).toBeNull();
    expect(within(paid).getByRole('link', { name: 'View' })).toHaveAttribute('href', '/invoices/inv-1');
    expect(within(paid).getByRole('link', { name: 'demo@viralclone.app' })).toHaveAttribute('href', '/admin/users/usr-demo');
    expect(within(table).getByText('No invoice')).toBeInTheDocument();
    for (const s of ['Paid', 'Not completed', 'Refunded', 'Refund requested', 'Refund failed']) expect(within(table).getByText(s)).toBeInTheDocument();
  });

  it('?status=not-completed and ?status=refund-requested mark their rows (and only those)', () => {
    renderWithI18n(<RevenueView {...revenue({ mark: 'not-completed' })} />);
    const row = (name: RegExp) => within(screen.getByRole('table', { name: 'Purchases' })).getByRole('row', { name });
    expect(row(/free-only@example.com/).querySelector('[data-marked="true"]')).not.toBeNull();
    expect(row(/VC-0001/).querySelector('[data-marked]')).toBeNull();
    cleanup();
    renderWithI18n(<RevenueView {...revenue({ mark: 'refund-requested' })} />);
    expect(row(/VC-0004/).querySelector('[data-marked="true"]')).not.toBeNull();
    expect(row(/free-only@example.com/).querySelector('[data-marked]')).toBeNull();
    cleanup();
    renderWithI18n(<RevenueView {...revenue({ mark: null })} />);
    expect(row(/free-only@example.com/).querySelector('[data-marked]')).toBeNull();
  });

  it('the refund window of a pack with spent credits says what is left of the pack as the credits removed, before and after the refund, in both languages: the spent ones are gone already', async () => {
    const [, , , asked, failed] = revenue().purchases;
    for (const [locale, button, removed, after, left, done] of [['en', 'Refund', 'Credits removed', 'Balance after', '7 credits', 'Close'], ['tr', 'İade et', 'Alınan kredi', 'Sonraki bakiye', '7 kredi', 'Kapat']] as const) {
      const user = userEvent.setup();
      refundPurchase.mockResolvedValue({ status: 'done', at: '2026-10-05T10:00:00Z', detail: { amount: '$19', credits: 7, balanceAfter: 12, confirmed: true } });
      const view = renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...asked!, creditsLeft: 7 }] })} />, locale);
      await user.click(screen.getByRole('button', { name: button }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(removed).nextSibling).toHaveTextContent(left);
      // Held since the request: they are not in the balance, so it stays what it is.
      expect(within(dialog).getByText(after).nextSibling).toHaveTextContent('12');
      // The row, and the sentence under the rows.
      expect(within(dialog).getAllByText(new RegExp(left))).toHaveLength(2);
      expect(dialog).not.toHaveTextContent(/\b10\b/);
      await user.type(within(dialog).getByRole('textbox'), 'Refunded in the panel');
      await user.click(within(dialog).getByRole('button', { name: button }));
      await within(dialog).findByRole('button', { name: done });
      expect(within(dialog).getByText(removed).nextSibling).toHaveTextContent(left);
      view.unmount();
    }
    // A failed refund gave back what was left of the pack, so that is what leaves the balance again.
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...failed!, creditsLeft: 4 }] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try the refund again' }));
    const again = await screen.findByRole('dialog');
    expect(within(again).getByText('Credits removed').nextSibling).toHaveTextContent('4 credits');
    expect(within(again).getByText('Balance after').nextSibling).toHaveTextContent('6');
  });

  it('Refund asks first with the facts: nothing is sent until confirmed with a reason, Escape and Cancel do nothing', async () => {
    const user = userEvent.setup();
    refundPurchase.mockResolvedValue({ status: 'done', at: '2026-10-05T10:00:00Z', detail: { amount: '$19', credits: 10, balanceAfter: 12, confirmed: true } });
    renderWithI18n(<RevenueView {...revenue()} />);
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    const dialog = await screen.findByRole('dialog', { name: 'Refund this purchase?' });
    expect(within(dialog).getByText('Purchase').nextSibling).toHaveTextContent(/Starter pack · /);
    expect(within(dialog).getByText('Invoice').nextSibling).toHaveTextContent('VC-0004');
    expect(within(dialog).getByText('Credits removed').nextSibling).toHaveTextContent('10 credits');
    expect(within(dialog).getByText('Balance after').nextSibling).toHaveTextContent('12');
    expect(within(dialog).getByText('Amount to refund').nextSibling).toHaveTextContent('$19');
    expect(within(dialog).getByText(/The 10 credits of this pack are held since the request and are removed now/)).toBeInTheDocument();
    within(dialog).getByRole('button', { name: 'Cancel' }).focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(refundPurchase).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    const again = await screen.findByRole('dialog');
    const confirm = within(again).getByRole('button', { name: 'Refund' });
    expect(confirm.className).toMatch(/border-warn/);
    await user.click(confirm);
    expect(refundPurchase).not.toHaveBeenCalled();
    await user.type(within(again).getByLabelText('Reason'), 'Within 14 days');
    await user.click(confirm);
    await waitFor(() => expect(refundPurchase).toHaveBeenCalledTimes(1));
    expect(refundPurchase.mock.calls[0]![0]).toMatchObject({ purchaseId: 'p4', reason: 'Within 14 days' });
    const done = await screen.findByRole('dialog', { name: 'Done' });
    expect(within(done).getByText('Amount refunded').nextSibling).toHaveTextContent('$19');
    expect(within(done).getByText('Refund sent. The money is on its way to the payment method.')).toBeInTheDocument();
  });

  it.each([
    ['en', 'Refund', 'Reason', 'Done', 'Refunded at the provider', 'The 7 credits left in this pack are removed now. No money is sent: the whole payment was refunded at the payment provider already.', 'Closed. No money was sent from here: the whole payment was refunded at the payment provider already.'],
    ['tr', 'İade et', 'Neden', 'Tamam', 'Sağlayıcıda iade edilen', 'Bu pakette kalan 7 kredi şimdi düşülür. Para gönderilmez: ödemenin tamamı ödeme sağlayıcısında zaten iade edilmiş.', 'Kapatıldı. Buradan para gönderilmedi: ödemenin tamamı ödeme sağlayıcısında zaten iade edilmişti.'],
  ] as const)('closing a pack whose whole payment went back at the provider says that no money is sent, and names the total that went back, tax included: never "on its way" or "in a few days" (%s)', async (locale, button, reason, title, label, info, note) => {
    const user = userEvent.setup();
    refundPurchase.mockResolvedValueOnce({ status: 'done', at: '2026-10-07T10:00:00Z', detail: { amount: '$22.61', credits: 7, balanceAfter: 12, confirmed: true, closed: true } });
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...revenue().purchases[3]!, amount: '$19.00', tax: '$3.61', total: '$22.61', creditsLeft: 7, review: 'refund-outside' }] })} />, locale);
    await user.click(screen.getByRole('button', { name: button }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(label).nextSibling).toHaveTextContent('$22.61');
    expect(within(dialog).getByText(info)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/in a few days|birkaç gün|Amount to refund|İade edilecek tutar/);
    await user.type(within(dialog).getByLabelText(reason), 'Refunded in the panel');
    await user.click(within(dialog).getByRole('button', { name: button }));
    const done = await screen.findByRole('dialog', { name: title });
    expect(within(done).getByText(label).nextSibling).toHaveTextContent('$22.61');
    expect(within(done).getByRole('status')).toHaveTextContent(note);
    expect(done).not.toHaveTextContent(/on its way|yolda|\$19\.00/);
  });
  it('a refund of a purchase the provider added tax to asks with the total that goes back, not the pack price; without a tax it asks with the price as before', async () => {
    const user = userEvent.setup();
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...revenue().purchases[3]!, amount: '$19.00', tax: '$3.61', total: '$22.61' }] })} />);
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    const dialog = await screen.findByRole('dialog', { name: 'Refund this purchase?' });
    expect(within(dialog).getByText('Amount to refund').nextSibling).toHaveTextContent('$22.61');
    expect(within(dialog).getByText(/The money is refunded to the payment method in a few days/)).toBeInTheDocument();
  });

  it.each([
    ['en', 'Refund', 'Reason', 'Done', 'The refund was sent, but the payment provider has not confirmed that it took it, so it is not known yet whether money goes back. Do not send it again: the provider is being asked, and the list will say "Refunded", or "Refund failed" with the credits back.'],
    ['tr', 'İade et', 'Neden', 'Tamam', 'İade gönderildi ama ödeme sağlayıcısı aldığını doğrulamadı; paranın geri gidip gitmediği henüz bilinmiyor. Tekrar gönderme: sağlayıcıya soruluyor, liste "İade edildi" ya da krediler geri dönmüş olarak "İade başarısız" diyecek.'],
  ] as const)('a refund whose answer from the provider never came does not say that the money is on its way: the result is awaited (%s)', async (locale, button, reason, title, text) => {
    const user = userEvent.setup();
    refundPurchase.mockResolvedValueOnce({ status: 'done', at: '2026-10-07T10:00:00Z', detail: { amount: '$19', credits: 10, balanceAfter: 12, confirmed: false } });
    renderWithI18n(<RevenueView {...revenue()} />, locale);
    await user.click(screen.getByRole('button', { name: button }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(reason), 'Within 14 days');
    await user.click(within(dialog).getByRole('button', { name: button }));
    const done = await screen.findByRole('dialog', { name: title });
    expect(within(done).getByRole('status')).toHaveTextContent(text);
    expect(done).not.toHaveTextContent(/on its way|yolda/);
  });

  it('a refund the provider refused says what happened to the money and the credits, offers no second try with the same key, and closes onto a fresh page', async () => {
    const user = userEvent.setup();
    refundPurchase.mockResolvedValueOnce({ status: 'refused' });
    renderWithI18n(<RevenueView {...revenue()} />);
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Within 14 days');
    await user.click(within(dialog).getByRole('button', { name: 'Refund' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The payment provider refused this refund. No money went back, and the credits of this pack are back in the customer\'s balance. The purchase now says "Refund failed": check the provider, then try the refund again from the list.');
    expect(within(dialog).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(within(dialog).queryByLabelText('Reason')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refundPurchase).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['en', 'Refund', 'Reason', 'The payment provider refused this refund: the balance of its account (the Dodo wallet) does not cover the amount. No money went back, and the credits of this pack are back in the customer\'s balance. The purchase now says "Refund failed": when the balance covers it, try the refund again from the list.'],
    ['tr', 'İade et', 'Neden', 'Ödeme sağlayıcısı bu iadeyi reddetti: hesabındaki bakiye (Dodo cüzdanı) bu tutara yetmiyor. Para geri gitmedi, bu paketin kredileri müşterinin bakiyesine geri döndü. Satın alma artık "İade başarısız" görünüyor: bakiye yetince iadeyi listeden tekrar dene.'],
  ] as const)('a refund the provider refused because its balance cannot cover it says exactly that, and never that money is on its way or that the result is awaited (%s)', async (locale, button, reason, text) => {
    const user = userEvent.setup();
    refundPurchase.mockResolvedValueOnce({ status: 'refused', why: 'no-funds' });
    renderWithI18n(<RevenueView {...revenue()} />, locale);
    await user.click(screen.getByRole('button', { name: button }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(reason), 'Within 14 days');
    await user.click(within(dialog).getByRole('button', { name: button }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
    expect(dialog).not.toHaveTextContent(/on its way|awaited|yolda|bekleniyor/);
    expect(within(dialog).queryByLabelText(reason)).toBeNull();
  });

  it.each([
    ['en', 'Purchases', 'Try the refund again', 'The payment provider refused this refund: the balance of its account (the Dodo wallet) does not cover the amount. No money went back, and the credits are back in the balance. Try the refund again when the balance covers it.'],
    ['tr', 'Satın almalar', 'İadeyi tekrar dene', 'Ödeme sağlayıcısı bu iadeyi reddetti: hesabındaki bakiye (Dodo cüzdanı) bu tutara yetmiyor. Para geri gitmedi, krediler bakiyeye geri döndü. Bakiye yetince iadeyi tekrar dene.'],
  ] as const)('a refund that failed because the provider\'s balance could not cover it says so next to its status, and the row offers the refund again (%s)', (locale, table, again, text) => {
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...revenue().purchases[4]!, review: 'refund-no-funds' }] })} />, locale);
    const row = within(screen.getByRole('table', { name: table })).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent(text);
    expect(within(row).getByRole('button', { name: again })).toBeInTheDocument();
  });

  it('a failed refund keeps the dialog open: "It did not go through", nothing changed, Try again sends with the same key', async () => {
    const user = userEvent.setup();
    refundPurchase.mockResolvedValueOnce({ status: 'failed' });
    renderWithI18n(<RevenueView {...revenue()} />);
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Why not');
    await user.click(within(dialog).getByRole('button', { name: 'Refund' }));
    expect(await within(dialog).findByText('It did not go through. Nothing was changed. Try again.')).toBeInTheDocument();
    refundPurchase.mockResolvedValueOnce({ status: 'done', at: '2026-10-05T10:00:00Z', detail: { amount: '$19', credits: 10, balanceAfter: 12, confirmed: true } });
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(refundPurchase).toHaveBeenCalledTimes(2));
    expect(refundPurchase.mock.calls[1]![0].key).toBe(refundPurchase.mock.calls[0]![0].key);
  });

  it('"already done" says when and has only Close', async () => {
    const user = userEvent.setup();
    refundPurchase.mockResolvedValueOnce({ status: 'already', at: '2026-10-03T10:00:00Z' });
    renderWithI18n(<RevenueView {...revenue()} />);
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Refund' }));
    expect(await within(dialog).findByText(/This was already done on .*2026/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
  });

  it('the failed row\'s dialog is "Try the refund again" and the credits leave the balance again', async () => {
    const user = userEvent.setup();
    renderWithI18n(<RevenueView {...revenue()} />);
    await user.click(screen.getByRole('button', { name: 'Try the refund again' }));
    const dialog = await screen.findByRole('dialog', { name: 'Try the refund again?' });
    expect(within(dialog).getByText('Balance after').nextSibling).toHaveTextContent('0'); // 10 now − 10 removed
    expect(within(dialog).getByRole('button', { name: 'Try the refund again' })).toBeInTheDocument();
  });

  it('a purchase the payment gate marked says in words what the owner must look at, next to its status', () => {
    const [first, , , asked] = revenue().purchases;
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...asked!, review: 'refund-review' }, { ...first!, id: 'p6', review: 'disputed' }, { ...first!, id: 'p7', review: 'second-payment' }, first!] })} />);
    const rows = within(screen.getByRole('table', { name: 'Purchases' })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Refund requested');
    expect(rows[0]).toHaveTextContent('A refund at the payment provider does not match one sent from here');
    expect(rows[1]).toHaveTextContent('Disputed at the payment provider. The credits cannot be spent.');
    expect(rows[2]).toHaveTextContent('Paid twice on one checkout. One payment has no credits: refund it at the payment provider.');
    expect(rows[3]).not.toHaveTextContent(/provider/);
  });

  it.each([
    ['en', 'Purchases', 'Partial refund ($1.00) at the payment provider, not from here: the whole payment did not go back. The pack is not frozen and no credits were removed. It waits for your decision: nothing is taken out by itself.'],
    ['tr', 'Satın almalar', 'Ödeme sağlayıcısında kısmi iade ($1.00), buradan değil: ödemenin tamamı geri gitmedi. Paket dondurulmadı, kredi silinmedi. Senin kararını bekliyor: kendiliğinden hiçbir şey düşülmez.'],
  ] as const)('a purchase a part of whose money went back says "partial refund" with the amount, and that it waits for the owner; without an amount the mark reads as before (%s)', (locale, table, text) => {
    const marked = { ...revenue().purchases[0]!, review: 'refund-review' as const };
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...marked, partRefund: '$1.00' }, { ...marked, id: 'p8' }] })} />, locale);
    const rows = within(screen.getByRole('table', { name: table })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(text);
    expect(rows[1]).not.toHaveTextContent('$1.00');
    expect(rows[1]).toHaveTextContent(locale === 'en' ? 'does not match one sent from here' : 'buradan gönderilenle eşleşmiyor');
    expect(rows[0]).not.toHaveTextContent(locale === 'en' ? 'does not match one sent from here' : 'buradan gönderilenle eşleşmiyor');
  });

  it.each([
    ['en', 'Purchases', 'A refund at the payment provider, not from here, whose amount is not known. The pack is not frozen and no credits were removed. Look at it in the provider\'s dashboard: it waits for your decision, and nothing is taken out by itself.'],
    ['tr', 'Satın almalar', 'Ödeme sağlayıcısında buradan yapılmamış bir iade var; tutarı bilinmiyor. Paket dondurulmadı, kredi silinmedi. Sağlayıcının panelinden bak: senin kararını bekliyor, kendiliğinden hiçbir şey düşülmez.'],
  ] as const)('a purchase with a refund whose amount is not known says so and sends the owner to the provider\'s dashboard, also beside a part that is known; without one the mark reads as before (%s)', (locale, table, text) => {
    const marked = { ...revenue().purchases[0]!, review: 'refund-review' as const };
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...marked, refundAmountUnknown: true }, { ...marked, id: 'p8', refundAmountUnknown: true, partRefund: '$1.00' }, { ...marked, id: 'p9', partRefund: '$1.00' }, { ...marked, id: 'p10', review: 'refund-outside', refundAmountUnknown: true }] })} />, locale);
    const rows = within(screen.getByRole('table', { name: table })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(text);
    expect(rows[1]).toHaveTextContent(text);
    expect(rows[2]).not.toHaveTextContent(text);
    expect(rows[2]).toHaveTextContent('$1.00');
    expect(rows[3]).not.toHaveTextContent(text);
  });

  it.each([
    ['en', 'Purchases', 'A refund at the payment provider does not match one sent from here, and the whole payment is not known to have gone back.', /not from here|no credits were removed/],
    ['tr', 'Satın almalar', 'Ödeme sağlayıcısındaki bir iade, buradan gönderilenle eşleşmiyor ve ödemenin tamamının geri gittiği bilinmiyor.', /buradan değil|buradan yapılmamış|kredi silinmedi/],
  ] as const)('a purchase whose refund was sent from here, settled or not, never says "not from here, no credits were removed": its credits are out, so a part or a refund of unknown amount seen at the provider reads as a refund that does not match (%s)', (locale, table, text, wrong) => {
    const sent = { ...revenue().purchases[0]!, status: 'refund-sent' as const, review: 'refund-review' as const };
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...sent, refundAmountUnknown: true }, { ...sent, id: 'p8', partRefund: '$19.00' }, { ...sent, id: 'p9', status: 'refunded', partRefund: '$10.00' }] })} />, locale);
    const rows = within(screen.getByRole('table', { name: table })).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    for (const row of rows) { expect(row).toHaveTextContent(text); expect(row).not.toHaveTextContent(wrong); }
  });

  it.each([
    ['en', 'refund-review', 'Purchases', "A refund at the payment provider does not match one sent from here, and the whole payment is not known to have gone back. Check the provider and settle it there: a pack with spent credits cannot be refunded from here."],
    ['en', 'refund-outside', 'Purchases', "The whole payment was refunded at the payment provider, not from here. The credits cannot be spent. Send the refund here to close it: no money goes back a second time, and the credits left in the pack are removed."],
    ['en', 'disputed', 'Purchases', "Disputed at the payment provider. The credits cannot be spent. Answer the dispute at the provider: when it is won there, the pack is freed by itself. After any other end (lost, accepted, cancelled or expired) the pack stays frozen and cannot be refunded or freed from here."],
    ['tr', 'refund-review', 'Satın almalar', "Ödeme sağlayıcısındaki bir iade, buradan gönderilenle eşleşmiyor ve ödemenin tamamının geri gittiği bilinmiyor. Sağlayıcıya bak ve orada kapat: kredisi harcanmış paket buradan iade edilemez."],
    ['tr', 'refund-outside', 'Satın almalar', "Ödemenin tamamı ödeme sağlayıcısında iade edilmiş, buradan değil. Krediler harcanamaz. Kapatmak için iadeyi buradan gönder: para ikinci kez geri gitmez, pakette kalan krediler silinir."],
    ['tr', 'disputed', 'Satın almalar', "Ödeme sağlayıcısında itiraz var. Krediler harcanamaz. İtirazı sağlayıcıda yanıtla: orada kazanılırsa paket kendiliğinden serbest kalır. Başka her sonuçta (kaybedildi, kabul edildi, iptal edildi ya da süresi doldu) paket donuk kalır; buradan iade edilemez ve serbest bırakılamaz."],
  ] as const)('a mark that holds a pack tells the owner what to do about it, and what cannot be done from here (%s, %s)', (locale, review, table, text) => {
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...revenue().purchases[3]!, review }] })} />, locale);
    expect(within(screen.getByRole('table', { name: table })).getAllByRole('row')[1]).toHaveTextContent(text);
  });

  it.each([
    ['en', 'refund-conflict', 'Purchases', 'The payment provider answered that this payment has a refund already, but lists none that went through. No credits were given back. Check the provider: a refund made there closes this one.'],
    ['tr', 'refund-conflict', 'Satın almalar', 'Ödeme sağlayıcısı bu ödemenin zaten bir iadesi olduğunu söyledi, ama tamamlanmış bir iade listelemiyor. Kredi geri verilmedi. Sağlayıcıya bak: orada yapılan iade bunu kapatır.'],
    ['en', 'refund-overdue', 'Purchases', 'Sent more than three days ago, and the payment provider has not said how it ended. It is no longer asked about, and no credits were given back. Check the provider: its notice of this refund, sent again from there, settles it.'],
    ['tr', 'refund-overdue', 'Satın almalar', 'Üç günden uzun süre önce gönderildi ve ödeme sağlayıcısı nasıl sonuçlandığını bildirmedi. Artık sorulmuyor, kredi de geri verilmedi. Sağlayıcıya bak: bu iadenin bildirimi oradan yeniden gönderilince sonuçlanır.'],
    ['en', 'refund-unknown', 'Purchases', 'Result awaited: the payment provider has not confirmed that it took this refund. It is being asked; if no money went back, the credits come back and the refund can be sent again.'],
    ['tr', 'refund-unknown', 'Satın almalar', 'Sonuç bekleniyor: ödeme sağlayıcısı bu iadeyi aldığını doğrulamadı. Sağlayıcıya soruluyor; para geri gitmediyse krediler geri döner ve iade tekrar gönderilebilir.'],
    ['en', 'refund-not-found', 'Purchases', 'The payment provider lists no refund of this purchase that went through. No money went back, and the credits are back in the balance. Try the refund again.'],
    ['tr', 'refund-not-found', 'Satın almalar', 'Ödeme sağlayıcısı bu satın alma için tamamlanmış bir iade listelemiyor. Para geri gitmedi, krediler bakiyeye geri döndü. İadeyi tekrar dene.'],
  ] as const)('a refund that is not settled says next to its status what is open about it (%s, %s)', (locale, review, table, text) => {
    const sent = { ...revenue().purchases[3]!, status: review === 'refund-not-found' ? 'refund-failed' as const : 'refund-sent' as const };
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...sent, review }] })} />, locale);
    expect(within(screen.getByRole('table', { name: table })).getAllByRole('row')[1]).toHaveTextContent(text);
  });

  it('payments that were not credited have a table of their own that says why, and the page has no such table when there is none', () => {
    const { unmount } = renderWithI18n(<RevenueView {...revenue()} />);
    expect(screen.queryByRole('table', { name: 'Payments not credited' })).not.toBeInTheDocument();
    unmount();
    renderWithI18n(<RevenueView {...revenue({ uncredited: [
      { id: 'c-1', at: '2026-10-06T10:00:00Z', userId: 'usr-demo', email: 'demo@viralclone.app', packName: 'Starter', amount: '$19', reason: 'amount' },
      { id: 'c-2', at: '2026-10-07T10:00:00Z', userId: 'usr-gone', email: null, packName: 'Standard', amount: '$49', reason: 'no-account' },
    ] })} />);
    const rows = within(screen.getByRole('table', { name: 'Payments not credited' })).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('demo@viralclone.app');
    expect(rows[0]).toHaveTextContent('$19');
    expect(rows[0]).toHaveTextContent('The amount paid is not the price of the pack. No credits were written: look at the payment at the provider.');
    expect(rows[1]).toHaveTextContent('Deleted account');
    expect(rows[1]).toHaveTextContent('The account of this payment no longer exists. No credits were written: refund it at the payment provider.');
  });

  it.each([
    ['en', 'Payments not credited', 'The provider\'s answer about this checkout names a payment that is not tied to it. No credits were written: look at the payment at the provider.',
      'The provider could not be asked about this checkout for three days after it ran out, so it is not known whether it was paid. No credits were written: look it up at the provider.'],
    ['tr', 'Kredisi yazılmayan ödemeler', 'Sağlayıcının bu ödeme oturumu için verdiği cevap, ona bağlı olmayan bir ödemeyi gösteriyor. Kredi yazılmadı: ödemeye sağlayıcıda bak.',
      'Bu ödeme oturumu sona erdikten sonra üç gün boyunca sağlayıcıya sorulamadı; ödenip ödenmediği bilinmiyor. Kredi yazılmadı: sağlayıcıda ara.'],
  ] as const)('a checkout the server\'s own read of the provider could not settle is in that table with its reason (%s)', (locale, table, binding, gaveUp) => {
    renderWithI18n(<RevenueView {...revenue({ uncredited: [
      { id: 'c-1', at: '2026-10-06T10:00:00Z', userId: 'usr-demo', email: 'demo@viralclone.app', packName: 'Starter', amount: '$19', reason: 'binding' },
      { id: 'c-2', at: '2026-10-07T10:00:00Z', userId: 'usr-demo', email: 'demo@viralclone.app', packName: 'Standard', amount: '$49', reason: 'gave-up' },
    ] })} />, locale);
    const rows = within(screen.getByRole('table', { name: table })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(binding);
    expect(rows[1]).toHaveTextContent(gaveUp);
  });

  it('shows the empty state for a period without purchases', () => {
    renderWithI18n(<RevenueView {...revenue({ purchases: [] })} />);
    expect(screen.getByText('No purchases in this period.')).toBeInTheDocument();
  });
});

const credits = (over: Partial<CreditsViewProps> = {}): CreditsViewProps => ({
  period: '30d', type: undefined,
  tiles: { sold: 140, spent: 61, unspent: 96, free: 4, admin: 5, refunded: 10 },
  spending: {
    byQuality: [{ label: 'fast', jobs: 3, credits: 8, cost: null }, { label: 'best', jobs: 1, credits: 5, cost: null }],
    byFormat: [{ label: 'no-talking', jobs: 4, credits: 13, cost: null }, { label: 'talking', jobs: 0, credits: 0, cost: null }],
  },
  purchases: { p1: { number: 'VC-0001', invoiceId: 'inv-1' } },
  ledger: [
    { id: 'l1', userId: 'usr-demo', email: 'demo@viralclone.app', at: '2026-10-01T10:00:00Z', type: 'purchase', change: 30, note: 'Standard', balanceAfter: 42, by: { kind: 'customer' }, reason: null, relatedJobId: null, relatedPurchaseId: 'p1' },
    { id: 'l2', userId: 'usr-demo', email: 'demo@viralclone.app', at: '2026-10-02T10:00:00Z', type: 'admin', change: 5, note: 'Late delivery', balanceAfter: 47, by: { kind: 'admin', id: 'usr-admin', name: 'Admin Ada' }, reason: 'Late delivery', relatedJobId: null, relatedPurchaseId: null },
    { id: 'l3', userId: 'usr-demo', email: 'demo@viralclone.app', at: '2026-10-03T10:00:00Z', type: 'refund', change: -10, note: 'Starter', balanceAfter: 37, by: { kind: 'admin', id: 'usr-admin', name: 'Admin Ada' }, reason: 'Within 14 days', relatedJobId: null, relatedPurchaseId: 'p1' },
  ],
  ...over,
});

describe('a deleted account in the tables', () => {
  it('Purchases: "Deleted account" instead of an id, and no link to a user page that does not exist', () => {
    const [first] = revenue().purchases;
    renderWithI18n(<RevenueView {...revenue({ purchases: [{ ...first!, userId: '0b7e0d5c-5d0a-4e6b-9a51-4f0f4f2f9b11', email: null }] })} />);
    const row = within(screen.getByRole('table', { name: 'Purchases' })).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('Deleted account');
    expect(row).not.toHaveTextContent('0b7e0d5c');
    expect(row.querySelector('a[href^="/admin/users/"]')).toBeNull();
  });
  it('Credit ledger: the same', () => {
    const [first] = credits().ledger;
    renderWithI18n(<CreditsView {...credits({ ledger: [{ ...first!, userId: '0b7e0d5c-5d0a-4e6b-9a51-4f0f4f2f9b11', email: null }] })} />);
    const row = within(screen.getByRole('table', { name: 'Credit ledger' })).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('Deleted account');
    expect(row).not.toHaveTextContent('0b7e0d5c');
    expect(row.querySelector('a[href^="/admin/users/"]')).toBeNull();
  });
});

describe('CreditsView', () => {
  it('has real credit tiles', () => {
    renderWithI18n(<CreditsView {...credits()} />);
    const tile = (l: string) => screen.getAllByText(l, { selector: 'span' })[0]!.parentElement!;
    expect(tile('Credits sold')).toHaveTextContent('140');
    expect(tile('Unspent balance')).toHaveTextContent('96');
    expect(tile('Free videos given')).toHaveTextContent('4');
    expect(tile('Added by admin')).toHaveTextContent('5');
    expect(tile('Refunded')).toHaveTextContent('10');
  });

  it('spending tables translate the quality and format codes; cost is a placeholder', () => {
    renderWithI18n(<CreditsView {...credits()} />);
    const quality = screen.getByRole('table', { name: 'Spending by quality' });
    expect(within(quality).getByText('Fast')).toBeInTheDocument();
    expect(within(quality).getByText('Best')).toBeInTheDocument();
    expect(within(quality).getAllByText('—')).toHaveLength(2);
    const format = screen.getByRole('table', { name: 'Spending by format' });
    expect(within(format).getByText('No talking')).toBeInTheDocument();
    expect(within(format).getByText('Talking')).toBeInTheDocument();
  });

  it('ledger: one table with By, Related and Reason; a job and a purchase link to their page; new type Returned', () => {
    const base = credits();
    const back = { ...base.ledger[0]!, id: 'l9', type: 'returned' as const, change: 5, by: { kind: 'system' as const }, relatedJobId: 'job-7', relatedPurchaseId: null };
    renderWithI18n(<CreditsView {...credits({ ledger: [...base.ledger, back] })} />);
    const table = screen.getByRole('table', { name: 'Credit ledger' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'User', 'Type', 'Change', 'By', 'Related', 'Reason', 'Balance after']);
    expect(within(table).getAllByRole('link', { name: 'Purchase VC-0001' })[0]).toHaveAttribute('href', '/invoices/inv-1');
    expect(within(table).getByRole('link', { name: 'Job job-7' })).toHaveAttribute('href', '/admin/jobs?job=job-7');
    expect(within(table).getByText('Returned')).toBeInTheDocument();
    expect(within(table).getByText('System')).toBeInTheDocument();
    expect(within(table).getAllByText('Admin Ada')).toHaveLength(2);
    expect(within(table).getByText('Within 14 days')).toBeInTheDocument();
    expect(within(table).getAllByText(/10:00/).length).toBeGreaterThan(0);
  });

  it('ledger: a purchase links to the provider\'s own invoice where the payment has one, in a new tab that is told nothing of this page', () => {
    const dodo = 'https://test.dodopayments.com/invoices/payments/pay_A';
    renderWithI18n(<CreditsView {...credits({ purchases: { p1: { number: 'VC-0001', invoiceId: 'inv-1', invoiceUrl: dodo } } })} />);
    const real = within(screen.getByRole('table', { name: 'Credit ledger' })).getAllByRole('link', { name: 'Purchase VC-0001' })[0]!;
    expect(real).toHaveAttribute('href', dodo);
    expect(real).toHaveAttribute('target', '_blank');
    expect(real).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('ledger: type translated, signed changes, user links, the type filter as links keeping the period (Returned and Admin included)', () => {
    renderWithI18n(<CreditsView {...credits({ period: '7d', type: 'admin' })} />);
    const table = screen.getByRole('table', { name: 'Credit ledger' });
    const admin = within(table).getByRole('row', { name: /Late delivery/ });
    expect(within(admin).getByText('Admin')).toBeInTheDocument();
    expect(within(admin).getByText('+5')).toBeInTheDocument();
    expect(within(table).getByText('−10')).toBeInTheDocument();
    expect(within(admin).getByRole('link', { name: 'demo@viralclone.app' })).toHaveAttribute('href', '/admin/users/usr-demo');
    const filter = screen.getByRole('group', { name: 'Type' });
    expect(within(filter).getAllByRole('link').map((l) => l.textContent)).toEqual(['All', 'Purchases', 'Generations', 'Free videos', 'Returned', 'Refunds', 'Admin']);
    expect(within(filter).getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page');
    expect(within(filter).getByRole('link', { name: 'Returned' })).toHaveAttribute('href', '/admin/revenue/credits?period=7d&type=returned');
    expect(within(filter).getByRole('link', { name: 'All' })).toHaveAttribute('href', '/admin/revenue/credits?period=7d');
  });

  it('the credits tab is current', () => {
    renderWithI18n(<CreditsView {...credits()} />);
    expect(within(screen.getByRole('navigation', { name: 'Revenue sections' })).getByRole('link', { name: 'Credits' })).toHaveAttribute('aria-current', 'page');
  });
});
