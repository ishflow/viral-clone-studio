import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));

import { WelcomeView } from './WelcomeView';

afterEach(cleanup);

describe('WelcomeView', () => {
  it('without a free video there is no What is free box, no free promise, and the section is named for credits', () => {
    renderWithI18n(<WelcomeView cards={[]} freeOffer={false} />);
    expect(screen.queryByText('What is free')).toBeNull();
    expect(screen.queryByText(/is free\./)).toBeNull();
    expect(screen.queryByText(/free/i)).toBeNull();
    expect(screen.getByRole('region', { name: 'How credits work' })).toBeInTheDocument();
    expect(screen.getByText('What comes after')).toBeInTheDocument();
    expect(screen.getByText('What needs credits')).toBeInTheDocument();
  });
  it('with a free video it keeps the promise and the What is free box', () => {
    renderWithI18n(<WelcomeView cards={[]} freeOffer />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your first video is free.');
    expect(screen.getByRole('region', { name: 'How the free video works' })).toBeInTheDocument();
    expect(screen.getByText('What is free')).toBeInTheDocument();
  });
});
