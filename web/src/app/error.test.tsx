import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import ServiceError from './error';

vi.mock('@/core/i18n/actions', () => ({ setLocale: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/gallery' }));

afterEach(cleanup);

it('the phone menu of the error page does not say the first video is free: it cannot read the admin setting', async () => {
  renderWithI18n(<ServiceError error={new Error('boom')} reset={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByText('Your first video is free.')).toBeNull();
  expect(within(dialog).getByRole('link', { name: 'Get started' })).toBeInTheDocument();
});
