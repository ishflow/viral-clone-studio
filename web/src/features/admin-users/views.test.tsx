import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const addCredits = vi.fn();
const sendPasswordReset = vi.fn();
const setAccess = vi.fn();
vi.mock('./actions', () => ({
  addCredits: (...a: unknown[]) => addCredits(...a),
  sendPasswordReset: (...a: unknown[]) => sendPasswordReset(...a),
  setAccess: (...a: unknown[]) => setAccess(...a),
}));

import { UserDetailView, type UserDetailProps } from './UserDetailView';
import { UsersView, type UserListRow } from './UsersView';

const row = (over: Partial<UserListRow> = {}): UserListRow => ({
  id: 'usr-demo', email: 'demo@viralclone.app', name: 'Demo User', joinedAt: '2026-09-10T10:00:00Z', lastActiveAt: '2026-10-04T10:00:00Z',
  verified: true, blocked: false, balance: 12, paidTotal: null, creditsSpent: 8, videos: 3, ...over,
});

afterEach(cleanup);
beforeEach(() => {
  addCredits.mockReset();
  sendPasswordReset.mockReset();
  setAccess.mockReset();
});

describe('UsersView', () => {
  it('lists the users with real numbers, money as the board placeholder and an Open link to the detail page', () => {
    renderWithI18n(<UsersView rows={[row(), row({ id: 'usr-b', email: 'b@example.com', blocked: true, verified: false })]} filter="all" q="" total={2} />);
    const table = screen.getByRole('table', { name: 'Users' });
    const demo = within(table).getByRole('row', { name: /demo@viralclone.app/ });
    expect(within(demo).getByText('—')).toBeInTheDocument();
    expect(within(demo).getByText('12')).toBeInTheDocument();
    expect(within(demo).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/admin/users/usr-demo');
    const blocked = within(table).getByRole('row', { name: /b@example.com/ });
    expect(within(blocked).getByText('Blocked')).toBeInTheDocument();
    expect(within(blocked).getByText('Not verified')).toBeInTheDocument();
  });

  it('the filter is a set of links that keep the search, the current one is marked', () => {
    renderWithI18n(<UsersView rows={[row()]} filter="paying" q="ann" total={1} />);
    const group = screen.getByRole('group', { name: 'Filter' });
    expect(within(group).getByRole('link', { name: 'Paying' })).toHaveAttribute('aria-current', 'page');
    expect(within(group).getByRole('link', { name: 'Blocked' })).toHaveAttribute('href', '/admin/users?filter=blocked&q=ann');
    expect(within(group).getByRole('link', { name: 'All' })).toHaveAttribute('href', '/admin/users?q=ann');
  });

  it('search is a GET form that keeps the filter', () => {
    renderWithI18n(<UsersView rows={[row()]} filter="blocked" q="ann" total={1} />);
    const input = screen.getByRole('searchbox', { name: 'Search users' });
    expect(input).toHaveValue('ann');
    const form = input.closest('form')!;
    expect(form).toHaveAttribute('method', 'get');
    expect(form.querySelector('input[name="filter"]')).toHaveValue('blocked');
  });

  it('Export CSV is a real download link with the current filter and search', () => {
    renderWithI18n(<UsersView rows={[row()]} filter="paying" q="ann" total={1} />);
    const link = screen.getByRole('link', { name: 'Export CSV' });
    expect(link).toHaveAttribute('href', '/admin/users/export?filter=paying&q=ann');
    expect(link).toHaveAttribute('download');
  });

  it('shows the empty state when nothing matches, with a way back', () => {
    renderWithI18n(<UsersView rows={[]} filter="blocked" q="zzz" total={0} />);
    expect(screen.getByText('No users match your search or filter.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear search and filter' })).toHaveAttribute('href', '/admin/users');
  });
});

