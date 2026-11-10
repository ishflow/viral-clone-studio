import { describe, expect, it, vi } from 'vitest';

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
}));
vi.mock('next/navigation', () => ({ notFound }));

import LegalPage from '@/app/(site)/(marketing)/legal/[doc]/page';

describe('legal page route', () => {
  it('calls notFound() for an unknown doc', async () => {
    await expect(LegalPage({ params: Promise.resolve({ doc: 'x' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
  it('renders a known doc', async () => {
    notFound.mockClear();
    await LegalPage({ params: Promise.resolve({ doc: 'privacy' }) });
    expect(notFound).not.toHaveBeenCalled();
  });
});
