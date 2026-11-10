import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDownloader } from '../adapters/downloader.ts';
import { createShorts } from './shorts.ts';
import { createTopAds } from './topads.ts';

// Each runs only with VC_LIVE_SCAN=1 (real network). Run only with explicit authorisation; normal suites never use the network.
describe.skipIf(!process.env.VC_LIVE_SCAN)('live scan sources', () => {
  it('Shorts: a hashtag page gives cards with a Shorts URL, views over the minimum and seconds', async () => {
    const r = await createShorts({ count: 40 }).search('skincare', { minViews: 100000, limit: 5 });
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.length).toBeLessThanOrEqual(5);
    for (const c of r) expect(c).toMatchObject({ url: expect.stringContaining('/shorts/'), views: expect.any(Number), seconds: expect.any(Number) });
    for (const c of r) { expect(c.views).toBeGreaterThanOrEqual(100000); expect(c.seconds).toBeGreaterThan(0); }
  }, 150_000);

  it('Top Ads: Creative Center returns cards with likes, seconds and a video URL', async () => {
    const r = await createTopAds().cards(10);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toMatchObject({ url: expect.stringContaining('creativecenter'), likes: expect.any(Number), video: expect.stringMatching(/^https?:/) });
  }, 120_000);

  // R2fix (C7b I2): which URL of a Top Ads card the downloader can read. The candidate keeps both (url: the page, video: the file).
  it('Top Ads download: the card\'s video file downloads; the Creative Center page is printed as it fails or works', async () => {
    const [card] = await createTopAds().cards(1);
    expect(card).toBeDefined();
    const got = await createDownloader().video(card!.video, mkdtempSync(join(tmpdir(), 'vc-live-')));
    expect(got.file).toMatch(/\.mp4$/);
    const page = await createDownloader().video(card!.url, mkdtempSync(join(tmpdir(), 'vc-live-'))).then(() => 'page: downloads', (e: unknown) => `page: fails (${String(e).slice(0, 200)})`);
    console.log(page, '| video host:', new URL(card!.video).host, '| query keys:', [...new URL(card!.video).searchParams.keys()].join(','));
  }, 300_000);
});

// CodexT: authorised public-page discovery, no production data or paid services.
describe.skipIf(!process.env.VC_LIVE_SCAN)('Top Ads filter discovery', () => {
  it('discovers the page-owned Beauty list request', async () => {
    const { chromium } = await import('playwright-core');
    const { pageUserAgent } = await import('./topads.ts');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const probe = await browser.newPage();
      const ua = await probe.evaluate(() => navigator.userAgent);
      await probe.close();
      const page = await browser.newPage({ userAgent: pageUserAgent(ua), locale: 'en-US' });
      page.on('response', res => {
        if (res.url().includes('/top_ads/v2/list')) {
          const u = new URL(res.url());
          console.log('LIST FILTERS', Object.fromEntries([...u.searchParams].filter(([k]) => /industry|period|country|region/.test(k))));
          void res.json().then(j => console.log('MATERIAL CATEGORY', Object.fromEntries(Object.entries(j.data?.materials?.[0] ?? {}).filter(([k]) => /industry|category/.test(k)))));
        }
        if (/industry/.test(res.url()) && !res.url().includes('/top_ads/')) void res.json().then(j => console.log('INDUSTRY DATA', JSON.stringify(j).slice(0, 18000))).catch(() => {});
      });
      await page.goto('https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=US&period=7', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);
      console.log('FILTER UI', (await page.locator('body').innerText()).slice(0, 7000));
      const industries = page.getByText('All industries', { exact: true }).first();
      if (await industries.count() === 0) { console.log('UNVERIFIED: industry selector is absent; use card category fallback'); return; }
      await industries.dispatchEvent('click');
      await page.waitForTimeout(1000);
      console.log('INDUSTRY UI', (await page.locator('body').innerText()).slice(0, 7000));
      await page.getByText('Beauty & Personal Care', { exact: true }).first().dispatchEvent('click');
      await page.waitForTimeout(4000);
      console.log('FILTERED URL', page.url());
    } finally { await browser.close(); }
  }, 60000);
});

