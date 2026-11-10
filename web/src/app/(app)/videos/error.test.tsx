import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import VideosError from './error';

afterEach(cleanup);

describe('the list of videos could not be loaded', () => {
  it('says what happened and that nothing is lost; Try again calls reset; Contact support only after a retry failed again', async () => {
    const reset = vi.fn();
    const props = { error: new Error('boom'), reset };
    const first = renderWithI18n(<VideosError {...props} />);
    expect(screen.getByRole('heading', { name: 'Could not load your videos.' })).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again. Your videos and credits are not affected.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Contact support' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    first.unmount();
    // The retry failed: the block shows again, now with the way to the support.
    renderWithI18n(<VideosError {...props} />);
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact');
  });
});
