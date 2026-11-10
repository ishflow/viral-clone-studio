import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LedgerEntry } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { readDraft, writeDraft } from '@/shared/lib/session-draft';
import { CreditActivity } from './CreditActivity';
import { DeleteAccount } from './DeleteAccount';

vi.mock('./actions', () => ({ deleteAccount: vi.fn(async () => ({ status: 'idle' })), saveProfile: vi.fn() }));
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const entry = (o: Partial<LedgerEntry>): LedgerEntry => ({ id: 'e', userId: 'u', at: '2026-03-04T10:00:00Z', type: 'generation', change: -2, note: 'Layering', balanceAfter: 1, by: { kind: 'customer' }, reason: null, relatedJobId: null, relatedPurchaseId: null, ...o });

describe('CreditActivity', () => {
  it('lets a long name (a pasted link used as the template title) break instead of running into the amount', () => {
    renderWithI18n(<CreditActivity entries={[entry({ id: 'x', type: 'generation', change: -1, note: 'https://www.youtube.com/shorts/AAAAAAAAAAAAAAAAAAAAAA' })]} />);
    expect(screen.getByText('https://www.youtube.com/shorts/AAAAAAAAAAAAAAAAAAAAAA').className).toContain('overflow-wrap:anywhere');
  });

  it('shows sign, type and name per row', () => {
    renderWithI18n(
      <CreditActivity
        entries={[
          entry({ id: '1', type: 'generation', change: -2, note: 'Fragrance layering recipe' }),
          entry({ id: '2', type: 'purchase', change: 30, note: 'Standard' }),
          entry({ id: '3', type: 'refund', change: 2, note: 'Fragrance layering recipe' }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem") as [HTMLElement, HTMLElement, HTMLElement];
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('−2')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/^Generation · /)).toBeInTheDocument();
    expect(within(rows[1]).getByText('+30')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Standard pack')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/^Purchase · /)).toBeInTheDocument();
    expect(within(rows[2]).getByText(/^Refund · /)).toBeInTheDocument();
  });
  it('says so when there is no activity', () => {
    renderWithI18n(<CreditActivity entries={[]} />);
    expect(screen.getByText('No credit activity yet.')).toBeInTheDocument();
  });
});

describe('DeleteAccount', () => {
  it('keeps the delete button disabled until DELETE is typed', async () => {
    renderWithI18n(<DeleteAccount balanceLabel="12 credits" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'delete');
    expect(confirm).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText('Type DELETE to confirm'));
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect(confirm).toBeEnabled();
    expect(within(dialog).getByText('12 credits, lost')).toBeInTheDocument();
  });
  it('deleting the account also clears the forms this tab kept', async () => {
    writeDraft('vc:draft:add-video:usr-demo', { link: 'https://example.com/v' });
    renderWithI18n(<DeleteAccount balanceLabel="12 credits" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    expect(readDraft('vc:draft:add-video:usr-demo')).toBeNull();
  });
  it('closes with Keep my account', async () => {
    renderWithI18n(<DeleteAccount balanceLabel="12 credits" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep my account' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
