import { describe, expect, it } from 'vitest';
import { topAdsFilters, topAdsPage, matchesTopAdsRequest } from './topads.ts';

describe('Top Ads filters', () => {
  it('defaults to Beauty, US and seven days for old settings', () => {
    expect(topAdsFilters({})).toEqual({ topAdsIndustry: 'beauty-personal-care', topAdsCountry: 'US', topAdsPeriod: 7 });
    expect(new URL(topAdsPage({})).searchParams.get('industry')).toBeNull();
  });
  it('encodes explicit filters and refuses invalid persisted values', () => {
    const url = new URL(topAdsPage({ topAdsIndustry: 'beauty-personal-care', topAdsCountry: 'GB', topAdsPeriod: 30 }));
    expect(url.searchParams.get('region')).toBe('GB');
    expect(url.searchParams.get('period')).toBe('30');
    expect(() => topAdsFilters({ topAdsCountry: 'US&industry=all' })).toThrow();
    expect(() => topAdsFilters({ topAdsPeriod: 8 })).toThrow();
  });
  it('ignores an unfiltered response rather than collecting unrelated ads', () => {
    expect(matchesTopAdsRequest('https://ads.tiktok.com/top_ads/v2/list?country_code=US&period=7', {})).toBe(true);
    expect(matchesTopAdsRequest('https://ads.tiktok.com/top_ads/v2/list?country_code=US&period=30', {})).toBe(false);
    expect(matchesTopAdsRequest('https://ads.tiktok.com/top_ads/v2/list?country_code=GB&period=7', {})).toBe(false);
  });
});

it('accepts beauty category labels, not words inside unrelated ad copy', async () => {
  const { matchesTopAdsCategory, readTopAds } = await import('./topads.ts');
  expect(matchesTopAdsCategory('Skin Care', 'beauty-personal-care')).toBe(true);
  expect(matchesTopAdsCategory('Makeup', 'skincare')).toBe(false);
  expect(matchesTopAdsCategory('Church event with skincare giveaway', 'beauty-personal-care')).toBe(false);
  const materials = [
    { id: '1', ad_title: 'Beauty product review', like: 3, industry_key: 'label_beauty', video_info: { duration: 12, video_url: { '720p': 'https://example.invalid/1.mp4' } } },
    { id: '2', ad_title: 'Church skincare giveaway', like: 99, industry_key: 'label_event', video_info: { duration: 12, video_url: { '720p': 'https://example.invalid/2.mp4' } } },
  ];
  const res = { url: () => 'https://ads.tiktok.com/top_ads/v2/list?country_code=US&period=7', json: async () => ({ data: { materials } }) };
  let handler: (r: typeof res) => void = () => {};
  const page = {
    on: (_event: 'response', h: typeof handler) => { handler = h; },
    goto: async () => { handler(res); },
    waitForResponse: async () => res,
    waitForTimeout: async () => {},
    getByText: () => ({ first: () => ({ count: async () => 0, dispatchEvent: async () => {} }) }),
    evaluate: async <T,>(_fn: () => T): Promise<T> => [{ id: '1', label: 'Skin Care' }] as T,
  };
  expect((await readTopAds(page, 5, 1000)).map(c => c.title)).toEqual(['Beauty product review']);
  page.evaluate = async <T,>(_fn: () => T): Promise<T> => [] as T;
  expect(await readTopAds(page, 5, 1000)).toMatchObject({ length: 0, inspected: 2, industryMatched: 0 });
});

