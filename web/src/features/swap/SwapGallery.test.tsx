import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));

import { SwapGallery } from './SwapGallery';

afterEach(cleanup);

describe('the person-swap list with no video published', () => {
  it('says there is no video yet, in both languages, instead of an empty page', () => {
    renderWithI18n(<SwapGallery cards={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Person swap' })).toBeInTheDocument();
    expect(screen.getByText('No videos yet')).toBeInTheDocument();
    cleanup();
    renderWithI18n(<SwapGallery cards={[]} />, 'tr');
    expect(screen.getByText('Henüz video yok')).toBeInTheDocument();
  });

  it('shows no such message when there are videos', () => {
    renderWithI18n(<SwapGallery cards={[{ id: 'a', title: 'Walk', image: '/a.jpg', video: null, seconds: 12, people: 1, credits: 3, uses: 0 }]} />);
    expect(screen.queryByText('No videos yet')).toBeNull();
    expect(screen.getByText('Walk')).toBeInTheDocument();
  });
});

describe('the card of a video that was used', () => {
  const card = (uses: number) => ({ id: 'a', title: 'Walk', image: '/a.jpg', video: null, seconds: 12, people: 1, credits: 3, uses });

  it('says how many times it was used, in both languages, with the price still on it', () => {
    renderWithI18n(<SwapGallery cards={[card(12)]} />);
    expect(screen.getByText('3 credits · Used 12 times')).toBeInTheDocument();
    cleanup();
    renderWithI18n(<SwapGallery cards={[card(12)]} />, 'tr');
    expect(screen.getByText('3 kredi · 12 kez kullanıldı')).toBeInTheDocument();
  });

  it('says "time", not "times", for one', () => {
    renderWithI18n(<SwapGallery cards={[card(1)]} />);
    expect(screen.getByText('3 credits · Used 1 time')).toBeInTheDocument();
  });

  it('shows no counter at 0', () => {
    renderWithI18n(<SwapGallery cards={[card(0)]} />);
    expect(screen.getByText('3 credits')).toBeInTheDocument();
    expect(screen.queryByText(/Used/)).toBeNull();
  });

  it('shows the counter without a price while generation is paused', () => {
    renderWithI18n(<SwapGallery cards={[{ ...card(4), credits: null }]} />);
    expect(screen.getByText('Price is shown on the next page · Used 4 times')).toBeInTheDocument();
  });
});
