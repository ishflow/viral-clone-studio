import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { VideoCard } from './VideoCard';

afterEach(cleanup);

const props = {
  href: '/templates/tpl-1',
  title: 'Fragrance layering recipe',
  meta: 'Fragrance · reference 1.9M views',
  image: '/samples/f20a7ed7a7bc172a7da483415800077f.jpg',
  formatLabel: 'No talking',
  durationLabel: '8 sec',
};

describe('VideoCard', () => {
  it('has exactly one link and the title is its accessible name', () => {
    render(<VideoCard {...props} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Fragrance layering recipe');
    expect(links[0]).toHaveAttribute('href', '/templates/tpl-1');
  });
  it('shows the title, meta and both labels', () => {
    render(<VideoCard {...props} />);
    expect(screen.getByRole('heading', { name: props.title })).toBeInTheDocument();
    expect(screen.getByText(props.meta)).toBeInTheDocument();
    expect(screen.getByText('No talking')).toBeInTheDocument();
    expect(screen.getByText('8 sec')).toBeInTheDocument();
  });
  it('has no video element without a video, and mounts a muted one when given', async () => {
    const { container, rerender } = render(<VideoCard {...props} />);
    expect(container.querySelector('video')).toBeNull();
    rerender(<VideoCard {...props} video="/samples/layering.mp4" />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    await userEvent.hover(screen.getByRole('link'));
  });
});
