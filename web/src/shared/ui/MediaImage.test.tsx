import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaImage } from './MediaImage';

// Records the props the wrapper hands to next/image.
const seen: { src: string; unoptimized?: boolean }[] = [];
vi.mock('next/image', () => ({ default: (p: { src: string; unoptimized?: boolean }) => { seen.push({ src: p.src, unoptimized: p.unoptimized }); return null; } }));

describe('MediaImage', () => {
  it('serves a file under /media as it is: the image optimizer fetches without the viewer session and would answer 400', () => {
    seen.length = 0;
    render(<MediaImage src="/media/jobs/abc/v1/poster.jpg" alt="" width={10} height={10} />);
    expect(seen[0]).toEqual({ src: '/media/jobs/abc/v1/poster.jpg', unoptimized: true });
  });

  it('leaves every other image to the optimizer', () => {
    seen.length = 0;
    render(<MediaImage src="/images/hero.jpg" alt="" width={10} height={10} />);
    expect(seen[0]?.unoptimized).toBe(false);
  });
});