it('learns the server industry parameter only after selecting the exact page label', async () => {
  const { readTopAds } = await import('./topads.ts');
  const material = (id: string) => ({ id, ad_title: id, like: 1, video_info: { duration: 12, video_url: { '720p': `https://example.invalid/${id}.mp4` } } });
  const response = (industry: boolean) => ({ url: () => `https://ads.tiktok.com/top_ads/v2/list?country_code=US&period=7${industry ? '&industry_id=page-owned-id' : ''}`, json: async () => ({ data: { materials: [material(industry ? 'beauty' : 'event')] } }) });
  let handler: (r: ReturnType<typeof response>) => void = () => {};
  let waiter: { predicate: (r: ReturnType<typeof response>) => boolean; resolve: (r: unknown) => void } | undefined;
  const emit = (industry: boolean) => { const res = response(industry); handler(res); if (waiter?.predicate(res)) waiter.resolve(res); };
  const page = {
    on: (_event: 'response', h: typeof handler) => { handler = h; },
    goto: async () => emit(false),
    waitForResponse: (predicate: (r: ReturnType<typeof response>) => boolean) => new Promise(resolve => { waiter = { predicate, resolve }; }),
    waitForTimeout: async () => {},
    getByPlaceholder: () => ({ first: () => ({ count: async () => 1, dispatchEvent: async () => {} }) }),
    getByText: (text: string) => ({ first: () => ({ count: async () => text === 'Beauty & Personal Care' ? 1 : 0, dispatchEvent: async () => emit(true) }) }),
  };
  const cards = await readTopAds(page, 5, 1000);
  expect(cards.map(c => c.title)).toEqual(['beauty']);
  expect(cards.inspected).toBe(1);
});

it('bounds client filtering to 100 inspected cards even when many unrelated ads are available', async () => {
  const { readTopAds } = await import('./topads.ts');
  let round = 0;
  let handler: (r: { url(): string; json(): Promise<unknown> }) => void = () => {};
  const emit = () => handler({ url: () => 'https://ads.tiktok.com/top_ads/v2/list?country_code=US&period=7', json: async () => ({ data: { materials: Array.from({ length: 20 }, (_, i) => ({ id: String(round * 20 + i), ad_title: 'Event', like: 1, video_info: { duration: 12, video_url: { '720p': 'https://example.invalid/v.mp4' } } })) } }) });
  const page = {
    on: (_event: 'response', h: typeof handler) => { handler = h; },
    goto: async () => emit(), waitForResponse: async () => {}, waitForTimeout: async () => {},
    getByText: () => ({ first: () => ({ count: async () => 1, dispatchEvent: async () => { round++; emit(); } }) }),
    evaluate: async <T,>(_fn: () => T): Promise<T> => [] as T,
  };
  const cards = await readTopAds(page, 30, 1000);
  expect(cards).toMatchObject({ length: 0, inspected: 100, industryMatched: 0 });
  expect(round).toBe(4);
});

describe('Top Ads Chrome launch (B13)', () => {
  const source = { PATH: '/usr/bin', HOME: '/Users/x', MAGNIFIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', VC_SESSION_SECRET: 's', VC_ADMIN_PASSWORD: 'p', RESEND_API_KEY: 'r' };

  it('gives Chrome only the allow-listed environment and HOME, never a worker secret', async () => {
    const { launchChrome } = await import('./topads.ts');
    const calls: Record<string, unknown>[] = [];
    await launchChrome(async (o) => { calls.push(o); return 'browser'; }, undefined, source);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.env).toEqual({ PATH: '/usr/bin', HOME: '/Users/x' });
    expect(calls[0]).toMatchObject({ channel: 'chrome', headless: true, chromiumSandbox: true });
  });
  it('keeps the narrow environment on the executablePath branch too', async () => {
    const { launchChrome } = await import('./topads.ts');
    const calls: Record<string, unknown>[] = [];
    await launchChrome(async (o) => { calls.push(o); return 'browser'; }, '/opt/chrome', source);
    expect(calls[0]).toMatchObject({ executablePath: '/opt/chrome', headless: true, chromiumSandbox: true, env: { PATH: '/usr/bin', HOME: '/Users/x' } });
    expect(calls[0]).not.toHaveProperty('channel');
  });
  it('starts again without the sandbox when Chrome cannot start with it, still with the narrow environment', async () => {
    const { launchChrome } = await import('./topads.ts');
    const calls: Record<string, unknown>[] = [];
    const r = await launchChrome(async (o) => { calls.push(o); if (o.chromiumSandbox) throw new Error('sandbox'); return 'browser'; }, undefined, source);
    expect(r).toBe('browser');
    expect(calls.map((c) => c.chromiumSandbox)).toEqual([true, false]);
    expect(calls[1]!.env).toEqual({ PATH: '/usr/bin', HOME: '/Users/x' });
  });
  it('lets a second failure through', async () => {
    const { launchChrome } = await import('./topads.ts');
    await expect(launchChrome(async () => { throw new Error('no chrome'); }, undefined, source)).rejects.toThrow('no chrome');
  });
});
