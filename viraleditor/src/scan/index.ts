import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { insertNew, list as listCandidates } from '../db/candidates.ts';
import type { CandidateRow } from '../db/candidates.ts';
import { asOwner, enqueue, finish, stop } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { addQueued, begin, end, get as getScan, setChecked } from '../db/scans.ts';
import { readSettings, takeUsage } from '../db/settings.ts';
import type { Settings } from '../contracts.ts';
import type { Clock, Shorts, TopAds } from '../ports.ts';
import { filter } from './filter.ts';
import { shortsTag } from './shorts.ts';
import type { ScanCard } from './filter.ts';

export { filter } from './filter.ts';
export type { ScanCard } from './filter.ts';
export { createTopAds } from './topads.ts';
export { createShorts } from './shorts.ts';

export interface ScanDeps { db: DatabaseSync; topAds: TopAds; shorts: Shorts; clock: Clock }

/** YYYY-MM-DD in local time: the key of `usage`. */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Throws when the source cannot be read at all. Shorts: one failing query is skipped, all failing is a failure. */
async function fetchCards(deps: ScanDeps, source: 'topads' | 'shorts', settings: Settings, seen: ReadonlySet<string>): Promise<{ cards: ScanCard[]; inspected: number; noMatchingIndustry: boolean }> {
  if (source === 'topads') {
    const cards = await deps.topAds.cards(settings.topAdsCards, settings);
    return { cards: cards.map((c) => ({ source, url: c.url, title: c.title, seconds: c.seconds, views: null, likes: c.likes, image: null, video: c.video })), inspected: cards.inspected ?? cards.length, noMatchingIndustry: cards.industryMatched === 0 };
  }
  const out: ScanCard[] = [];
  let failures = 0;
  let lastError: unknown;
  const tags = new Set<string>();
  const searches = settings.searches.filter((q) => !tags.has(shortsTag(q)) && Boolean(tags.add(shortsTag(q))));   // two spellings of one tag: one search
  const skip = new Set(seen);                                                                    // grows: a video under two tags is fetched once
  for (const query of searches) {
    try {
      const found = await deps.shorts.search(query, { minViews: settings.shortsMinViews, skip: new Set(skip), limit: settings.perScan });
      for (const c of found) {
        if (skip.has(c.url)) continue;
        skip.add(c.url);
        out.push({ source, url: c.url, title: c.title, seconds: c.seconds, views: c.views, likes: null, image: null, video: null });
      }
    } catch (e) {
      failures += 1;
      lastError = e;
    }
  }
  if (searches.length > 0 && failures === searches.length) throw lastError;
  return { cards: out, inspected: out.length, noMatchingIndustry: false };
}

/** Prepare runs may be made again for a `found` candidate this many times in all; a `scored` one after this many failures. */
const MAX_PREPARE_RUNS = 3;
/**
 * The endings of a prepare run that say nothing about the candidate (the model's answer was not valid, the video could not be
 * fetched, a crash): worth another try. The others are the candidate's own and the same again on every try: `below-threshold`,
 * `unsupported` / `too-long` / `split-screen`, and `check-failed` (the model's two answers both failed the check, as they will
 * again): a scan never prepares those again, and a failed template row is not made a second time for the same video.
 */
const transient = (r: { state: string; note: string | null }): boolean =>
  r.state === 'stopped' || (r.state === 'done' && (r.note === 'llm-invalid' || r.note === 'source-unavailable'));

/**
 * Candidates a scan queues again, oldest first. Needs no prepare run that is queued, held or running, no template row of an
 * earlier run (a failed one stays in the site's inbox: a second run would write another beside it), and one of:
 * `found` with fewer than 3 prepare runs so far; or `scored` whose newest prepare run ended with the note `daily-cap`
 * (the prepare handler leaves it `scored` there; a newest note of `below-threshold` is final); or `scored` whose newest
 * prepare run ended in a transient failure, fewer than 3 of those so far. Past that it stays `scored`, in the site's inbox.
 */
