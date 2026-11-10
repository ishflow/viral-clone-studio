import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthFrame } from './AuthFrame';
import { renderWithI18n } from './test-utils';

vi.mock('@/core/i18n/actions', () => ({ setLocale: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/login' }));

afterEach(cleanup);

const openMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  return screen.getByRole('dialog');
};

describe('AuthFrame', () => {
  it('its phone menu does not promise a free first video unless the page says the offer is on', async () => {
    renderWithI18n(<AuthFrame>form</AuthFrame>);
    expect(within(await openMenu()).queryByText('Your first video is free.')).toBeNull();
  });
  it('its phone menu promises it while the offer is on', async () => {
    renderWithI18n(<AuthFrame freeOffer>form</AuthFrame>);
    expect(within(await openMenu()).getByText('Your first video is free.')).toBeInTheDocument();
  });
});
