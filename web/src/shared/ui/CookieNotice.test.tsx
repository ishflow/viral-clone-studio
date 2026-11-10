import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CookieNotice } from './CookieNotice';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { loadMessages } from '@/core/i18n/messages';
import { renderWithI18n } from './test-utils';

const setCookieConsent = vi.fn();
const failing = vi.hoisted(() => ({ on: false }));
vi.mock('next/link', () => ({
  default: ({ prefetch, children, ...rest }: { prefetch?: boolean; children: ReactNode }) => (
    <a data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/core/consent/actions', () => ({ setCookieConsent: async (fd: FormData) => {
    setCookieConsent(fd.get('choice'));
    if (failing.on) throw new Error('boom');
  } }));

afterEach(() => {
  cleanup();
  setCookieConsent.mockClear();
});

describe('CookieNotice', () => {
  it('renders nothing once answered', () => {
    const { container } = renderWithI18n(<CookieNotice answered />);
    expect(container).toBeEmptyDOMElement();
  });
  it('keeps the notice when the action throws', async () => {
    failing.on = true;
    renderWithI18n(<CookieNotice />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(setCookieConsent).toHaveBeenCalledWith('all');
    expect(screen.getByRole('region', { name: 'Cookie notice' })).toBeInTheDocument();
    failing.on = false;
  });
  it('an answered notice that becomes unanswered is shown again', async () => {
    const view = renderWithI18n(<CookieNotice />);
    await userEvent.click(screen.getByRole('button', { name: 'Only necessary' }));
    expect(screen.queryByRole('region')).toBeNull();
    const again = (answered: boolean) => (
      <I18nProvider locale="en" messages={loadMessages('en')}>
        <CookieNotice answered={answered} />
      </I18nProvider>
    );
    view.rerender(again(true));
    expect(screen.queryByRole('region')).toBeNull();
    view.rerender(again(false));
    expect(screen.getByRole('region', { name: 'Cookie notice' })).toBeInTheDocument();
  });
  it('the policy link does not load its page ahead of time on every page', () => {
    renderWithI18n(<CookieNotice />);
    expect(screen.getByRole('link')).toHaveAttribute('data-prefetch', 'false');
  });
  it('floats over the page by default and, with inFlow, sits after the content so the last form row is never under it', () => {
    const floating = renderWithI18n(<CookieNotice />);
    expect(floating.container.firstElementChild).toHaveClass('fixed');
    floating.unmount();
    const inFlow = renderWithI18n(<CookieNotice inFlow />);
    expect(inFlow.container.firstElementChild).toHaveClass('sticky');
    expect(inFlow.container.firstElementChild).not.toHaveClass('fixed');
  });
  it('submits the chosen answer and disappears', async () => {
    renderWithI18n(<CookieNotice />);
    expect(screen.getByRole('region', { name: 'Cookie notice' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Only necessary' }));
    expect(setCookieConsent).toHaveBeenCalledWith('necessary');
    expect(screen.queryByRole('region')).toBeNull();
  });
  it('is small on a phone so it does not cover the price cards: tighter padding and gap, 13 px text, shorter buttons that keep their words; the 600 px layout keeps the roomy look', () => {
    const { container } = renderWithI18n(<CookieNotice />);
    expect(container.firstElementChild).toHaveClass('pb-3', 'min-[600px]:pb-6');
    const form = screen.getByRole('region', { name: 'Cookie notice' });
    expect(form).toHaveClass('p-4', 'gap-y-3', 'min-[600px]:p-6', 'min-[600px]:gap-y-4');
    expect(form.querySelector('p')).toHaveClass('max-[599px]:text-13');
    expect(screen.getByRole('heading', { name: 'Cookies' })).toHaveClass('max-[599px]:sr-only');
    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('max-[599px]:min-h-11', 'max-[599px]:text-13');
    expect(screen.getByRole('button', { name: 'Only necessary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept all' })).toBeInTheDocument();
  });
});

 it.each(['en', 'tr'] as const)('links to the cookie policy in %s and offers exactly two choices', (locale) => {
  renderWithI18n(<CookieNotice />, locale);
  expect(screen.getByRole('link')).toHaveAttribute('href', '/legal/cookies');
  expect(screen.getAllByRole('button')).toHaveLength(2);
});