function requeue(db: DatabaseSync): CandidateRow[] {
  const rows = db.prepare(
    `SELECT json_extract(input, '$.from.candidateId') AS candidate, state, json_extract(result, '$.note') AS note,
            EXISTS (SELECT 1 FROM templates t WHERE t.id = runs.ref) AS made
       FROM runs WHERE kind = 'prepare' AND json_extract(input, '$.from.kind') = 'candidate'
       ORDER BY created_at DESC, rowid DESC`,
  ).all() as { candidate: string | null; state: string; note: string | null; made: number }[];
  const byCandidate = new Map<string, { state: string; note: string | null; made: boolean }[]>();       // newest first
  for (const r of rows) {
    if (r.candidate === null) continue;
    const list = byCandidate.get(r.candidate) ?? [];
    list.push({ state: r.state, note: r.note, made: r.made === 1 });
    byCandidate.set(r.candidate, list);
  }
  const eligible = (c: CandidateRow): boolean => {
    const runs = byCandidate.get(c.id) ?? [];
    if (runs.some((r) => r.state === 'queued' || r.state === 'held' || r.state === 'running')) return false;
    if (runs.some((r) => r.made)) return false;
    if (c.state === 'found') return runs.length < MAX_PREPARE_RUNS;
    if (c.state !== 'scored' || runs[0] === undefined) return false;
    return runs[0].note === 'daily-cap' || (transient(runs[0]) && runs.filter(transient).length < MAX_PREPARE_RUNS);
  };
  return [...listCandidates(db, { state: 'found' }), ...listCandidates(db, { state: 'scored' })]
    .filter(eligible)
    .sort((a, b) => (a.foundAt < b.foundAt ? -1 : a.foundAt > b.foundAt ? 1 : a.id < b.id ? -1 : 1));
}

/** Handles one `scan` run: one source, one `scans` row (id = run.ref). */
export function scanHandler(deps: ScanDeps): (run: RunRow) => Promise<void> {
  const { db, clock } = deps;
  return async (run) => {
    if (run.input.kind !== 'scan') throw new Error(`scan handler got a ${run.input.kind} run`);
    const source = run.input.source;
    const scanId = run.ref;
    const settings = readSettings(db);
    begin(db, scanId, source, clock.now());

    try {
      const seen = new Set(listCandidates(db).map((c) => c.url));
      let fetched: Awaited<ReturnType<typeof fetchCards>>;
      try {
        fetched = await fetchCards(deps, source, settings, seen);
      } catch (error) {
        console.error('scan source failed:', source, error instanceof Error ? error.message : error);   // the only place the cause is kept: the scan itself records `source-unavailable` alone
        const now = clock.now();
        end(db, scanId, 'stopped', 'source-unavailable', now);
        asOwner({ runId: run.id, workerId: run.claimedBy ?? '', refused: null }, () => stop(db, run.id, 'source-unavailable', null, now));
        return;
      }
      const { cards, inspected, noMatchingIndustry } = fetched;
      setChecked(db, scanId, inspected);

      const fresh = filter(cards, settings, seen);

      // Queue the preparation of one candidate, if the day still has room (`score` counts candidates sent on, cap `dailyCandidates`).
      const queue = (c: CandidateRow): boolean => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const ok = takeUsage(db, 'score', localDay(clock.now()), settings.dailyCandidates);
          if (ok) {
            const templateId = randomUUID();
            enqueue(db, { kind: 'prepare', templateId, ownerId: null, from: { kind: 'candidate', candidateId: c.id, force: false } }, templateId, null, clock.now());
            addQueued(db, scanId);
          }
          db.exec('COMMIT');
          return ok;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      };
      let roomLeft = true;
      for (const c of requeue(db)) {
        if (!(roomLeft = queue(c))) break;
      }
      for (const card of fresh) {
        const row: CandidateRow = {
          id: randomUUID(), scanId, source: card.source, url: card.url, title: card.title, views: card.views, likes: card.likes,
          seconds: card.seconds, state: 'found', score: null, scoreNotes: null, image: card.image, video: card.video, foundAt: '', updatedAt: '',
        };
        if (!insertNew(db, row, clock.now())) continue;                    // another writer recorded this URL while the source was read
        if (roomLeft) roomLeft = queue(row);
      }

      // aboveThreshold and prepared are written onto the scans row later, by the prepare runs: here they are what the row says now (mostly 0)
      const scan = getScan(db, scanId);
      end(db, scanId, 'done', noMatchingIndustry ? 'no-matching-industry' : null, clock.now());
      asOwner({ runId: run.id, workerId: run.claimedBy ?? '', refused: null }, () => finish(db, run.id, { kind: 'scan', checked: inspected, aboveThreshold: scan?.aboveThreshold ?? 0, prepared: scan?.prepared ?? 0 }, clock.now()));
    } catch (e) {
      // Internal failures must not be misreported as a source outage.
      try { end(db, scanId, 'stopped', 'scan-failed', clock.now()); } catch { /* the original error matters more */ }
      throw e;
    }
  };
}
