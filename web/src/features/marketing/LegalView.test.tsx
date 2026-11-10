import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);
import { BUSINESS } from '@/core/config';
import { exposedAddresses, renderWithI18n, serverHtml } from '@/shared/ui/test-utils';
import { LegalView } from './LegalView';
import { isLegalDoc, LEGAL_DOCS, LEGAL_SECTIONS, legalBlocks } from './legal';

describe('legal docs', () => {
  it('knows exactly five docs, in the order of the boards', () => {
    expect([...LEGAL_DOCS]).toEqual(['terms', 'privacy', 'refunds', 'cookies', 'content']);
    expect(isLegalDoc('cookies')).toBe(true);
    expect(isLegalDoc('nope')).toBe(false);
  });
});

describe('LegalView', () => {
  it.each(LEGAL_DOCS)('%s: no support address is left where Cloudflare would rewrite it (that rewrite breaks hydration), in both languages', (doc) => {
    for (const locale of ['en', 'tr'] as const) {
      const html = serverHtml(<LegalView doc={doc} />, locale);
      expect(html).toContain(BUSINESS.supportEmail);
      expect(exposedAddresses(html, BUSINESS.supportEmail)).toBe(0);
    }
  });

  it.each(['terms', 'privacy', 'refunds', 'content'] as const)('%s names the operator, address and support email instead of asking the owner for them', (doc) => {
    renderWithI18n(<LegalView doc={doc} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('owner@example.com');
    if (doc === 'terms' || doc === 'privacy') expect(text).toContain('ishflow, 123 Example St, City, Country, owner@example.com');
    expect(text).not.toMatch(/OWNER TO CONFIRM: (operator name|contact email\])/);
    expect(text).not.toMatch(/\{(company|address|supportEmail)\}/);
  });

  it('terms: ten sections with their text, no placeholder in them', () => {
    renderWithI18n(<LegalView doc="terms" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(10);
    expect(screen.queryByText('[LEGAL TEXT]')).toBeNull();
    expect(screen.getByText('You must be 18 or older to use the service.')).toBeInTheDocument();
    expect(screen.getByText('Our liability to you is limited to the amount you paid in the last 12 months.')).toBeInTheDocument();
    expect(screen.getByText('Last updated: 7 October 2026')).toBeInTheDocument();
  });

  it('refunds: "Refund policy" with six sections, the four policy sentences and a link to support', () => {
    renderWithI18n(<LegalView doc="refunds" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Refund policy' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Unused packs', 'Used credits', 'Videos that are not delivered', 'A video that came out wrong', 'How to ask for a refund', 'After you ask']);
    for (const sentence of [/A credit is used when a video is delivered, or when a template of your own is prepared with it\./, /While the request is open, the credits of that pack are held\./, /If a refund does not go through, the credits return to your balance\./, /Every such request is approved\./]) {
      expect(screen.getByText(sentence)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'contact support' })).toHaveAttribute('href', '/contact?topic=refund');
  });

  it.each(LEGAL_DOCS)('%s: every section has its text as bullets or paragraphs, in both languages, with no draft marker left', (doc) => {
    for (const locale of ['en', 'tr'] as const) {
      const { container } = renderWithI18n(<LegalView doc={doc} />, locale);
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/\[(OWNER TO CONFIRM|LEGAL TEXT)|TASLAK|DRAFT|\{\w+\}/);
      expect(container.querySelectorAll('article section')).toHaveLength(LEGAL_SECTIONS[doc]);
      expect(container.querySelectorAll('article section li').length).toBeGreaterThan(LEGAL_SECTIONS[doc]);
      cleanup();
    }
  });

  it('cookies: names the four cookies in a list and says there are no analytics or advertising cookies', () => {
    renderWithI18n(<LegalView doc="cookies" />);
    for (const name of ['vc_session', 'vc_locale', 'vc_theme', 'vc_cookies']) expect(screen.getByText(new RegExp(`^${name}: `))).toBeInTheDocument();
    expect(screen.getByText('No analytics cookies. No advertising cookies. No tracking by other companies.')).toBeInTheDocument();
  });

  it('privacy: says the product photos go to the AI model and names the operator’s country law, the 30-day answer and no payment provider', () => {
    renderWithI18n(<LegalView doc="privacy" />);
    expect(screen.getByText(/Your product photos are sent to it\./)).toBeInTheDocument();
    expect(screen.getByText(/personal data legislation of the operator’s country/)).toBeInTheDocument();
    expect(screen.getByText(/We answer within 30 days\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Dodo/i);
  });

  it('marks the current doc in the side list of five', () => {
    renderWithI18n(<LegalView doc="refunds" />);
    const nav = screen.getByRole('navigation', { name: 'Legal pages' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Terms of use', 'Privacy', 'Refunds', 'Cookies', 'Content policy']);
    const current = links.filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/legal/refunds');
  });
});

describe('legalBlocks', () => {
  it('turns "- " lines into one list per run and any other line into a paragraph', () => {
    expect(legalBlocks('Lead:\n- a\n- b\nMiddle\n- c')).toEqual([
      { list: false, lines: ['Lead:'] },
      { list: true, lines: ['a', 'b'] },
      { list: false, lines: ['Middle'] },
      { list: true, lines: ['c'] },
    ]);
  });
  it('keeps a text without line breaks as a single paragraph', () => {
    expect(legalBlocks('Read the sections below.')).toEqual([{ list: false, lines: ['Read the sections below.'] }]);
  });

describe('LegalView the tab strip on a phone', () => {
  it('wraps onto a second row so every tab is on the screen (no strip running off its edge); from the wide layout it is the side column as before', () => {
    renderWithI18n(<LegalView doc="terms" />);
    const nav = screen.getByRole('navigation', { name: 'Legal pages' });
    expect(nav).toHaveClass('flex-wrap', 'nav:flex-col', 'nav:flex-nowrap');
    expect(nav.className).not.toMatch(/overflow-x-auto|-mx-4/);
  });
});
});
