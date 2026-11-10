import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { loadMessages, publicMessages } from '@/core/i18n/messages';
import type { Locale } from '@/core/i18n/types';
import type { CreditRates } from '@/data/ports';
import { GalleryError, GalleryLoading, GalleryView, TemplateDetail } from '@/features/gallery';
import { makeTemplate } from '@/features/gallery/fixtures';
import { ContactView } from '@/features/marketing/ContactView';
import { HomeView } from '@/features/marketing/HomeView';
import { LegalView } from '@/features/marketing/LegalView';
import { LEGAL_DOCS } from '@/features/marketing/legal';
import { PricingView, type PackView } from '@/features/marketing/PricingView';
import { CookieNotice } from '@/shared/ui/CookieNotice';
import { Footer } from '@/shared/ui/Footer';
import { HeaderCustomer } from '@/shared/ui/HeaderCustomer';
import { HeaderVisitor } from '@/shared/ui/HeaderVisitor';
import ServiceError from './error';

vi.mock('next/image', () => ({ default: (p: { alt?: string }) => <span role="img" aria-label={p.alt} /> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/gallery', useRouter: () => ({ refresh: vi.fn() }), unstable_rethrow: () => {} }));
vi.mock('@/core/session/actions', () => ({ logOut: vi.fn() }));
vi.mock('@/core/i18n/actions', () => ({ setLocale: vi.fn() }));
vi.mock('@/core/consent/actions', () => ({ clearCookieConsent: vi.fn(), setCookieConsent: vi.fn() }));
vi.mock('@/features/marketing/actions', () => ({ submitContact: vi.fn() }));
vi.mock('@/features/gallery/actions', () => ({ addVideo: vi.fn(), removeTemplate: vi.fn() }));

afterEach(cleanup);

const PACKS: PackView[] = [{ id: 'pack-starter', name: 'Starter', credits: 10, price: '$19' }, { id: 'pack-standard', name: 'Standard', credits: 30, price: '$54' }];
const RATES: CreditRates = { perVideo: { 'no-talking': { fast: 2, best: 5 }, talking: { fast: 4, best: 8 } }, ownTemplate: 1 };
const query = { q: '', category: '', format: '', sort: 'newest' } as const;
const templates = [makeTemplate(), makeTemplate({ id: 'tpl-b', title: 'Dupe comparison', format: 'talking' })];

/** Everything the browser draws on a public page, and the root error page: the parts that read a message through `useT`. */
const SCREENS: Record<string, ReactElement> = {
  home: <HomeView freeOffer images={['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg', '/e.jpg']} />,
  'home, invite only': <HomeView freeOffer={false} images={['/a.jpg']} />,
  pricing: <PricingView freeOffer rates={RATES} packs={PACKS} signedIn={false} />,
  'pricing, signed in, a notice': <PricingView freeOffer={false} rates={RATES} packs={PACKS} signedIn notice="payment-unavailable" />,
  'pricing, the other notice': <PricingView freeOffer rates={RATES} packs={PACKS} signedIn={false} notice="too-many-checkouts" />,
  contact: <ContactView />,
  'contact, signed in, about a payment': <ContactView topic="payment" account={{ email: 'a@b.co', jobs: [{ id: 'job-1', title: 'A video', at: '2026-10-01T10:00:00Z' }] }} />,
  gallery: <GalleryView data={{ query, categories: ['Lashes'], templates, others: [], free: true, showTalking: true }} />,
  'gallery, nothing found': <GalleryView data={{ query: { ...query, q: 'zzz' }, categories: ['Lashes'], templates: [], others: [], free: false, showTalking: false }} />,
  'gallery loading': <GalleryLoading categories={['Lashes']} />,
  'gallery error': <GalleryError onRetry={() => {}} />,
  template: <TemplateDetail template={makeTemplate()} />,
  'visitor header': <HeaderVisitor freeOffer />,
  'invite header': <HeaderVisitor freeOffer={false} invite />,
  'customer header': <HeaderCustomer balanceLabel="12 credits" />,
  'admin header on a public page': <HeaderCustomer isAdmin balanceLabel="1 free video" />,
  footer: <Footer />,
  'cookie notice': <CookieNotice />,
  'root error page': <ServiceError error={new Error('x')} reset={() => {}} />,
  ...Object.fromEntries(LEGAL_DOCS.map((doc) => [`legal ${doc}`, <LegalView key={doc} doc={doc} />])),
};

describe('a public page given only the public messages', () => {
  for (const locale of ['en', 'tr'] as Locale[]) {
    it.each(Object.entries(SCREENS))(`${locale}: %s shows no message that is missing`, (_name, screen) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { container } = render(
        <I18nProvider locale={locale} messages={publicMessages(loadMessages(locale))}>
          {screen}
        </I18nProvider>,
      );
      expect(warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('[i18n] missing'))).toEqual([]);
      expect(container.textContent).not.toMatch(/\b(common|gallery|marketing|titles)\.[a-z]\w*\.\w+/);
      warn.mockRestore();
    });
  }
});
