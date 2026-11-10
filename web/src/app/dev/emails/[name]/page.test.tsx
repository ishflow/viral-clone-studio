import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { resetStore } from '@/data/mock/store';
import EmailPreview from './page';

const preview = (name: string) => EmailPreview({ params: Promise.resolve({ name }), searchParams: Promise.resolve({}) });

beforeEach(() => resetStore());
afterEach(cleanup);

describe('/dev/emails/refused', () => {
  it.each([
    ['en', 'Your person swap was not approved.', 'Open the job'],
    ['tr', 'Kişi değiştirme isteğin onaylanmadı.', 'İşi aç'],
  ] as const)('shows the board of the mail a refused person swap sends (%s): its subject, its text and the link to the job', async (locale, title, action) => {
    renderWithI18n(await preview('refused'), locale);
    expect(screen.getByText(/Subject: Your person swap was not approved/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: action })).toHaveAttribute('href', expect.stringMatching(/\/jobs\/.+/));
  });
});
