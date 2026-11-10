import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Pager } from './Pager';
import { renderWithI18n } from './test-utils';

afterEach(cleanup);

describe('Pager', () => {
  it('disables Previous without prevHref and links Next', () => {
    renderWithI18n(<Pager shown={25} total={60} nextHref="?page=2" />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '?page=2');
    expect(screen.getByText('Showing 25 of 60')).toBeInTheDocument();
  });
  it('disables Next without nextHref and links Previous', () => {
    renderWithI18n(<Pager shown={10} total={10} prevHref="?page=1" />);
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '?page=1');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
  it('disabled buttons are outlined, not filled, and marked disabled', () => {
    renderWithI18n(<Pager shown={1} total={1} />);
    const prev = screen.getByRole('button', { name: 'Previous' });
    expect(prev).toBeDisabled();
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(prev).toHaveClass('border-edge-strong', 'text-text-3');
    expect(prev).not.toHaveClass('bg-raised');
  });
});