const detail = (over: Partial<UserDetailProps> = {}): UserDetailProps => ({
  user: { id: 'usr-demo', email: 'demo@viralclone.app', name: 'Demo User', joinedAt: '2026-09-10T10:00:00Z', lastActiveAt: '2026-10-04T10:00:00Z', verified: true, blocked: false, block: null },
  balance: 12, paidTotal: null, creditsBought: 40, creditsSpent: 28, videos: 4,
  purchases: [
    { id: 'p1', at: '2026-09-11T10:00:00Z', packName: 'Standard', credits: 30, amount: null, status: 'paid', invoiceId: 'inv-1', invoiceNumber: 'VC-0001' },
    { id: 'p2', at: '2026-09-12T10:00:00Z', packName: 'Studio', credits: 100, amount: null, status: 'not-completed', invoiceId: null, invoiceNumber: null },
  ],
  jobs: [{ id: 'job-1', startedAt: '2026-09-13T10:00:00Z', templateTitle: 'Dupe comparison', format: 'no-talking', quality: 'best', language: 'en', credits: 5, status: 'stopped' }],
  ledger: [
    { id: 'l1', userId: 'usr-demo', at: '2026-09-14T10:00:00Z', type: 'admin', change: 5, note: 'Late delivery', balanceAfter: 17, by: { kind: 'customer' }, reason: null, relatedJobId: null, relatedPurchaseId: null },
    { id: 'l2', userId: 'usr-demo', at: '2026-09-15T10:00:00Z', type: 'generation', change: -5, note: 'Dupe comparison', balanceAfter: 12, by: { kind: 'customer' }, reason: null, relatedJobId: null, relatedPurchaseId: null },
    { id: 'l3', userId: 'usr-demo', at: '2026-09-16T10:00:00Z', type: 'free-video', change: 0, note: 'Eye close-up', balanceAfter: 12, by: { kind: 'customer' }, reason: null, relatedJobId: null, relatedPurchaseId: null },
  ],
  isSelf: false,
  ...over,
});

