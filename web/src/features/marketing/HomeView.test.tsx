import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);
import { renderWithI18n } from '@/shared/ui/test-utils';
import { HomeView } from './HomeView';

const IMAGES = ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg', '/e.jpg'];

describe('HomeView', () => {
  it('links the calls to action', () => {
    renderWithI18n(<HomeView freeOffer images={IMAGES} />);
    expect(screen.getByRole('link', { name: 'Browse the gallery' })).toHaveAttribute('href', '/gallery');
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#how');
    expect(screen.getByRole('link', { name: 'Watch the samples' })).toHaveAttribute('href', '/gallery');
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/signup');
  });

  it('shows the real template images and three steps', () => {
    const { container } = renderWithI18n(<HomeView freeOffer images={IMAGES} />);
    expect(container.querySelectorAll('img[src*="a.jpg"]').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Sample in the gallery')).toBeInTheDocument();
  });

  it('the three steps stack on a tablet and sit side by side from the wide layout, never two and one (auto-fit gave 2 + 1 at 768 px)', () => {
    renderWithI18n(<HomeView freeOffer images={IMAGES} />);
    const steps = screen.getAllByRole('listitem')[0]!.parentElement!;
    expect(steps).toHaveClass('grid-cols-1', 'nav:grid-cols-3');
    expect(steps.className).not.toMatch(/auto-fit/);
  });

  it('has the new texts: the free promise, what stays the same, the no-talking time and the delivery answer', () => {
    renderWithI18n(<HomeView freeOffer images={IMAGES} />);
    expect(screen.getByText('Your first video is free: one no-talking video in Fast quality. No card needed.')).toBeInTheDocument();
    expect(screen.getByText(/What stays the same,/)).toBeInTheDocument();
    expect(screen.getByText(/The structure stays the same: shots, order, timing and on-screen text\./)).toBeInTheDocument();
    expect(screen.getByText('A no-talking video takes about 6–7 minutes. You can leave the page; we email you when it is ready.', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.queryByText(/12 minutes/)).toBeNull();
    expect(screen.getByText(/If a video is not delivered, its credits go back to your balance/, { selector: 'dd' })).toBeInTheDocument();
  });

  it('with the offer off there is no first-video-free line; the questions stay', () => {
    renderWithI18n(<HomeView freeOffer={false} images={IMAGES} />);
    expect(screen.queryByText(/first video is free/i)).toBeNull();
    expect(screen.getAllByRole('term')).toHaveLength(4);
  });

  it('with no ready template in the gallery there is no sample section and no way to "watch the samples" (an empty black box and a button to an empty gallery)', () => {
    renderWithI18n(<HomeView freeOffer images={[]} />);
    expect(screen.queryByRole('link', { name: 'Watch the samples' })).toBeNull();
    expect(screen.queryByText('Sample in the gallery')).toBeNull();
    expect(screen.queryByText(/Every video playing in the gallery/)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByRole('term')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Browse the gallery' })).toHaveAttribute('href', '/gallery');
  });

  it('in invite mode a visitor is not told the first video is free or to get started: the closing button asks for an invite at /contact', () => {
    renderWithI18n(<HomeView freeOffer invite images={IMAGES} />);
    expect(screen.queryByText(/first video is free/i)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Get started' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Request an invite' })).toHaveAttribute('href', '/contact');
  });

  it('in invite mode the closing button is in Turkish too', () => {
    renderWithI18n(<HomeView freeOffer invite images={IMAGES} />, 'tr');
    expect(screen.getByRole('link', { name: 'Davet iste' })).toHaveAttribute('href', '/contact');
  });
});
