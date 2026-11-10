import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUSINESS } from '@/core/config';
import { exposedAddresses, renderWithI18n, serverHtml } from '@/shared/ui/test-utils';
import { ContactView } from './ContactView';

vi.mock('./actions', () => ({ submitContact: vi.fn() }));

afterEach(cleanup);

describe('ContactView', () => {
  it('offers the support email of the business as a mail link', () => {
    renderWithI18n(<ContactView />);
    const link = screen.getByRole('link', { name: BUSINESS.supportEmail });
    expect(link).toHaveAttribute('href', `mailto:${BUSINESS.supportEmail}`);
    expect(screen.queryByText(/\[SUPPORT EMAIL\]/)).toBeNull();
  });

  it('keeps the address and its mail link where Cloudflare does not rewrite them (that rewrite breaks hydration)', () => {
    const html = serverHtml(<ContactView />);
    expect(html).toContain(`href="mailto:${BUSINESS.supportEmail}"`);
    expect(exposedAddresses(html, BUSINESS.supportEmail)).toBe(0);
  });
});