// T1 explicitly authorised a second discovery to verify server filters or measure bounded fallback yield.
describe.skipIf(!process.env.VC_LIVE_SCAN)('Top Ads second discovery', () => {
  it('measures up to 100 cards and discovers available industry controls', async () => {
    const { chromium } = await import('playwright-core');
    const { pageUserAgent } = await import('./topads.ts');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const materials = new Map<string, { id: string; industry_key: string; industry_name?: string }>();
    try {
      const probe = await browser.newPage();
      const ua = await probe.evaluate(() => navigator.userAgent);
      await probe.close();
      const page = await browser.newPage({ userAgent: pageUserAgent(ua), locale: 'en-US', viewport: { width: 1440, height: 900 } });
      page.setDefaultTimeout(5000);
      page.on('response', res => {
        if (!res.url().includes('/top_ads/v2/list')) return;
        const u = new URL(res.url());
        console.log('LIST FILTERS', Object.fromEntries([...u.searchParams].filter(([k]) => /industry|period|country|region/.test(k))));
        void res.json().then(j => { for (const m of j.data?.materials ?? []) materials.set(m.id, { id: m.id, industry_key: m.industry_key, industry_name: m.industry_name }); }).catch(() => {});
      });
      await page.goto('https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=US&period=7', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      console.log('CONTROLS', await page.locator('button,[role="button"],[role="combobox"],input').evaluateAll(nodes => nodes.map(n => ({ tag: n.tagName, text: n.textContent?.trim().slice(0,100), label: n.getAttribute('aria-label'), placeholder: n.getAttribute('placeholder'), class: n.className }))));
      for (const text of ['Filters', 'Filter', 'All industries', 'All Industries', 'Industry']) {
        const locator = page.getByText(text, { exact: true }).first();
        if (await locator.count()) { await locator.dispatchEvent('click'); await page.waitForTimeout(1000); }
      }
      const beauty = page.getByText('Beauty & Personal Care', { exact: true }).first();
      if (await beauty.count()) { await beauty.dispatchEvent('click'); await page.waitForTimeout(3000); }
      else console.log('UNVERIFIED: Beauty & Personal Care industry control not present');
      for (let round = 0; round < 10 && materials.size < 100; round++) {
        const before = materials.size;
        const more = page.getByText('View More', { exact: true }).first();
        if (!await more.count()) break;
        await more.dispatchEvent('click'); await page.waitForTimeout(2000);
        if (before === materials.size) break;
      }
      const { readCardCategories, matchesTopAdsCategory } = await import('./topads.ts');
      const labels = await readCardCategories(page);
      const inspected = [...materials.values()].slice(0, 100);
      const ids = new Set(inspected.map(m => m.id));
      const beautyIds = new Set(labels.filter(l => ids.has(l.id) && matchesTopAdsCategory(l.label, 'beauty-personal-care')).map(l => l.id));
      const distribution: Record<string, number> = {};
      for (const m of inspected) distribution[m.industry_key ?? 'unknown'] = (distribution[m.industry_key ?? 'unknown'] ?? 0) + 1;
      const metrics = { inspected: inspected.length, beautyCards: beautyIds.size, industryKeys: distribution, labels, serverIndustry: 'UNVERIFIED', country_code: 'US', period: 7 };
      const { writeFileSync } = await import('node:fs');
      writeFileSync('/tmp/codext-live-discovery.json', JSON.stringify(metrics, null, 2) + '\n', { mode: 0o600 });
      console.log('MEASURED METRICS', metrics);
      console.log('MEASURED MATERIALS', [...materials.values()].slice(0,100));
      console.log('CARD DOM', await page.locator('a[href*="/topads/"]').evaluateAll(nodes => nodes.slice(0,100).map(n => ({ href: n.getAttribute('href'), parents: [n.parentElement, n.parentElement?.parentElement, n.parentElement?.parentElement?.parentElement].map(p => ({ class: p?.className, text: p?.textContent?.trim().slice(0,600) })) }))));
      console.log('PAGE TEXT', (await page.locator('body').innerText()).slice(0,9000));
      console.log('CATEGORY NODES', await page.locator('[class*="industry" i],[class*="category" i]').evaluateAll(nodes => nodes.slice(0,100).map(n => ({ class: n.className, text: n.textContent?.trim().slice(0,200), parentClass: n.parentElement?.className, parentText: n.parentElement?.textContent?.trim().slice(0,600) }))));
    } finally { await browser.close(); }
  }, 90000);
});
