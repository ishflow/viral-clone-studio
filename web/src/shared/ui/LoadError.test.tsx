import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadError, resetLoadErrorTries } from './LoadError';
import { renderWithI18n } from './test-utils';

beforeEach(resetLoadErrorTries);
afterEach(cleanup);

describe('LoadError', () => {
  it('says the title and the sentence and offers Try again, which calls the retry', () => {
    const retry = vi.fn();
    renderWithI18n(<LoadError title="Could not load the gallery." text="Check your connection." onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the gallery.');
    expect(screen.queryByRole('link', { name: 'Contact support' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it('after a retry that failed again (a new error component), Contact support is offered too', () => {
    const { unmount } = renderWithI18n(<LoadError title="x" onRetry={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    unmount();
    renderWithI18n(<LoadError title="x" onRetry={() => {}} />);
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact');
  });
  it('forgets the retries after a minute', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderWithI18n(<LoadError title="x" onRetry={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      unmount();
      vi.advanceTimersByTime(61_000);
      renderWithI18n(<LoadError title="x" onRetry={() => {}} />);
      expect(screen.queryByRole('link', { name: 'Contact support' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
