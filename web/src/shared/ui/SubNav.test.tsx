import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SubNav } from './SubNav';

afterEach(cleanup);

describe('SubNav', () => {
  it('marks the current tab', () => {
    render(<SubNav label="Revenue" currentHref="/admin/revenue/credits" items={[{ href: '/admin/revenue', label: 'Purchases' }, { href: '/admin/revenue/credits', label: 'Credits' }]} />);
    expect(screen.getByRole('navigation', { name: 'Revenue' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Credits' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Purchases' })).not.toHaveAttribute('aria-current');
  });
});
