import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import EmailPreview from './emails/[name]/page';
import EmailsPage from './emails/page';
import GalleryCheck from './gallery-check/[kind]/page';
import DevLayout from './layout';
import ShellPage from './shells/[kind]/page';
import DevUiPage from './ui/page';

const params = <T,>(value: T) => Promise.resolve(value);

beforeEach(() => resetStore());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('/dev/* in a production build (UI kit, shells, email previews with the mail outbox)', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'production'));

  it('the layout is a 404', () => {
    expect(() => DevLayout({ children: 'the outbox with verification and reset links' })).toThrow('NEXT_NOT_FOUND');
  });

  // The layout alone is not enough: Next renders a page beside its layout, and what the page read would still travel in the response.
  it('the outbox page is a 404 before it reads the outbox', async () => {
    const outbox = vi.spyOn(data.mailer, 'outbox');
    await expect(EmailsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(outbox).not.toHaveBeenCalled();
  });

  it('a sent email is a 404 before the outbox is read, whatever the id', async () => {
    const outbox = vi.spyOn(data.mailer, 'outbox');
    await expect(EmailPreview({ params: params({ name: 'verify' }), searchParams: params({ id: 'any' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(outbox).not.toHaveBeenCalled();
  });

  it('the UI kit, the shells and the gallery checks are 404 too', async () => {
    expect(() => DevUiPage()).toThrow('NEXT_NOT_FOUND');
    await expect(ShellPage({ params: params({ kind: 'visitor' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(GalleryCheck({ params: params({ kind: 'loading' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('/dev/* in development and in tests', () => {
  it('the layout shows its pages, and the outbox page reads the outbox', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(DevLayout({ children: 'page' }).props.children).toBe('page');
    const outbox = vi.spyOn(data.mailer, 'outbox');
    await EmailsPage();
    expect(outbox).toHaveBeenCalledTimes(1);
  });
});

it('Resend never exposes the mail outbox or token previews even in next dev',async()=>{
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('VC_MAIL','resend');
 const outbox=vi.spyOn(data.mailer,'outbox');
 await expect(EmailsPage()).rejects.toThrow('NEXT_NOT_FOUND');
 await expect(EmailPreview({params:params({name:'verify'}),searchParams:params({id:'mail'})})).rejects.toThrow('NEXT_NOT_FOUND');
 expect(outbox).not.toHaveBeenCalled();
});
