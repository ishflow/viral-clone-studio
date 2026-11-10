import { z } from 'zod';
import { ExecError, runProcess } from '../adapters/exec.ts';
import type { Shorts, ShortsWant } from '../ports.ts';

type Item = Awaited<ReturnType<Shorts['search']>>[number];

/** A line of the hashtag list: only the id and a rounded view count are there (no duration). */
export interface Entry { url: string; views: number }

const ListLine = z.object({ id: z.string().min(1), view_count: z.number().finite().nonnegative() });
// The detail JSON of one video: the exact view count and the duration the list lacks.
const Detail = z.object({
  title: z.string().default(''),
  duration: z.number().finite().positive(),
  view_count: z.number().finite().nonnegative(),
});

const shortsUrl = (id: string) => `https://www.youtube.com/shorts/${id}`;
/** At most this many detail calls run at once. */
const DETAIL_PARALLEL = 3;

/** Pure. A leading `#` removed, lower-cased, whitespace removed, URL-encoded; '' when nothing is left. */
export function shortsTag(query: string): string {
  return encodeURIComponent(query.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, ''));
}

export function listArgs(tag: string, count: number): string[] {
  return ['--flat-playlist', '--dump-json', '--no-warnings', '--no-progress', '--ignore-errors', '--playlist-end', String(count), '--', `https://www.youtube.com/hashtag/${tag}/shorts`];
}

export function detailArgs(url: string): string[] {
  return ['--no-playlist', '--skip-download', '--dump-json', '--no-warnings', '--', url];
}

/** Pure. Lines that are not JSON or lack an id or a finite view count are skipped and counted. */
export function parseListLines(stdout: string): { entries: Entry[]; skipped: number } {
  const entries: Entry[] = [];
  let skipped = 0;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    let json: unknown;
    try { json = JSON.parse(line); } catch { skipped += 1; continue; }
    const p = ListLine.safeParse(json);
    if (!p.success) { skipped += 1; continue; }
    entries.push({ url: shortsUrl(p.data.id), views: p.data.view_count });
  }
  return { entries, skipped };
}

/** Pure. The card of one video from its detail JSON (last non-empty line); null when there is no usable JSON. */
export function parseDetail(stdout: string, url: string): Item | null {
  const line = stdout.trim().split('\n').filter((l) => l.trim() !== '').pop() ?? '';
  let json: unknown;
  try { json = JSON.parse(line); } catch { return null; }
  const p = Detail.safeParse(json);
  return p.success ? { url, title: p.data.title, views: p.data.view_count, seconds: p.data.duration } : null;
}

/** Pure. Entries at or over `minViews` and not in `skip`, most views first, at most `limit`. */
export function chooseCandidates(entries: Entry[], want: ShortsWant = {}): Entry[] {
  return entries
    .filter((e) => e.views >= (want.minViews ?? 0) && !want.skip?.has(e.url))
    .sort((a, b) => b.views - a.views)
    .slice(0, want.limit ?? 15);
}

export interface ShortsOptions {
  bin?: string;
  count?: number;                         // entries read from the hashtag page; default 60
  timeoutMs?: number;                     // the list call; default 2 minutes
  detailTimeoutMs?: number;               // one detail call; default 1 minute
  onSkipped?: (query: string, skipped: number) => void;
}

/** Reads the hashtag's Shorts page, then asks for the details of the best candidates. Throws when the list call cannot run, times out, or fails with no usable line. */
export function createShorts(options: ShortsOptions = {}): Shorts {
  const bin = options.bin ?? 'yt-dlp';
  return {
    async search(query, want) {
      const tag = shortsTag(query);
      if (tag === '') return [];
      let r;
      try {
        r = await runProcess(bin, ['--ignore-config', ...listArgs(tag, options.count ?? 60)], { timeoutMs: options.timeoutMs ?? 120_000, killGroup: true, isolatedHome: true });   // what yt-dlp starts ends with it
      } catch (e) {
        if (e instanceof ExecError) throw new Error(`yt-dlp hashtag list failed (${e.code}): ${e.message}`);
        throw e;
      }
      const { entries, skipped: badLines } = parseListLines(r.stdout);
      if (r.code !== 0 && entries.length === 0) throw new Error(`yt-dlp exited ${r.code}: ${r.stderr.trim().slice(-300)}`);
      const candidates = chooseCandidates(entries, want);
      const cards: (Item | null)[] = new Array(candidates.length).fill(null);
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < candidates.length) {
          const i = next++;
          const url = candidates[i]!.url;
          try {
            const d = await runProcess(bin, ['--ignore-config', ...detailArgs(url)], { timeoutMs: options.detailTimeoutMs ?? 60_000, killGroup: true, isolatedHome: true });
            if (d.code === 0) cards[i] = parseDetail(d.stdout, url);
          } catch (e) {
            if (!(e instanceof ExecError)) throw e;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(DETAIL_PARALLEL, candidates.length) }, worker));
      const items = cards.filter((c): c is Item => c !== null);
      const skipped = badLines + (candidates.length - items.length);
      if (skipped > 0) options.onSkipped?.(query, skipped);
      return items;
    },
  };
}