describe('UserDetailView', () => {
  it('shows the tiles, with money as a placeholder and the status tag', () => {
    renderWithI18n(<UserDetailView {...detail()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'demo@viralclone.app' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    const tile = (label: string) => screen.getByText(label).parentElement!;
    expect(tile('Balance')).toHaveTextContent('12');
    expect(tile('Paid in total')).toHaveTextContent('—');
    expect(tile('Credits bought')).toHaveTextContent('40');
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/admin/users');
  });

  it('purchases: invoice link goes to /invoices/<id>; no invoice says so; statuses are translated', () => {
    renderWithI18n(<UserDetailView {...detail()} />);
    const table = screen.getByRole('table', { name: 'Purchases' });
    expect(within(table).getByRole('link', { name: 'View' })).toHaveAttribute('href', '/invoices/inv-1');
    expect(within(table).queryByRole('link', { name: 'PDF' })).toBeNull();
    expect(within(table).getByText('VC-0001')).toBeInTheDocument();
    expect(within(table).getByText('No invoice')).toBeInTheDocument();
    expect(within(table).getByText('Paid')).toBeInTheDocument();
    expect(within(table).getByText('Not completed')).toBeInTheDocument();
    // As on the board (and on the Revenue page): a payment that was not completed is a warning, not a neutral state.
    expect(within(table).getByText('Not completed').className).toContain('text-warn');
    expect(within(table).getByText('Standard pack')).toBeInTheDocument();
  });

  it('the invoice link of a purchase is "PDF" and goes to the provider\'s own invoice where the payment has one, in a new tab that is told nothing of this page; the site\'s own page is "View", in both languages', () => {
    const dodo = 'https://test.dodopayments.com/invoices/payments/pay_A';
    const [first] = detail().purchases;
    const purchases = [{ ...first!, invoiceUrl: dodo }, { ...first!, id: 'p3', invoiceId: 'inv-3', invoiceNumber: 'VC-0003' }];
    for (const [locale, name, view] of [['en', 'Purchases', 'View'], ['tr', 'Satın almalar', 'Görüntüle']] as const) {
      const { unmount } = renderWithI18n(<UserDetailView {...detail({ purchases })} />, locale);
      const table = screen.getByRole('table', { name });
      const real = within(table).getByRole('link', { name: 'PDF' });
      expect(real).toHaveAttribute('href', dodo);
      expect(real).toHaveAttribute('target', '_blank');
      expect(real).toHaveAttribute('rel', 'noopener noreferrer');
      expect(within(table).getByRole('link', { name: view })).toHaveAttribute('href', '/invoices/inv-3');
      unmount();
    }
  });

  it('credit history: a purchase links to the provider\'s own invoice where the payment has one, and to the site\'s page otherwise', () => {
    const dodo = 'https://test.dodopayments.com/invoices/payments/pay_A';
    const [first] = detail().purchases;
    const entry = { id: 'l4', userId: 'usr-demo', at: '2026-09-11T10:00:00Z', type: 'purchase' as const, change: 30, note: 'Standard', balanceAfter: 30, by: { kind: 'customer' as const }, reason: null, relatedJobId: null, relatedPurchaseId: 'p1' };
    renderWithI18n(<UserDetailView {...detail({
      purchases: [{ ...first!, invoiceUrl: dodo }, { ...first!, id: 'p3', invoiceId: 'inv-3', invoiceNumber: 'VC-0003' }],
      ledger: [entry, { ...entry, id: 'l5', relatedPurchaseId: 'p3' }],
    })} />);
    const table = screen.getByRole('table', { name: 'Credit history' });
    const real = within(table).getByRole('link', { name: 'Purchase VC-0001' });
    expect(real).toHaveAttribute('href', dodo);
    expect(real).toHaveAttribute('target', '_blank');
    expect(real).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(table).getByRole('link', { name: 'Purchase VC-0003' })).toHaveAttribute('href', '/invoices/inv-3');
  });

  it('jobs link to the jobs page; codes are translated', () => {
    renderWithI18n(<UserDetailView {...detail()} />);
    const table = screen.getByRole('table', { name: 'Jobs' });
    expect(within(table).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/admin/jobs?job=job-1#job-detail');
    expect(within(table).getByText('No talking')).toBeInTheDocument();
    expect(within(table).getByText('Best')).toBeInTheDocument();
    expect(within(table).getByText('English')).toBeInTheDocument();
    expect(within(table).getByText('Stopped')).toBeInTheDocument();
  });

  it('credit history: date and time, type, who did it (system / customer / admin name), what it belongs to (job / purchase), the reason', () => {
    renderWithI18n(
      <UserDetailView
        {...detail({
          ledger: [
            { id: 'l1', userId: 'usr-demo', at: '2026-09-14T10:05:00Z', type: 'admin', change: 5, note: 'Late delivery', balanceAfter: 17, by: { kind: 'admin', id: 'usr-admin', name: 'Admin Ada' }, reason: 'Late delivery', relatedJobId: null, relatedPurchaseId: null },
            { id: 'l2', userId: 'usr-demo', at: '2026-09-15T10:00:00Z', type: 'generation', change: -5, note: 'Dupe comparison', balanceAfter: 12, by: { kind: 'customer' }, reason: null, relatedJobId: 'job-1', relatedPurchaseId: null },
            { id: 'l3', userId: 'usr-demo', at: '2026-09-16T10:00:00Z', type: 'returned', change: 5, note: 'Dupe comparison', balanceAfter: 17, by: { kind: 'system' }, reason: null, relatedJobId: 'job-1', relatedPurchaseId: null },
            { id: 'l4', userId: 'usr-demo', at: '2026-09-11T10:00:00Z', type: 'purchase', change: 30, note: 'Standard', balanceAfter: 30, by: { kind: 'customer' }, reason: null, relatedJobId: null, relatedPurchaseId: 'p1' },
          ],
        })}
      />,
    );
    const table = screen.getByRole('table', { name: 'Credit history' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Type', 'Change', 'By', 'Related', 'Reason', 'Balance after']);
    const admin = within(table).getByRole('row', { name: /Late delivery/ });
    expect(within(admin).getByText('Admin')).toBeInTheDocument();
    expect(within(admin).getByText('Admin Ada')).toBeInTheDocument();
    expect(within(admin).getByText(/10:05/)).toBeInTheDocument();
    expect(within(admin).getByText('+5')).toBeInTheDocument();
    expect(within(table).getByText('−5')).toBeInTheDocument();
    expect(within(table).getByText('Returned')).toBeInTheDocument();
    expect(within(table).getByText('System')).toBeInTheDocument();
    expect(within(table).getAllByText('Customer').length).toBe(2);
    expect(within(table).getAllByRole('link', { name: 'Job job-1' })[0]).toHaveAttribute('href', '/admin/jobs?job=job-1');
    expect(within(table).getByRole('link', { name: 'Purchase VC-0001' })).toHaveAttribute('href', '/invoices/inv-1');
  });

  it('purchase and job statuses include the new ones (refund requested / sent / failed, in queue, closed)', () => {
    renderWithI18n(
      <UserDetailView
        {...detail({
          purchases: (['refund-requested', 'refund-sent', 'refund-failed', 'refunded'] as const).map((status, i) => ({ id: `p${i}`, at: '2026-09-11T10:00:00Z', packName: 'Starter', credits: 10, amount: null, status, invoiceId: null, invoiceNumber: null })),
          jobs: (['queued', 'closed'] as const).map((status, i) => ({ id: `j${i}`, startedAt: '2026-09-13T10:00:00Z', templateTitle: 'T', format: null, quality: 'fast' as const, language: 'en', credits: 2, status })),
        })}
      />,
    );
    const buys = screen.getByRole('table', { name: 'Purchases' });
    for (const label of ['Refund requested', 'Refund sent', 'Refund failed', 'Refunded']) expect(within(buys).getByText(label)).toBeInTheDocument();
    const jobs = screen.getByRole('table', { name: 'Jobs' });
    expect(within(jobs).getByText('In queue')).toBeInTheDocument();
    expect(within(jobs).getByText('Closed')).toBeInTheDocument();
  });

  it('Add credits: an invalid number shows the field error and opens nothing; a good one opens the confirmation with the balances', async () => {
    const user = userEvent.setup();
    renderWithI18n(<UserDetailView {...detail()} />);
    const open = screen.getByRole('button', { name: 'Add credits' });
    expect(open.className).toMatch(/border-edge-strong/);
    await user.click(open);
    expect(await screen.findByText('Enter a whole number from 1 to 10,000.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.type(screen.getByLabelText('Credits to add'), '5');
    await user.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Add credits' });
    expect(within(dialog).getByText('Balance now').nextSibling).toHaveTextContent('12');
    expect(within(dialog).getByText('Credits to add').nextSibling).toHaveTextContent('5');
    expect(within(dialog).getByText('Balance after').nextSibling).toHaveTextContent('17');
    expect(within(dialog).getByText('This action is recorded with your name and the reason.')).toBeInTheDocument();
    expect(addCredits).not.toHaveBeenCalled();
  });

  it('Add credits: no reason, nothing is sent; with one it is sent once with the credits and a key, and the dialog shows the result', async () => {
    const user = userEvent.setup();
    addCredits.mockResolvedValue({ status: 'done', at: '2026-10-05T10:00:00Z', detail: { credits: 5, balanceAfter: 17 } });
    renderWithI18n(<UserDetailView {...detail()} />);
    await user.type(screen.getByLabelText('Credits to add'), '5');
    await user.click(screen.getByRole('button', { name: 'Add credits' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add credits' });
    await user.click(within(dialog).getByRole('button', { name: 'Add credits' }));
    expect(await within(dialog).findAllByText('A reason is required. It is shown in the credit history.')).not.toHaveLength(0);
    expect(addCredits).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Reason'), 'Late delivery');
    await user.click(within(dialog).getByRole('button', { name: 'Add credits' }));
    await waitFor(() => expect(addCredits).toHaveBeenCalledTimes(1));
    expect(addCredits.mock.calls[0]![0]).toMatchObject({ userId: 'usr-demo', credits: 5, reason: 'Late delivery' });
    expect(typeof addCredits.mock.calls[0]![0].key).toBe('string');
    const done = await screen.findByRole('dialog', { name: 'Done' });
    expect(within(done).getByText('Balance after').nextSibling).toHaveTextContent('17');
  });

  it('Send password reset email shows "Reset email sent"', async () => {
    const user = userEvent.setup();
    sendPasswordReset.mockResolvedValue({ status: 'sent' });
    renderWithI18n(<UserDetailView {...detail()} />);
    await user.click(screen.getByRole('button', { name: 'Send password reset email' }));
    expect(await screen.findByText('Reset email sent')).toBeInTheDocument();
  });

  it('Block user asks first with the facts, a required reason and the note: nothing is sent until the dialog is confirmed, Escape cancels', async () => {
    const user = userEvent.setup();
    setAccess.mockResolvedValue({ status: 'done', at: '2026-10-05T10:00:00Z', detail: { blocked: true } });
    renderWithI18n(<UserDetailView {...detail()} />);
    const block = screen.getByRole('button', { name: 'Block user' });
    expect(block.className).toMatch(/border-warn/);
    await user.click(block);
    const dialog = await screen.findByRole('dialog', { name: 'Block this user?' });
    expect(within(dialog).getByText('Credits').nextSibling).toHaveTextContent('12 credits, kept');
    expect(within(dialog).getByText('Videos').nextSibling).toHaveTextContent('4 videos, kept');
    expect(within(dialog).getByText(/You can unblock them here at any time/)).toBeInTheDocument();
    expect(within(dialog).getByText('This action is recorded with your name and the reason.')).toBeInTheDocument();
    expect(setAccess).not.toHaveBeenCalled();
    within(dialog).getByRole('button', { name: 'Cancel' }).focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setAccess).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Block user' }));
    const again = await screen.findByRole('dialog');
    const confirm = within(again).getByRole('button', { name: 'Block user' });
    expect(confirm.className).toMatch(/border-warn/);
    await user.click(confirm);
    expect(setAccess).not.toHaveBeenCalled(); // no reason yet
    await user.type(within(again).getByLabelText('Reason'), 'Chargeback');
    await user.click(confirm);
    await waitFor(() => expect(setAccess).toHaveBeenCalledTimes(1));
    expect(setAccess).toHaveBeenCalledWith({ userId: 'usr-demo', blocked: true, reason: 'Chargeback' });
  });

  it('a blocked user shows the block card (when and why) and Unblock user, which asks too: the date and the reason of the block, a reason of its own', async () => {
    const user = userEvent.setup();
    setAccess.mockResolvedValue({ status: 'done', at: '2026-10-05T10:00:00Z', detail: { blocked: false } });
    renderWithI18n(<UserDetailView {...detail({ user: { ...detail().user, blocked: true, block: { at: '2026-10-01T10:00:00Z', reason: 'Chargeback' } } })} />);
    const card = document.querySelector('[data-blocked-card]') as HTMLElement;
    expect(within(card).getByText('Blocked')).toBeInTheDocument();
    expect(within(card).getByText(/Blocked on/)).toBeInTheDocument();
    expect(within(card).getByText('Reason: Chargeback')).toBeInTheDocument();
    const unblock = screen.getByRole('button', { name: 'Unblock user' });
    expect(unblock.className).not.toMatch(/border-warn/);
    await user.click(unblock);
    expect(setAccess).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Unblock this user?' });
    expect(within(dialog).getByText('Reason for the block').nextSibling).toHaveTextContent('Chargeback');
    expect(within(dialog).getByText('The user can log in again. Their credits and videos are as they were.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Reason'), 'Resolved');
    await user.click(within(dialog).getByRole('button', { name: 'Unblock user' }));
    await waitFor(() => expect(setAccess).toHaveBeenCalledWith({ userId: 'usr-demo', blocked: false, reason: 'Resolved' }));
  });

  it('on the admin\'s own page there is no Block button', () => {
    renderWithI18n(<UserDetailView {...detail({ isSelf: true })} />);
    expect(screen.queryByRole('button', { name: 'Block user' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send password reset email' })).toBeInTheDocument();
  });
});
