import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageUserAgent, parseTopAdsResponse, readTopAds } from './topads.ts';
import type { PageLike, ResponseLike } from './topads.ts';

// The Top Ads fixture is written by hand to the shape the code ASSUMES; it was not captured from the real source.
const fx = (n: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), 'utf8');

describe('pageUserAgent', () => {
  it('turns HeadlessChrome into Chrome and keeps the rest', () => {
    expect(pageUserAgent('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.1.2 Safari/537.36'))
      .toBe('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.1.2 Safari/537.36');
    expect(pageUserAgent('Mozilla/5.0 Chrome/141.0.1.2')).toBe('Mozilla/5.0 Chrome/141.0.1.2');
  });
});

describe('parseTopAdsResponse (hand-written list response)', () => {
  it('maps materials with an id and a video to cards (best quality), skips the rest', () => {
    const r = parseTopAdsResponse(JSON.parse(fx('topads-list.handwritten.json')));
    expect(r!.cards).toEqual([
      { url: 'https://ads.tiktok.com/business/creativecenter/topads/7300000000000000001/pc/en', title: 'Glow in 7 days', likes: 48210, seconds: 18.4, video: 'https://example.invalid/v1-720.mp4' },
      { url: 'https://ads.tiktok.com/business/creativecenter/topads/7300000000000000002/pc/en', title: 'Pads that work', likes: 1500, seconds: 9, video: 'https://example.invalid/v2-480.mp4' },
    ]);
    expect(r!.skipped).toBe(2);
  });
  it('a response of another shape gives null', () => {
    expect(parseTopAdsResponse({ code: 0, data: {} })).toBeNull();
    expect(parseTopAdsResponse('x')).toBeNull();
  });
});

describe('readTopAds order of calls', () => {
  // A hand-made page: its list response arrives while `goto` is still running, and a wait registered after that never sees it.
  const material = { id: '7300000000000000009', ad_title: 'x', like: 5, video_info: { duration: 12, video_url: { '720p': 'https://example.invalid/v.mp4' } } };
  function fakePage() {
    const log: string[] = [];
    const handlers: ((r: ResponseLike) => void)[] = [];
    const waiters: (() => void)[] = [];
    let emitted = false;
    const res: ResponseLike = { url: () => 'https://ads.example.invalid/creative_radar_api/v1/top_ads/v2/list?page=1&country_code=US&period=7', json: async () => ({ data: { materials: [material] } }) };
    const page: PageLike = {
      on: (_e, h) => { handlers.push(h); },
      goto: async () => {
        log.push('goto');
        emitted = true;
        for (const h of handlers) h(res);
        for (const w of waiters) w();
      },
      waitForResponse: (_p, o) => {
        log.push('waitForResponse');
        return new Promise((resolve, reject) => {
          if (emitted) setTimeout(() => reject(new Error(`timeout ${o.timeout}`)), 20);   // too late: the response was already gone
          else waiters.push(() => resolve(res));
        });
      },
      waitForTimeout: async () => {},
      getByText: () => ({ first: () => ({ count: async () => 0, dispatchEvent: async () => {} }) }),
    };
    return { page, log };
  }
  it('registers the wait for the list response before goto, so a fast response is not missed', async () => {
    const { page, log } = fakePage();
    const cards = await readTopAds(page, 5, 1000, undefined, { topAdsIndustry: 'all' });
    expect(log).toEqual(['waitForResponse', 'goto']);
    expect(cards).toHaveLength(1);
  });
});
