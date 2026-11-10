import type { Settings } from '../contracts.ts';

export interface ScanCard {
  source: 'topads' | 'shorts';
  url: string;
  title: string;
  seconds: number;
  views: number | null;
  likes: number | null;
  image: string | null;
  video: string | null;          // Top Ads: the direct file of the ad (the page URL is not one a downloader reads); Shorts: null
}

/**
 * Pure. Top Ads are ranked by likes and cut to `topAdsCards`, Shorts ranked by views; then a card is dropped when its length is outside
 * `secondsMin`..`secondsMax`, when it is a Short under `shortsMinViews`, when its URL is in `seen` or already earlier in the batch;
 * at most `perScan` remain.
 */
export function filter(cards: ScanCard[], settings: Settings, seen: ReadonlySet<string>): ScanCard[] {
  const rank = (c: ScanCard) => { const v = (c.source === 'topads' ? c.likes : c.views) ?? 0; return Number.isFinite(v) ? v : 0; };
  const ordered = [...cards].sort((a, b) => rank(b) - rank(a));
  const topAds = ordered.filter((c) => c.source === 'topads').slice(0, settings.topAdsCards);
  const kept = ordered.filter((c) => c.source !== 'topads' || topAds.includes(c));
  const urls = new Set<string>();
  const out: ScanCard[] = [];
  const bad = (n: number | null) => n !== null && !(Number.isFinite(n) && n >= 0);
  for (const c of kept) {
    if (c.url.trim() === '' || !Number.isFinite(c.seconds) || c.seconds < 0 || bad(c.views) || bad(c.likes)) continue;
    if (c.seconds < settings.secondsMin || c.seconds > settings.secondsMax) continue;
    if (c.source === 'shorts' && (c.views ?? 0) < settings.shortsMinViews) continue;
    if (seen.has(c.url) || urls.has(c.url)) continue;
    urls.add(c.url);
    out.push(c);
    if (out.length >= settings.perScan) break;
  }
  return out;
}
