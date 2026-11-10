import { chromium } from 'playwright-core';
import { z } from 'zod';
import type { TopAds } from '../ports.ts';
import { childEnv } from '../adapters/exec.ts';

type Card = Awaited<ReturnType<TopAds['cards']>>[number];

// The current public page exposes country_code and period in its own list request.
// Never hard-code industry IDs: select the page label and verify its request, or use card labels.
export const TOP_ADS_INDUSTRIES = ['beauty-personal-care', 'skincare', 'makeup', 'haircare', 'all'] as const;
const Filters = z.object({
  topAdsIndustry: z.enum(TOP_ADS_INDUSTRIES).default('beauty-personal-care'),
  topAdsCountry: z.string().regex(/^[A-Z]{2}$/).default('US'),
  topAdsPeriod: z.union([z.literal(7), z.literal(30), z.literal(180)]).default(7),
});
export type TopAdsFilterInput = { topAdsIndustry?: string; topAdsCountry?: string; topAdsPeriod?: number };
export const topAdsFilters = (value: TopAdsFilterInput) => Filters.parse(value);
export function topAdsPage(value: TopAdsFilterInput): string {
  const filters = topAdsFilters(value);
  const url = new URL('https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en');
  url.searchParams.set('region', filters.topAdsCountry);
  url.searchParams.set('period', String(filters.topAdsPeriod));
  return url.href;
}
export function matchesTopAdsRequest(url: string, value: TopAdsFilterInput): boolean {
  const f = topAdsFilters(value);
  try {
    const u = new URL(url);
    return u.pathname.includes('/top_ads/v2/list') && u.searchParams.get('country_code') === f.topAdsCountry && u.searchParams.get('period') === String(f.topAdsPeriod);
  } catch { return false; }
}
const CATEGORY = {
  skincare: /^(?:skin care|skincare|facial care|face care|body care|sun care)$/i,
  makeup: /^(?:makeup|make-up|cosmetics|colour cosmetics|color cosmetics)$/i,
  haircare: /^(?:hair care|haircare|hair products|wig (?:&|and) hair styling)$/i,
};
export function matchesTopAdsCategory(label: string, industry: string): boolean {
  if (industry === 'all') return true;
  const text = label.trim();
  if (industry === 'beauty-personal-care') return /^(?:beauty & personal care|beauty and personal care|personal care|fragrance|perfume|fragrances (?:&|and) perfumes|oral care|bath & body|feminine care|aesthetic medicine|other beauty (?:&|and) personal care)$/i.test(text) || Object.values(CATEGORY).some(re => re.test(text));
  return CATEGORY[industry as keyof typeof CATEGORY]?.test(text) ?? false;
}
/** The page's own industry tree (`/top_ads/v2/filters`): id -> name and parent. null when the answer is not that tree. */
export type IndustryTree = Map<number, { value: string; parent: number | undefined }>;
const Tree = z.object({ data: z.object({ industry: z.array(z.object({ id: z.number(), value: z.string(), parent_id: z.number().optional() })) }) });
export function parseIndustryTree(json: unknown): IndustryTree | null {
  const r = Tree.safeParse(json);
  return r.success ? new Map(r.data.data.industry.map(i => [i.id, { value: i.value, parent: i.parent_id }])) : null;
}
export function isTopAdsFiltersRequest(url: string): boolean {
  try { return new URL(url).pathname.includes('/top_ads/v2/filters'); } catch { return false; }
}
/** An ad names its industry by a key (`label_14106000000`); the card in the page shows only the leaf name. Beauty is taken by the root of the key, the narrow sectors by its leaf. */
export function matchesTopAdsIndustryKey(key: string | undefined, tree: IndustryTree, industry: string): boolean {
  if (industry === 'all') return true;
  const id = Number(key?.match(/^label_(\d+)$/)?.[1]);
  const leaf = tree.get(id);
  if (!leaf) return false;
  if (industry !== 'beauty-personal-care') return CATEGORY[industry as keyof typeof CATEGORY]?.test(leaf.value.trim()) ?? false;
  let node = leaf;
  for (let depth = 0; node.parent !== undefined && depth < 4; depth++) node = tree.get(node.parent) ?? { value: '', parent: undefined };
  return /^beauty (?:&|and) personal care$/i.test(node.value.trim());
}
const CARD_URL = (id: string) => `https://ads.tiktok.com/business/creativecenter/topads/${id}/pc/en`;

