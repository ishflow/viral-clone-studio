import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { renderWithI18n } from '@/shared/ui/test-utils';
import type { CreditRates } from '@/data/ports';
import { costOf, PricingView, type PackView } from './PricingView';

const [STARTER, STANDARD, STUDIO]: [PackView, PackView, PackView] = [
  { id: 'pack-starter', name: 'Starter', credits: 10, price: '$19' },
  { id: 'pack-standard', name: 'Standard', credits: 30, price: '$54' },
  { id: 'pack-studio', name: 'Studio', credits: 100, price: '$169' },
];
const RATES: CreditRates = { perVideo: { 'no-talking': { fast: 2, best: 5 }, talking: { fast: 4, best: 8 } }, ownTemplate: 1 };
const PACKS: PackView[] = [STARTER, STANDARD, STUDIO];

describe('PricingView', () => {
  it('shows one card per pack with its price, "About N videos" (credits / the Fast no-talking price) and the basis', () => {
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn={false} />);
    const packs = screen.getByRole('region', { name: 'Credit packs' });
    expect(within(packs).getAllByRole('article')).toHaveLength(3);
    for (const price of ['$19', '$54', '$169']) expect(within(packs).getByText(price)).toBeInTheDocument();
    expect(within(packs).getByText('30 credits')).toBeInTheDocument();
    for (const about of ['About 5 videos', 'About 15 videos', 'About 50 videos']) expect(within(packs).getByText(about)).toBeInTheDocument();
    expect(within(packs).getAllByText('No talking · Fast · one variant')).toHaveLength(3);
    expect(screen.getByText('Prices are in US dollars. Tax is added at checkout where it applies.')).toBeInTheDocument();
  });

  it('the three cards stack on a tablet and sit side by side from the wide layout, never two and one (auto-fit gave 2 + 1 at 768 px)', () => {
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn={false} />);
    const row = screen.getByRole('region', { name: 'Credit packs' });
    expect(row).toHaveClass('grid-cols-1', 'nav:grid-cols-3');
    expect(row.className).not.toMatch(/auto-fit/);
  });

  it('says why no checkout was opened when it was sent back with notice=too-many-checkouts', () => {
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn notice="too-many-checkouts" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Too many unfinished checkouts today. Finish or cancel one, or try again tomorrow.');
  });

  it('says that the payment page could not be opened and that nothing was charged, in the language of the site', () => {
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn notice="payment-unavailable" />);
    expect(screen.getByRole('alert')).toHaveTextContent('We could not open the payment page just now. Nothing was charged. Please try again in a moment.');
    cleanup();
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn notice="payment-unavailable" />, 'tr');
    expect(screen.getByRole('alert')).toHaveTextContent('Ödeme sayfasını şu anda açamadık. Senden ücret alınmadı. Biraz sonra tekrar dene.');
  });

  it('shows nothing for an unknown notice and never echoes it', () => {
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn notice="<b>hello</b>" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/hello/)).toBeNull();
  });

  it('links Buy to sign up for a visitor', () => {
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn={false} />);
    for (const link of screen.getAllByRole('link', { name: 'Buy' })) {
      expect(link).toHaveAttribute('href', '/signup?next=%2Fpricing');
    }
  });

  it('Buy is a form (a POST) for a signed-in user: it calls the checkout action with the pack and returnTo; no address opens a checkout', async () => {
    const buy = vi.fn();
    const { container } = renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn returnTo="/gallery" buy={buy} />);
    expect(container.querySelector('a[href*="/checkout"]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Buy' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: 'Buy' })[1]!);
    await waitFor(() => expect(buy).toHaveBeenCalledTimes(1));
    expect(buy.mock.calls[0]!.slice(0, 2)).toEqual(['pack-standard', '/gallery']);
  });

  it('a signed-in user without a returnTo sends none', async () => {
    const buy = vi.fn();
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn buy={buy} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Buy' })[0]!);
    await waitFor(() => expect(buy).toHaveBeenCalledTimes(1));
    expect(buy.mock.calls[0]!.slice(0, 2)).toEqual(['pack-starter', undefined]);
  });

  it('has the 5-row credit table from the rates (2 / 5 / 4 / 8 / 1), the fixed-price note and the 8 questions; no placeholder is left', () => {
    const { container } = renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn={false} />);
    const rows = Array.from(container.querySelectorAll('dl')[0]!.querySelectorAll('dd')).map((dd) => dd.textContent);
    expect(rows).toEqual(['2 credits', '5 credits', '4 credits', '8 credits', '1 credit']);
    expect(screen.getByText('Talking video, Best')).toBeInTheDocument();
    expect(screen.getByText(/The price is fixed: credits per video × the number of variants \(1 to 3\)\./)).toBeInTheDocument();
    expect(container.querySelectorAll('dl')[1]!.querySelectorAll('dt')).toHaveLength(8);
    expect(screen.getByText('What is free?')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\[(PRICE|CREDITS|COUNT|REFUND POLICY|CREDIT VALIDITY PERIOD)\]/);
  });

  it('a customer who used the free video does not read Your first video is free; a visitor does while the setting is on', () => {
    const { unmount } = renderWithI18n(<PricingView freeOffer={false} rates={RATES} packs={PACKS} signedIn />);
    expect(screen.queryByText(/first video is free/i)).toBeNull();
    expect(screen.queryByText('What is free?')).toBeNull();
    expect(screen.getByText(/You buy credits, with no subscription\./)).toBeInTheDocument();
    unmount();
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn={false} />);
    expect(screen.getByText(/Your first video is free/)).toBeInTheDocument();
    expect(screen.getByText('What is free?')).toBeInTheDocument();
  });

  it('costOf reads the one source: the rates the jobs are charged with', () => {
    expect(['noTalkingFast', 'noTalkingBest', 'talkingFast', 'talkingBest', 'ownTemplate'].map((k) => costOf(RATES, k as never))).toEqual([2, 5, 4, 8, 1]);
  });
});

