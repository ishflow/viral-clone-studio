// For the tests of this folder: a temp data dir with its database, the golden templates, and stand-ins that touch nothing outside.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { FakeClock, FakeDownloader, FakeLlm, FakeMedia, FakeRenderer, FakeTranscriber } from '../adapters/fakes.ts';
import type { Scripted } from '../adapters/fakes.ts';
import type { RunInput } from '../contracts.ts';
import * as candidates from '../db/candidates.ts';
import type { CandidateRow } from '../db/candidates.ts';
import { openDb } from '../db/open.ts';
import { claim, enqueue } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import type { CheckIssue, Cuts, MediaFacts, Word } from '../ports.ts';
import type { TemplateJson } from '../template/schema.ts';
import type { PlaceholderNeed, Placeholders } from './placeholders.ts';

export type GoldenId = 'layering-01' | 'lashly-01';
/** A golden template as it is written on disk: a fresh object each time. */
export const golden = (id: GoldenId): TemplateJson =>
  JSON.parse(readFileSync(new URL(`../resolve/golden/${id}/template.json`, import.meta.url), 'utf8')) as TemplateJson;

/** Writes a few bytes where a real one would write media, and remembers what it was asked for. */
export class FakePlaceholders implements Placeholders {
  calls: { needs: PlaceholderNeed[]; dir: string; canvas: { width: number; height: number; fps: number } }[] = [];
  async make(needs: PlaceholderNeed[], dir: string, canvas: { width: number; height: number; fps: number }): Promise<void> {
    this.calls.push({ needs, dir, canvas });
    for (const need of needs) {
      mkdirSync(dirname(join(dir, need.file)), { recursive: true });
      writeFileSync(join(dir, need.file), `placeholder ${need.kind}`);
    }
  }
}

export const tempDir = (name = 've-prepare-'): string => mkdtempSync(join(tmpdir(), name));

export const START = '2026-10-04T10:00:00.000Z';
export const SOURCE_URL = 'https://example.com/watch/1';
export const WORDS: Word[] = [
  { text: 'I', start: 0.2, end: 0.3 }, { text: 'layer', start: 0.3, end: 0.6 }, { text: 'these', start: 0.6, end: 0.8 }, { text: 'four', start: 0.8, end: 1 },
];
/** What the reference of a world measures: the length of the golden beats template, cut where its shots start. */
export const FACTS: MediaFacts = { width: 720, height: 1280, fps: 30, frames: 240, seconds: 8, audio: true };
export const CUTS: number[] = golden('layering-01').shots.slice(1).map((shot) => shot.at! / FACTS.fps);

export interface World {
  dataDir: string;
  db: DatabaseSync;
  clock: FakeClock;
  llm: FakeLlm;
  downloader: FakeDownloader;
  transcriber: FakeTranscriber;
  media: FakeMedia;
  renderer: FakeRenderer;
  placeholders: FakePlaceholders;
  /** A `running` run of this input, as the worker hands it to a handler. */
  run(input: RunInput): RunRow;
  /** A candidate row; `found`, from a scan, unless said otherwise. */
  candidate(over?: Partial<CandidateRow>): CandidateRow;
}

export interface WorldOptions {
  llm?: Scripted<unknown>;                                   // the answers of the model, in order
  words?: Word[];                                            // what the transcriber hears in every file
  checks?: Scripted<{ ok: boolean; issues: CheckIssue[] }>;  // the renderer's verdicts; default: every check passes
  download?: Scripted<{ file: string; title: string; seconds: number; views: number | null; likes: number | null }>;
  probes?: Scripted<MediaFacts>;                             // what the downloaded file measures; default: FACTS, every time
  cuts?: Scripted<number[] | Cuts>;                          // where its picture cuts (a plain list: hard cuts, no faint ones); default: CUTS, every time
  trims?: Scripted<MediaFacts>;                              // what a cut part of it measures; default: FACTS, every time
}

/** Fakes that answer every call of a preparation the same way, on a fresh data dir. */
export function world(options: WorldOptions = {}): World {
  const dataDir = tempDir();
  const db = openDb(join(dataDir, 'db.sqlite'));
  const clock = new FakeClock(START);
  const always = <T>(answer: T): Scripted<T> => ({ queue: Array.from({ length: 20 }, () => answer) });
  const downloaded = { file: join(dataDir, 'downloaded.mp4'), title: 'the best vanilla combo', seconds: 8, views: 1_900_000, likes: 191_800 };
  writeFileSync(downloaded.file, 'the reference video');
  let n = 0;
  return {
    dataDir, db, clock,
    llm: new FakeLlm(options.llm ?? []),
    downloader: new FakeDownloader(options.download ?? always(downloaded)),
    transcriber: new FakeTranscriber(always(options.words ?? WORDS)),
    media: new FakeMedia({ probes: options.probes ?? always(FACTS), stills: always(true), sheets: always({ seconds: [0.5, 1.5, 2.5, 3.5] }), cuts: options.cuts ?? always(CUTS), trims: options.trims ?? always(FACTS), writeFiles: true }),
    renderer: new FakeRenderer({ checks: options.checks ?? always({ ok: true, issues: [] }) }),
    placeholders: new FakePlaceholders(),
    run(input) {
      const ref = input.kind === 'prepare' || input.kind === 'edit' ? input.templateId : 'ref';
      enqueue(db, input, ref, null, clock.now());
      const run = claim(db, 'test-worker', clock.now());
      if (run === null) throw new Error('the run was not claimed');
      return run;
    },
    candidate(over = {}) {
      n += 1;
      const row: CandidateRow = {
        id: `c${n}`, scanId: null, source: 'topads', url: `${SOURCE_URL}?c=${n}`, title: 'the best vanilla combo', views: 1_900_000, likes: 191_800,
        seconds: 8, state: 'found', score: null, scoreNotes: null, image: null, foundAt: '', updatedAt: '', ...over,
      };
      candidates.upsert(db, row, clock.now());
      return candidates.get(db, row.id)!;
    },
  };
}
