// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/core/session/session', () => ({ getSessionUser: async () => null }));
vi.mock('@/core/session/guards', () => ({ requireAdmin: async () => ({}) }));
vi.mock('next/navigation', () => ({ forbidden: () => { throw new Error('NEXT_FORBIDDEN'); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

import en from '@/messages/en/titles.json';
import tr from '@/messages/tr/titles.json';
import { generateMetadata as reviewTitle } from './jobs/review/page';
import { generateMetadata as jobsTitle } from './jobs/page';
import { generateMetadata as newSwapTitle } from './templates/new-swap/page';
import { generateMetadata as templatesTitle } from './templates/page';

describe('the tab titles of the person-swap pages of the admin', () => {
  it('the photo review and the page that adds a person-swap video each have a title of their own, not the one of the list they sit next to', async () => {
    expect(await reviewTitle()).toEqual({ title: en.adminJobReview });
    expect(await newSwapTitle()).toEqual({ title: en.adminSwapNew });
    expect(en.adminJobReview).toBe('Admin: Photo review');
    expect(en.adminSwapNew).toBe('Admin: Add person-swap video');
    expect(new Set([en.adminJobReview, en.adminSwapNew, en.adminJobs, en.adminTemplates]).size).toBe(4);
    expect(await jobsTitle()).toEqual({ title: en.adminJobs });
    expect(await templatesTitle()).toEqual({ title: en.adminTemplates });
  });

  it('are said in Turkish too', () => {
    expect(tr.adminJobReview).toBe('Yönetim: Fotoğraf ön onayı');
    expect(tr.adminSwapNew).toBe('Yönetim: Kişi değiştirme videosu ekle');
  });
});
