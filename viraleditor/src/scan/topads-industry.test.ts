import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchesTopAdsCategory, matchesTopAdsIndustryKey, parseIndustryTree, readTopAds } from './topads.ts';
import type { PageLike, ResponseLike } from './topads.ts';

// Synthetic fixture shaped like the public page: an industry tree and four invented ads of a list. The page names an ad's
// industry only by a key (`label_14106000000`); the card in the page shows the LEAF name ("Fragrances & Perfumes"), never "Beauty & Personal Care".
const live = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/topads-live-2026-10-07.json', import.meta.url)), 'utf8')) as { filters: unknown; list: { data: { materials: { id: string; industry_key: string }[] } } };
const BASE = 'https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2';
const LIST = `${BASE}/list?period=7&page=1&limit=20&order_by=for_you&country_code=US`;

/** The page of the live run: the filters answer and the list answer arrive, the card list in the page is virtual (the DOM reads no category), no View More. */
function livePage(list: unknown = live.list, filters: unknown = live.filters): PageLike {
  let handler: (r: ResponseLike) => void = () => {};
  const filtersRes: ResponseLike = { url: () => `${BASE}/filters`, json: async () => filters };
  const listRes: ResponseLike = { url: () => LIST, json: async () => list };
  return {
    on: (_e, h) => { handler = h; },
    goto: async () => { handler(filtersRes); handler(listRes); },
    waitForResponse: async () => listRes,
    waitForTimeout: async () => {},
    getByPlaceholder: () => ({ first: () => ({ count: async () => 1, dispatchEvent: async () => {} }) }),
    getByText: () => ({ first: () => ({ count: async () => 0, dispatchEvent: async () => {} }) }),
    evaluate: async <T,>(): Promise<T> => [] as T,
  };
}

describe('Top Ads industry from the page\'s own industry tree', () => {
  it('finds the beauty ad of the live list although the card shows only its leaf name', async () => {
    const cards = await readTopAds(livePage(), 30, 1000, undefined, { topAdsIndustry: 'beauty-personal-care' });
    expect(cards.map((c) => c.url)).toEqual([`https://ads.tiktok.com/business/creativecenter/topads/${live.list.data.materials.find((m) => m.industry_key === 'label_14106000000')!.id}/pc/en`]);
    expect(cards).toMatchObject({ inspected: 4, industryMatched: 1 });
  });
  it('a leaf industry takes only its own leaf', async () => {
    expect(await readTopAds(livePage(), 30, 1000, undefined, { topAdsIndustry: 'skincare' })).toMatchObject({ length: 0, inspected: 4, industryMatched: 0 });
  });
  it('keeps every ad when the sector is "all"', async () => {
    expect(await readTopAds(livePage(), 30, 1000, undefined, { topAdsIndustry: 'all' })).toHaveLength(4);
  });
  it('an ad whose key the tree does not list is not taken for beauty', async () => {
    const unknown = { data: { materials: [{ id: '1', ad_title: 'x', like: 1, industry_key: 'label_99999000000', video_info: { duration: 9, video_url: { '720p': 'https://example.invalid/1.mp4' } } }] } };
    expect(await readTopAds(livePage(unknown), 30, 1000, undefined, { topAdsIndustry: 'beauty-personal-care' })).toMatchObject({ length: 0, inspected: 1, industryMatched: 0 });
  });
  it('without a tree it still falls back to the card labels', async () => {
    const page = livePage(live.list, { code: 1 });
    page.evaluate = async <T,>(): Promise<T> => [{ id: live.list.data.materials.find((m) => m.industry_key === 'label_14106000000')!.id, label: 'Fragrances & Perfumes' }] as T;
    expect(await readTopAds(page, 30, 1000, undefined, { topAdsIndustry: 'beauty-personal-care' })).toMatchObject({ length: 1, industryMatched: 1 });
  });
});

describe('the server sector filter of the page', () => {
  it('is not tried when the page\'s own tree arrived: the tree names every ad\'s sector, and a click on the sector row waited 5 seconds for a list that never came', async () => {
    const page = livePage();
    const clicks: string[] = [];
    const waits: number[] = [];
    page.getByPlaceholder = () => ({ first: () => ({ count: async () => 1, dispatchEvent: async () => { clicks.push('industry box'); } }) });
    page.getByText = (text) => ({ first: () => ({ count: async () => (text === 'Beauty & Personal Care' ? 1 : 0), dispatchEvent: async () => { clicks.push(text); } }) });
    const waitForResponse = page.waitForResponse;
    page.waitForResponse = (predicate, options) => { waits.push(options.timeout); return waitForResponse(predicate, options); };
    const cards = await readTopAds(page, 30, 8000, undefined, { topAdsIndustry: 'beauty-personal-care' });
    expect(clicks).toEqual([]);
    expect(waits).toEqual([8000]);
    expect(cards).toMatchObject({ length: 1, inspected: 4, industryMatched: 1 });
  });
});

describe('parseIndustryTree / matchesTopAdsIndustryKey', () => {
  it('reads ids, names and parents of the page\'s tree; another shape gives null', () => {
    const tree = parseIndustryTree(live.filters)!;
    expect(tree.get(14106000000)).toEqual({ value: 'Fragrances & Perfumes', parent: 14000000000 });
    expect(tree.get(14000000000)).toEqual({ value: 'Beauty & Personal Care', parent: undefined });
    expect(parseIndustryTree({ data: {} })).toBeNull();
  });
  it('matches by root for beauty, by leaf for the narrow sectors', () => {
    const tree = parseIndustryTree(live.filters)!;
    expect(matchesTopAdsIndustryKey('label_14103000000', tree, 'beauty-personal-care')).toBe(true);   // Skincare
    expect(matchesTopAdsIndustryKey('label_14103000000', tree, 'skincare')).toBe(true);
    expect(matchesTopAdsIndustryKey('label_14104000000', tree, 'makeup')).toBe(true);                  // Cosmetics
    expect(matchesTopAdsIndustryKey('label_14101000000', tree, 'haircare')).toBe(true);
    expect(matchesTopAdsIndustryKey('label_14104000000', tree, 'skincare')).toBe(false);
    expect(matchesTopAdsIndustryKey('label_23118000000', tree, 'beauty-personal-care')).toBe(false);  // Reading
    expect(matchesTopAdsIndustryKey('label_14106000000', tree, 'all')).toBe(true);
    expect(matchesTopAdsIndustryKey(undefined, tree, 'beauty-personal-care')).toBe(false);
  });
  it('the leaf names under Beauty & Personal Care that the card shows are accepted by the label match too', () => {
    for (const label of ['Fragrances & Perfumes', 'Cosmetics', 'Oral Care', 'Skincare', 'Wig & Hair Styling', 'Haircare', 'Aesthetic Medicine', 'Feminine Care', 'Other Beauty & Personal Care']) {
      expect(matchesTopAdsCategory(label, 'beauty-personal-care'), label).toBe(true);
    }
    expect(matchesTopAdsCategory('Reading', 'beauty-personal-care')).toBe(false);
  });
});