const Material = z.object({
  id: z.string().min(1),
  ad_title: z.string().default(''),
  industry_key: z.string().optional(),
  like: z.number().finite().nonnegative(),
  video_info: z.object({
    duration: z.number().finite().positive(),
    video_url: z.record(z.string(), z.string()),
  }),
});
const Response = z.object({ data: z.object({ materials: z.array(z.unknown()) }) });

/** Pure. The browser's own user agent with the `HeadlessChrome` marker (the page answers 403 to it) read as plain `Chrome`. */
export function pageUserAgent(real: string): string {
  return real.replace('HeadlessChrome', 'Chrome');
}

/** `720p` -> 720; a key with no number ranks last. */
const quality = (k: string): number => Number.parseInt(k, 10) || 0;

/** Pure. null when the response is not a list; entries without id, likes, duration or a video file are skipped and counted. */
export function parseTopAdsResponse(json: unknown): { cards: Card[]; skipped: number; industryKeys: Map<string, string> } | null {
  const r = Response.safeParse(json);
  if (!r.success) return null;
  const cards: Card[] = [];
  const industryKeys = new Map<string, string>();
  let skipped = 0;
  for (const m of r.data.data.materials) {
    const p = Material.safeParse(m);
    const urls = p.success ? Object.entries(p.data.video_info.video_url).filter(([, v]) => v !== '').sort((a, b) => quality(b[0]) - quality(a[0])) : [];
    if (!p.success || urls.length === 0) { skipped += 1; continue; }
    cards.push({ url: CARD_URL(p.data.id), title: p.data.ad_title, likes: p.data.like, seconds: p.data.video_info.duration, video: urls[0]![1] });
    if (p.data.industry_key) industryKeys.set(CARD_URL(p.data.id), p.data.industry_key);
  }
  return { cards, skipped, industryKeys };
}

export interface TopAdsOptions {
  timeoutMs?: number;                     // whole visit; default 60 s
  executablePath?: string;                // default: the system Chrome (channel 'chrome')
  filters?: () => TopAdsFilterInput;       // read each visit so saved settings apply next scan
  onSkipped?: (skipped: number) => void;
}