describe('PricingView featured pack', () => {
  const lime = (c: HTMLElement) => c.querySelectorAll('article.bg-accent');

  it('makes exactly one card lime: Standard, chosen by id', () => {
    const { container } = renderWithI18n(<PricingView freeOffer rates={RATES} packs={PACKS} signedIn={false} />);
    expect(lime(container)).toHaveLength(1);
    expect(lime(container)[0]).toHaveTextContent('Standard');
  });

  it('keeps the lime card on Standard when the order changes', () => {
    const { container } = renderWithI18n(<PricingView freeOffer rates={RATES} packs={[STUDIO, STANDARD, STARTER]} signedIn={false} />);
    expect(lime(container)[0]).toHaveTextContent('Standard');
  });

  it('has no lime card when no pack has the featured id', () => {
    const { container } = renderWithI18n(
      <PricingView freeOffer rates={RATES} packs={[STARTER, STUDIO]} signedIn={false} />,
    );
    expect(lime(container)).toHaveLength(0);
  });

  it('a pack with an unknown id has no description line, but still its price and its count', () => {
    renderWithI18n(<PricingView freeOffer rates={RATES} packs={[{ id: 'pack-x', name: 'Extra', credits: 6, price: '$7' }]} signedIn={false} />);
    expect(screen.getByText('$7')).toBeInTheDocument();
    expect(screen.getByText('About 3 videos')).toBeInTheDocument();
  });

  it('in invite mode a visitor\'s Buy asks for an invite at /contact, and the page does not promise the free video', () => {
    renderWithI18n(<PricingView freeOffer invite rates={RATES} packs={PACKS} signedIn={false} />);
    expect(screen.queryByRole('link', { name: 'Buy' })).toBeNull();
    const asks = screen.getAllByRole('link', { name: 'Request an invite' });
    expect(asks).toHaveLength(3);
    for (const link of asks) expect(link).toHaveAttribute('href', '/contact');
    expect(screen.queryByText(/first video is free/i)).toBeNull();
    expect(screen.queryByText('What is free?')).toBeNull();
  });
});
