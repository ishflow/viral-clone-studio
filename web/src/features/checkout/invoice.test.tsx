import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { InvoiceSheet } from './InvoiceSheet';

afterEach(cleanup);

const invoice = { id: 'inv-1', number: 'VC-000007', userId: 'u', purchaseId: 'p', date: '2026-03-04T10:00:00Z', packName: 'Standard', credits: 30, amount: null };

describe('InvoiceSheet', () => {
  it('shows the real values and the business details', () => {
    renderWithI18n(<InvoiceSheet invoice={invoice} customerEmail="demo@viralclone.app" />);
    expect(screen.getByText('VC-000007')).toBeInTheDocument();
    expect(screen.getByText('Standard pack')).toBeInTheDocument();
    expect(screen.getByText('30 credits for Viral Clone')).toBeInTheDocument();
    expect(screen.getByText('demo@viralclone.app')).toBeInTheDocument();
    const seller = screen.getByRole('heading', { name: 'From' }).nextElementSibling as HTMLElement;
    expect(seller).toHaveTextContent('ishflow');
    expect(seller).toHaveTextContent('123 Example St, City, Country');
    expect(seller).toHaveTextContent('owner@example.com');
    expect(document.body.textContent).not.toMatch(/\[(COMPANY NAME|ADDRESS|TAX ID|SUPPORT EMAIL|CUSTOMER NAME|BILLING ADDRESS|PAYMENT METHOD)\]/);
  });
  it('writes no tax number and no tax line: the seller owes none', () => {
    renderWithI18n(<InvoiceSheet invoice={{ ...invoice, amount: '$54.00' }} customerEmail="a@b.co" />);
    expect(screen.queryByText(/tax/i)).toBeNull();
    expect(screen.queryByText(/vergi/i)).toBeNull();
  });
  it('a payment the provider added tax to has a tax line between the subtotal and the total that was charged, in both languages', () => {
    const taxed = { ...invoice, amount: '$54.00', taxCents: 1026, totalCents: 6426 };
    const { unmount } = renderWithI18n(<InvoiceSheet invoice={taxed} customerEmail="a@b.co" />);
    const totals = screen.getByRole('region', { name: 'Totals' });
    for (const [label, value] of [['Subtotal', '$54.00'], ['Tax', '$10.26'], ['Total', '$64.26']]) expect(within(totals).getByText(label!).nextElementSibling).toHaveTextContent(value!);
    unmount();
    renderWithI18n(<InvoiceSheet invoice={taxed} customerEmail="a@b.co" />, 'tr');
    const toplamlar = screen.getByRole('region', { name: 'Toplamlar' });
    for (const [label, value] of [['Ara toplam', '$54.00'], ['Vergi', '$10.26'], ['Toplam', '$64.26']]) expect(within(toplamlar).getByText(label!).nextElementSibling).toHaveTextContent(value!);
  });
  it('a tax of zero writes no tax line either: the total is the pack price', () => {
    renderWithI18n(<InvoiceSheet invoice={{ ...invoice, amount: '$54.00', taxCents: 0, totalCents: 5400 }} customerEmail="a@b.co" />);
    expect(screen.queryByText(/tax/i)).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Totals' })).getByText('Total').nextElementSibling).toHaveTextContent('$54.00');
  });
  it('bills the account name with its email under it, or the email alone when the account has no name', () => {
    const { unmount } = renderWithI18n(<InvoiceSheet invoice={invoice} customerName="Ada Lovelace" customerEmail="ada@b.co" />);
    const billed = () => screen.getByRole('heading', { name: 'Billed to' }).nextElementSibling as HTMLElement;
    expect(billed().textContent).toBe('Ada Lovelaceada@b.co');
    unmount();
    renderWithI18n(<InvoiceSheet invoice={invoice} customerName="" customerEmail="ada@b.co" />);
    expect(billed().textContent).toBe('ada@b.co');
  });
  it('says when it was paid without inventing a payment method', () => {
    renderWithI18n(<InvoiceSheet invoice={invoice} customerEmail="a@b.co" />);
    expect(screen.getByText(/^Paid on .*2026/)).toBeInTheDocument();
    expect(screen.queryByText(/PAYMENT METHOD/)).toBeNull();
  });
  it('prints the real line, subtotal and total of invoice.amount', () => {
    renderWithI18n(<InvoiceSheet invoice={{ ...invoice, amount: '$54.00' }} customerEmail="a@b.co" />);
    const row = screen.getByText('Standard pack').closest('tr') as HTMLElement;
    expect(within(row).getByText('30 credits for Viral Clone')).toBeInTheDocument();
    expect(within(row).getByText('1')).toBeInTheDocument();
    expect(within(row).getAllByText('$54.00')).toHaveLength(2);
    const totals = screen.getByLabelText('Totals');
    expect(within(totals).getByText('Subtotal').nextElementSibling).toHaveTextContent('$54.00');
    expect(within(totals).getByText('Total').nextElementSibling).toHaveTextContent('$54.00');
    expect(screen.queryByText('[PRICE]')).toBeNull();
    expect(screen.queryByText('[SUBTOTAL]')).toBeNull();
    expect(screen.queryByText(/\[TAX RATE\]/)).toBeNull();
    expect(screen.getByText('Support: owner@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/viralclone\.app/)).toBeNull();
  });
  it('keeps the price placeholders for an invoice without an amount', () => {
    renderWithI18n(<InvoiceSheet invoice={invoice} customerEmail="a@b.co" />);
    expect(screen.getAllByText('[PRICE]')).toHaveLength(2);
    expect(screen.getByText('[SUBTOTAL]')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Totals')).getByText('Total').nextElementSibling).toHaveTextContent('[AMOUNT]');
  });
  it('is a light sheet whatever the theme, with the print button outside it', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderWithI18n(<InvoiceSheet invoice={invoice} customerEmail="a@b.co" />);
    const sheet = document.querySelector('[data-theme="light"]') as HTMLElement;
    expect(sheet).not.toBeNull();
    const button = screen.getByRole('button', { name: 'Print / Save as PDF' });
    expect(sheet.contains(button)).toBe(false);
    await userEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
    expect(within(sheet).getByRole('heading', { level: 1, name: 'Invoice' })).toBeInTheDocument();
  });
  it('declares an A4 page without margins for printing', () => {
    renderWithI18n(<InvoiceSheet invoice={invoice} customerEmail="a@b.co" />);
    const css = Array.from(document.querySelectorAll('style')).map((el) => el.textContent).join('');
    expect(css).toMatch(/@page\s*\{\s*size:\s*A4;\s*margin:\s*0/);
  });
});