/** The part of a Playwright `Page` this file uses, so the order of calls can be pinned in a test. */
export interface PageLike {
  on(event: 'response', handler: (res: ResponseLike) => void): unknown;
  goto(url: string, options: { waitUntil: 'domcontentloaded' }): Promise<unknown>;
  waitForResponse(predicate: (res: ResponseLike) => boolean, options: { timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  getByPlaceholder?(text: string, options: { exact: boolean }): { first(): { count(): Promise<number>; dispatchEvent(type: string): Promise<void> } };
  evaluate?<T>(fn: () => T): Promise<T>;
  getByText(text: string, options: { exact: boolean }): { first(): { count(): Promise<number>; dispatchEvent(type: string): Promise<void> } };
}
export interface ResponseLike { url(): string; json(): Promise<unknown> }

/** Opens the page and collects the list responses. The wait for the first list response is registered BEFORE `goto`: a fast response must not be missed. */
export async function readTopAds(page: PageLike, limit: number, timeout: number, onSkipped?: (skipped: number) => void, filters: TopAdsFilterInput = {}): Promise<Awaited<ReturnType<TopAds['cards']>>> {
  const byUrl = new Map<string, Card>();
  let skipped = 0;
  let sawList = false;
  let selectingIndustry = false;
  let serverIndustryVerified = false;
  const seen: { tree: IndustryTree | null } = { tree: null };
  const keyOf = new Map<string, string>();
  const industry = topAdsFilters(filters).topAdsIndustry;
  const carriesIndustry = (url: string): boolean => [...new URL(url).searchParams].some(([key, value]) => /industry/i.test(key) && value !== '' && value !== '0' && value !== 'all');
  page.on('response', (res) => {
    if (isTopAdsFiltersRequest(res.url())) {
      void res.json().then((j: unknown) => { seen.tree = parseIndustryTree(j) ?? seen.tree; }).catch(() => { /* a body that is not JSON is not the tree */ });
      return;
    }
    if (!matchesTopAdsRequest(res.url(), filters) || (selectingIndustry && !carriesIndustry(res.url()))) return;
    void res.json().then((j: unknown) => {
      const parsed = parseTopAdsResponse(j);
      if (!parsed) return;
      sawList = true;
      if (selectingIndustry) serverIndustryVerified = true;
      skipped += parsed.skipped;
      for (const [url, key] of parsed.industryKeys) keyOf.set(url, key);
      for (const c of parsed.cards) { if (byUrl.size < 100 || byUrl.has(c.url)) byUrl.set(c.url, c); }
    }).catch(() => { /* a body that is not JSON is not a list */ });
  });
  const firstList = page.waitForResponse((res) => matchesTopAdsRequest(res.url(), filters), { timeout });
  firstList.catch(() => { /* reported below, when it is awaited */ });
  await page.goto(topAdsPage(filters), { waitUntil: 'domcontentloaded' });
  await firstList;
  await page.waitForTimeout(1000);
  // The Industry control is an input placeholder, not visible text in the current page.
  // Learn an ID only from the page-owned request after selecting its exact category label. Not tried when the page's own industry tree
  // arrived: the tree classifies every ad below, and a click on a sector row only opens its sub-list (no list answer, a 5 second wait).
  if (industry !== 'all' && !(seen.tree && seen.tree.size > 0)) {
    const selector = page.getByPlaceholder?.('Industry', { exact: true }).first();
    if (selector && await selector.count()) {
      const previous = new Map(byUrl);
      try {
        await selector.dispatchEvent('click');
        await page.waitForTimeout(500);
        const labels = { 'beauty-personal-care': 'Beauty & Personal Care', skincare: 'Skin Care', makeup: 'Makeup', haircare: 'Hair Care' };
        const option = page.getByText(labels[industry], { exact: true }).first();
        if (await option.count()) {
          const filtered = page.waitForResponse(res => matchesTopAdsRequest(res.url(), filters) && carriesIndustry(res.url()), { timeout: Math.min(timeout, 5000) });
          filtered.catch(() => {});
          selectingIndustry = true;
          byUrl.clear();
          await option.dispatchEvent('click');
          await filtered;
          await page.waitForTimeout(1000);
        }
      } catch {
        // An unavailable selector is a filter limitation, not a page/network failure.
        selectingIndustry = false;
        serverIndustryVerified = false;
        byUrl.clear();
        for (const [url, card] of previous) byUrl.set(url, card);
      }
    }
  }
  for (let round = 0; round < 10 && byUrl.size < (industry === 'all' || serverIndustryVerified ? Math.min(limit, 100) : 100); round += 1) {
    const before = byUrl.size;
    const more = page.getByText('View More', { exact: true }).first();
    if (await more.count() === 0) break;
    // A DOM click, not a pointer click: the page's own "revamp" popup (a video overlay) covers the button and a pointer click waits on it until it times out.
    await more.dispatchEvent('click');
    await page.waitForTimeout(2000);
    if (byUrl.size === before) break;
  }
  if (!sawList) throw new Error('Top Ads: the list response had an unexpected shape');
  if (skipped > 0) onSkipped?.(skipped);
  let cards = [...byUrl.values()];
  if (industry !== 'all' && !serverIndustryVerified && cards.length > 0) {
    const known = seen.tree;
    if (known && known.size > 0) {
      // The page's own tree names every ad's industry by key; the card list in the page is virtual (only a few cards are in the DOM at a time).
      cards = cards.filter(card => matchesTopAdsIndustryKey(keyOf.get(card.url), known, industry));
    } else {
      // No tree came: match exact category labels, never words of an ad title. Walk only to a container
      // with one distinct ad link; a page-wide label cannot classify every card.
      const labels = await readCardCategories(page);
      const allowed = new Set(labels.filter(item => matchesTopAdsCategory(item.label, industry)).map(item => CARD_URL(item.id)));
      cards = cards.filter(card => allowed.has(card.url));
    }
  }
  const industryMatched = industry === 'all' ? undefined : cards.length;
  return Object.assign(cards.sort((a, b) => b.likes - a.likes).slice(0, limit), { inspected: byUrl.size, industryMatched });
}

/** Exact card category labels paired with one ad ID, never page-wide text. */
export async function readCardCategories(page: PageLike): Promise<{ id: string; label: string }[]> {
  return await page.evaluate?.(() => {
      const out: { id: string; label: string }[] = [];
      const category = /^(beauty [&a-z ]*personal care|skin ?care|facial care|face care|body care|sun care|make-?up|cosmetics|colou?r cosmetics|hair ?care|hair products|personal care|fragrance|perfume|fragrances & perfumes|oral care|bath & body|feminine care|aesthetic medicine|wig & hair styling|other beauty [&a-z ]*personal care)$/i;
      type Node = { textContent: string | null; children: { length: number }; parentElement: Node | null; querySelectorAll(selector: string): Iterable<Node>; getAttribute(name: string): string | null };
      const document = (globalThis as unknown as { document: { querySelectorAll(selector: string): Iterable<Node> } }).document;
      for (const node of document.querySelectorAll('span,div,p,a')) {
        const label = (node.textContent ?? '').trim();
        if (!category.test(label) || node.children.length > 1) continue;
        let parent: Node | null = node;
        for (let depth = 0; parent && depth < 8; depth++, parent = parent.parentElement) {
          const ids = new Set([...parent.querySelectorAll('a[href]')].map(a => a.getAttribute('href')?.match(/\/topads\/(\d+)/)?.[1]).filter(Boolean));
          if (ids.size > 1) break;
          if (ids.size === 1) { out.push({ id: [...ids][0]!, label }); break; }
        }
      }
      return out;
  }) ?? [];
}

/**
 * Starts Chrome for a visit. The page is the open web, so the browser gets the allow-listed environment of any child (plus HOME, which
 * Chrome needs) and not the worker's: the provider key, the session secret and the other secrets never reach it (B13). Playwright starts
 * Chrome with `--no-sandbox` unless asked; it is asked for the sandbox, and when Chrome cannot start with it the visit starts again
 * without it (still with the narrow environment) rather than the scan going dead.
 */
export async function launchChrome<B>(launch: (options: { executablePath?: string; channel?: 'chrome'; headless: true; env: Record<string, string>; chromiumSandbox: boolean }) => Promise<B>, executablePath?: string, source: NodeJS.ProcessEnv = process.env): Promise<B> {
  const base = { ...(executablePath ? { executablePath } : { channel: 'chrome' as const }), headless: true as const, env: childEnv({ passEnv: ['HOME'] }, source) };
  try { return await launch({ ...base, chromiumSandbox: true }); } catch { return await launch({ ...base, chromiumSandbox: false }); }
}

/**
 * Opens Creative Center "Top Ads" with the configured country and period (no login) in the system
 * Chrome, reads page-owned list responses. With no verified server industry filter, inspects at most 100 cards over 10 View More rounds and checks card category labels.
 * Throws when the browser cannot start, no list response arrives, or the response has another shape.
 */
export function createTopAds(options: TopAdsOptions = {}): TopAds {
  return {
    async cards(limit, filters) {
      const timeout = options.timeoutMs ?? 60_000;
      const browser = await launchChrome((o) => chromium.launch(o), options.executablePath);
      try {
        const probe = await browser.newPage();
        const real = await probe.evaluate(() => navigator.userAgent);      // the running browser's own, so it follows Chrome's updates
        await probe.close();
        const context = await browser.newContext({ userAgent: pageUserAgent(real), locale: 'en-US', viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        return await readTopAds(page, limit, timeout, options.onSkipped, filters ?? options.filters?.() ?? {});
      } finally {
        await browser.close();
      }
    },
  };
}
