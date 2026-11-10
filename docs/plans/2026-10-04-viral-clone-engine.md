# Viral Clone Production System Implementation Plan

> 2026-10-04: Tasks 2, 4 and 6, and the contracts `ports.ts`, `operations`, `Health` are replaced by `docs/plans/2026-10-04-viraleditor-revision.md`. The project folder is `viraleditor/`. A run is handed over `held` (below).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The controller dispatches one implementer per task, wave by wave; tasks inside a wave run at the same time and own disjoint folders.

| Dalga | Aynı anda çalışan görevler | Ajan |
|---|---|---|
| 0 | 1 Temel: `viraleditor/` iskeleti, veritabanı şeması, sözleşmeler | 1 |
| 1 | 2 `compose` + iki altın örnek · 3 kuyruk + worker · 4 Hypit / ses / LLM bağlayıcıları + sahte sağlayıcı · 5 sitede motor arayüzü + kalıcılık | 4 |
| 2 | 6 üretim hattı · 7 şablon hazırlama · 8 tarama · 9 sitenin SQLite bağlayıcısı + görsel yükleme | 4 |
| 3 | 10 başlangıç verisi (iki şablon, 10 aday) · 11 yönetim ekranı düğmeleri · 12 zamanlayıcı + `launchd` + çalışma kılavuzu | 3 |
| 4 | 13 uçtan uca deneme (sahte sağlayıcı) + bütün kodun gözden geçirmesi | 1 |
| kapı | 14 gerçek kredili deneme: yalnız sahip | — |

---

**Goal:** Replace the time-based fake behind the site's catalog, job runner, inbox, scans and settings with the real production system (template → compose → produce → mp4) running on this Mac as a worker process, with every paid step counted, confirmed and never resubmitted.

**Architecture:** A new project `viraleditor/` (TypeScript, run by Node directly) owns the production system: template schema, `compose`, the produce / prepare / scan pipelines, a SQLite queue and a worker. The site (`web/`) and the worker share **no code**: they talk through `data/db.sqlite` and files under `data/`, whose shapes are fixed in this plan (`viraleditor/schema.sql` and `viraleditor/src/contracts.ts`). Inside the site, a narrow synchronous `Engine` interface replaces the places where today's fakes simulate production by elapsed time; the fake engine keeps today's behaviour for tests, the SQLite engine reads and writes the shared database. Accounts, credits, payments and email stay the plan A fakes, made durable by a snapshot file.

**Tech Stack:** Node 25 (runs `.ts` directly: erasable syntax only), `node:sqlite` (built in), Zod, Vitest, Playwright (system Chrome), pnpm. External programs already on this Mac: `hypit` 0.2.17 (through `bin/hk`), `bin/magnific.py`, `yt-dlp`, `ffmpeg` / `ffprobe`, `claude` CLI.

**Spec:** `docs/specs/2026-10-03-galeri-sitesi-design.md` §4–§7, §9–§12 (part B). The site plan: `docs/plans/2026-10-04-viral-clone-site.md`.

## Global Constraints

- **No `git commit`, no push, no deploy, no `launchctl`.** End of task: `git add -A <the paths the task owns>` and paste `git diff --cached --stat -- <those paths>` in the report. The owner decides about commits.
- **No paid request, ever, in this plan.** Nothing calls Magnific, the Claude API or a payment provider. `bin/hk build` runs only with the fake endpoint of Task 4. The real endpoint is selected only by `VC_PROVIDER=magnific`, which no task, test, script or plist in this plan sets. `hypit check` and `hypit plan` are free and offline (verified 2026-10-04) and may be used freely.
- **No secrets** in any file or log. The key is read only by the existing `bin/hk` and `bin/magnific.py`, from the environment.
- **LLM:** only through `viraleditor/src/llm` (`claude -p`, the subscription on this Mac). Unit tests use `FakeLlm`. A test that would start the real CLI is marked `it.skipIf(!process.env.VC_LIVE_LLM)`.
- **Dependencies:** only the ones Task 1 installs. Need another one: do not add it; say so in the report.
- **Files outside your task:** do not edit. The frozen files after Task 1 are `viraleditor/schema.sql`, `viraleditor/src/contracts.ts`, `viraleditor/src/ports.ts`, `viraleditor/src/paths.ts`, `viraleditor/package.json`, `viraleditor/tsconfig.json`; after Task 5 also `web/src/data/ports.ts`, `web/src/data/engine/port.ts`, `web/src/data/index.ts`. A change you need there: describe it in the report under "Contract change request"; the controller applies it between waves.
- **Read-only inputs:** `productions/**`, `references/**`, `.hypit/**`, `packages/provider-magnific/**`, `bin/**`, `docs/design/**`. They hold paid takes and the golden sources.
- **Engine code:** erasable TypeScript only (no `enum`, no parameter properties, no namespaces), relative imports with the `.ts` extension, no path alias, ESM. One responsibility per file. Every function that touches the outside world (process, network, clock, file system outside the data dir) goes through an interface from `viraleditor/src/ports.ts` so tests replace it.
- **Site code (unchanged rules of the site plan):** `features/X` ↛ `features/Y`; `shared` ↛ `features`, `data`; `data` ↛ `shared` (enforced by `web/src/layers.test.ts`); copy only in `web/src/messages/{en,tr}/<ns>.json` with the same keys; money `null` → the board's placeholder; no vendor or model names in customer copy; an action that changes a balance ends with `refreshShell()`; admin pages and actions call `requireAdmin()` first; every charge is bound to the confirmed amount.
- **Reasons are machine codes** (list below). The site translates them; an unknown code shows the generic message.
- **Data directory:** `data/` at the repo root (`VC_DATA_DIR` overrides it), git-ignored, never inside `web/`. Tests use a temp dir (`mkdtempSync`) and never the real one.
- **Parallel work:** several tasks run at the same time in the same checkout. Own dev server: `NEXT_DIST_DIR=.next-b<task> pnpm dev -p 32<task two digits>`. If `next dev` edits `web/tsconfig.json` or `web/next-env.d.ts`, leave them and say so in the report; the controller restores them.
- **Sandbox:** `rm` and `kill` are denied. A background server is stopped by the controller. Do not start more than one.

## Review Focus

1. **The worker dies between "request sent" and "answer stored"** → after restart the run goes on from the recorded step and that request is not sent again; if its fate is unknown the run stops with `submission-unknown`. (Task 3 claim / recovery tests; Task 6 operation-before-send test.)
2. **The plan wants more paid requests than the customer confirmed** (template edited after the confirmation, a variant count that does not match) → the run stops with `estimate-exceeded` before anything is sent. (Task 6.)
3. **The site restarts while a job runs** → the job, its charge and the balance are still there, and the job page continues from the database. (Task 5 snapshot test; Task 13.)
4. **A customer uploads something that is not an image, is too large, or has a hostile file name** → refused with a field error; stored names are generated; nothing outside `data/uploads` is written or served. (Task 9.)
5. **The LLM returns text that is not the asked JSON** → one more request, then the step fails with `llm-invalid`; a daily cap that is reached leaves the rest for tomorrow instead of failing. (Task 4, Task 7.)
6. **A template that fails its check, or a private template of another user** → never in the gallery, never served by `/media`, never usable for a job. (Task 7, Task 9.)
7. **Two confirmations of the same form, or two workers** → one run, claimed once. (Task 3, Task 9.)

---

## Contracts (fixed here; Task 1 writes them to files verbatim)

### Data directory

```
data/
  db.sqlite                     the queue and the engine's tables (WAL); the worker migrates it, the site reads and writes rows
  site.json                     snapshot of the site store (written only by the site)
  uploads/<uploadId>/<n>.<ext>  product images a customer uploaded (written only by the site)
  sources/<id>/                 source.mp4, transcript.json, sheet.jpg, meta.json   (id = candidate id or template id)
  templates/<id>/               template.json, poster.jpg, sample.mp4, check.json
  jobs/<runId>/                 fill.json, v<k>/index.html, v<k>/timeline.json, v<k>/assets/*, v<k>/final.mp4, v<k>/poster.jpg
```

Paths stored in the database are relative to `data/` and use `/`.

### `viraleditor/schema.sql`

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('produce','prepare','scan','edit')),
  ref         TEXT NOT NULL,                 -- produce: the site's job id · prepare, edit: template id · scan: scan id
  state       TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','stopped')),
  input       TEXT NOT NULL,                 -- JSON: RunInput of the kind
  approved    TEXT,                          -- produce: JSON Paid, every paid request the customer has confirmed so far
  sent        TEXT,                          -- produce: JSON Paid, every paid request submitted so far (the worker counts)
  missing     TEXT,                          -- produce, when stopped: JSON Paid a resume would have to pay for
  steps       TEXT NOT NULL DEFAULT '[]',    -- produce: JSON Step[]
  result      TEXT,                          -- JSON: RunResult of the kind, when done
  reason      TEXT,                          -- machine code, when stopped
  claimed_by  TEXT,
  heartbeat   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_once ON runs (kind, ref) WHERE kind IN ('produce','scan');
CREATE INDEX IF NOT EXISTS runs_queue ON runs (state, created_at);

CREATE TABLE IF NOT EXISTS operations (     -- one row per paid request, written BEFORE the request is sent
  run_id        TEXT NOT NULL REFERENCES runs(id),
  key           TEXT NOT NULL,              -- 'v1:build', 'v1:music', 'v1:voice:<segment>'
  kind          TEXT NOT NULL CHECK (kind IN ('build','music','voice')),
  state         TEXT NOT NULL CHECK (state IN ('pending','done','failed','unknown')),
  external_id   TEXT,                       -- Hypit build id, or the provider task id
  output        TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (run_id, key)
);

CREATE TABLE IF NOT EXISTS templates (
  id              TEXT PRIMARY KEY,
  state           TEXT NOT NULL CHECK (state IN ('preparing','ready','failed','published','hidden')),
  owner           TEXT,                     -- site user id of a private template; NULL for the shared catalog
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('topads','shorts','link','upload','seed')),
  source_url      TEXT,
  note            TEXT,                     -- machine code, when failed
  card            TEXT NOT NULL,            -- JSON Card: everything the site shows
  estimate        TEXT,                     -- JSON Paid for ONE variant; NULL until ready
  minutes         INTEGER,                  -- minutes one variant takes
  times_generated INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id          TEXT PRIMARY KEY,
  scan_id     TEXT,
  source      TEXT NOT NULL CHECK (source IN ('topads','shorts','manual')),
  url         TEXT NOT NULL UNIQUE,         -- the dedupe key across scans
  title       TEXT NOT NULL,
  views       INTEGER,
  likes       INTEGER,
  seconds     REAL NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('found','scored','unsupported','rejected','prepared')),
  score       INTEGER,
  score_notes TEXT,
  image       TEXT,
  found_at    TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('topads','shorts')),
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  checked         INTEGER NOT NULL DEFAULT 0,
  above_threshold INTEGER NOT NULL DEFAULT 0,
  prepared        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK (status IN ('running','done','stopped')),
  reason          TEXT
);

CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);   -- JSON Settings
CREATE TABLE IF NOT EXISTS health   (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);   -- JSON Health, written by the worker
CREATE TABLE IF NOT EXISTS usage (
  day   TEXT NOT NULL,                      -- YYYY-MM-DD, local time
  kind  TEXT NOT NULL CHECK (kind IN ('score','prepare')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
```

### `viraleditor/src/contracts.ts` (types of the JSON columns; the site keeps its own copy in `web/src/data/real/rows.ts`)

```ts
export type Quality = 'fast' | 'best';
export type Format = 'no-talking' | 'talking';
export type StepKey = 'adaptation' | 'images' | 'clips' | 'music' | 'edit' | 'render';
export type StepStatus = 'waiting' | 'running' | 'done' | 'stopped';
export interface Step { key: StepKey; status: StepStatus; done: number; total: number }

/** Paid requests. `clipSeconds` is what the provider bills (a clip shorter than 4 s bills 4 s). */
export interface Paid { images: number; clips: number; clipSeconds: number; music: number; voice: number }

export interface CardShot { n: number; from: number; to: number; action: string; text: string; product: number | null }
export interface Card {
  title: string; category: string; format: Format; seconds: number; referenceViews: string;
  image: string | null; video: string | null;          // paths under data/, null until there is a poster / a sample
  products: number; shots: CardShot[]; description: string; tags: string[];
}

export interface Product { name: string; description: string; images: string[] }   // images: paths under data/uploads
export type RunInput =
  | { kind: 'produce'; templateId: string; quality: Quality; variants: 1 | 2 | 3; language: string; products: Product[]; sample: boolean }
  | { kind: 'prepare'; templateId: string; ownerId: string | null; from: { kind: 'link'; url: string } | { kind: 'candidate'; candidateId: string; force: boolean } }
  | { kind: 'scan'; source: 'topads' | 'shorts'; trigger: 'schedule' | 'manual' }
  | { kind: 'edit'; templateId: string; card: Pick<Card, 'title' | 'category' | 'products' | 'shots' | 'description' | 'tags'> };
export type RunResult =
  | { kind: 'produce'; variants: { video: string; image: string }[] }
  | { kind: 'prepare'; state: 'ready' | 'failed'; note: string | null }
  | { kind: 'scan'; checked: number; aboveThreshold: number; prepared: number }
  | { kind: 'edit'; ok: boolean; note: string | null };

export type StopReason =
  | 'adaptation-failed' | 'images-failed' | 'clips-failed' | 'audio-failed' | 'render-failed'
  | 'submission-unknown' | 'estimate-exceeded' | 'llm-invalid' | 'template-missing' | 'engine-error';
export type PrepareNote = 'below-threshold' | 'unsupported' | 'split-screen' | 'too-long' | 'check-failed' | 'source-unavailable' | 'llm-invalid' | 'daily-cap';
export type ScanReason = 'source-unavailable';

export interface Settings {
  scanTimes: string[];                                   // 'HH:MM', local time; default ['09:00','15:00','21:00']
  sources: { topads: boolean; shorts: boolean };         // default both true
  searches: string[];                                    // Shorts search list; default []
  threshold: number;                                     // 0–100; default 70
  dailyCandidates: number;                               // default 45
  dailyTemplates: number;                                // default 10
  secondsMin: number; secondsMax: number;                // default 6, 35
  shortsMinViews: number;                                // default 500000
  topAdsCards: number;                                   // default 30
  perScan: number;                                       // default 15
  tiers: Record<Quality, { model: string; resolution: string }>;   // default fast: seedance-2-mini 720p · best: seedance-2.5-pro 1080p
}
export interface Health { workerAt: string; provider: 'fake' | 'magnific'; hypit: 'ready' | 'not-ready'; note: string | null }
```

### `viraleditor/src/ports.ts` (everything the engine does to the outside world)

```ts
import type { z } from 'zod';

export interface PlanFacts { ok: boolean; providerRequests: number; localRequests: number; byCapability: Record<string, number>; issues: string[] }
export interface BuildProgress { images: { done: number; total: number }; clips: { done: number; total: number }; rendering: boolean }
export interface BuildEnd { buildId: string; outcome: 'succeeded' | 'failed' | 'unknown'; failure: { code: string; message: string } | null }

export interface Hypit {
  check(source: string): Promise<{ ok: boolean; issues: string[] }>;
  plan(run: string): Promise<PlanFacts>;
  build(run: string, onStart: (buildId: string) => void, onProgress: (p: BuildProgress) => void): Promise<BuildEnd>;
  attach(buildId: string, onProgress: (p: BuildProgress) => void): Promise<BuildEnd>;   // follow a build started before a restart
  get(buildId: string, output: string, to: string): Promise<void>;
  transcribe(media: string, to: string): Promise<void>;
  tile(media: string, transcript: string | null, to: string): Promise<void>;
  doctor(): Promise<{ ready: boolean; note: string | null }>;
}
export interface Audio {                                   // bin/magnific.py: outside Hypit, so `hypit plan` does not count these
  music(prompt: string, to: string): Promise<{ taskId: string }>;
  voice(text: string, voiceId: string, to: string): Promise<{ taskId: string }>;
}
export interface Llm { run<T>(request: { prompt: string; files: string[]; schema: z.ZodType<T> }): Promise<T> }   // throws LlmInvalid after one retry
export interface Downloader { video(url: string, toDir: string): Promise<{ file: string; title: string; seconds: number; views: number | null; likes: number | null }> }
export interface TopAds { cards(limit: number): Promise<{ url: string; title: string; likes: number; seconds: number; video: string }[]> }
export interface Shorts { search(query: string): Promise<{ url: string; title: string; views: number; seconds: number }[]> }
export interface Clock { now(): Date }
export class LlmInvalid extends Error {}
```

### Rules every task relies on

- **Paid counting.** Images and clips are made inside `hypit build` (the Magnific provider); music and voice by `bin/magnific.py`. Before a build: `sent + plan.providerRequests + audio still to send ≤ approved`, else stop with `estimate-exceeded`. An `operations` row in state `pending` is written before a build or an audio request starts; on restart a `pending` build with an `external_id` is attached to, a `pending` row without one becomes `unknown` and the run stops with `submission-unknown`.
- **Resume.** The site sets `approved = approved + missing`, `state = 'queued'`. The worker goes on from the first step that is not `done`; a new build reuses the finished outputs of the stopped build (as `productions/lashly-01/runs/main-v2.svrun` does).
- **Who writes what.** The site inserts `runs`, updates `runs.approved/state` on resume, updates `templates.state/times_generated`, `candidates.state` (reject), `settings`. The worker writes everything else. Every write is one statement or one `BEGIN IMMEDIATE` transaction. The site inserts a run in state `held` and sets `held` → `queued` only after its own store is on disk (`Engine.committed()`); on resume it sets `approved = approved + missing` and `state = 'held'`, leaves `missing` as it is, and releases the same way. When the site process starts, every `held` run is an orphan: one that never ran (`missing IS NULL`, no `operations` row) is deleted, one that was resumed gets `approved = approved − missing` and `state = 'stopped'`.
- **Template rows.** For a customer's link the site inserts the row (`preparing`, the owner set, a card with the URL as title) together with the `prepare` run. For a candidate the worker inserts the row, and only once the score passes the threshold or the run says `force: true` (an admin pressed "prepare").
- **Admin edits.** The site writes the edited `card` at once (the admin sees the change) and enqueues an `edit` run. The worker applies it to `template.json` and checks it; when the check fails it writes back the card of the unchanged `template.json` and sets `note = 'check-failed'`.
- **Queue claim.** `UPDATE runs SET state='running', claimed_by=?, heartbeat=? WHERE id = (SELECT id FROM runs WHERE state='queued' ORDER BY created_at LIMIT 1) RETURNING *`. A `running` run whose heartbeat is older than 60 s belongs to a dead worker and is taken over. A `held` run is never claimed and never taken over.
- **Concurrency.** One render at a time; paid requests at most 3 at a time (Hypit's runtime profile already says 3); `prepare` and `scan` runs never run while a `produce` run waits.

---

## File Structure

```
viraleditor/
  package.json  tsconfig.json  vitest.config.ts  schema.sql
  src/
    contracts.ts  ports.ts  paths.ts          Task 1 (frozen afterwards)
    template/     schema.ts  estimate.ts  card.ts          Task 1 writes, Task 2 owns
    compose/      beats.ts  speech.ts  styles.ts  run.ts  index.ts  golden/     Task 2
    db/           open.ts (Task 1)  runs.ts  templates.ts  candidates.ts  settings.ts   Task 3
    worker/       loop.ts  claim.ts  main.ts  schedule.ts                      Task 3 (schedule.ts: Task 12)
    adapters/     hypit.ts  audio.ts  llm.ts  downloader.ts  fakes.ts          Task 4
    produce/      adapt.ts  audio.ts  build.ts  resume.ts  index.ts            Task 6
    prepare/      read.ts  score.ts  write.ts  check.ts  edit.ts  index.ts     Task 7
    scan/         topads.ts  shorts.ts  filter.ts  index.ts                    Task 8
    seed/         index.ts                                                     Task 10
packages/provider-fake/                        a Hypit provider that returns canned media and counts requests   Task 4
hypit.runtime.fake.json                        runtime profile bound to the fake endpoint                       Task 4
docs/reference/hypit-notes.md                  facts about plan / status / reuse, with captured JSON             Task 4
ops/launchd/*.plist  docs/runbook.md                                                                            Task 12
web/src/data/
  ports.ts                 Task 5 (additions listed there; frozen afterwards)
  engine/port.ts           the `Engine` interface                    Task 5
  engine/fake.ts           today's time-based behaviour              Task 5
  mock/persist.ts          snapshot of the site store                Task 5
  real/rows.ts  real/sqlite-engine.ts  real/uploads.ts               Task 9
web/src/app/media/[...path]/route.ts                                 Task 9
web/e2e/real/*.spec.ts                                               Task 13
```

## Execution model

- **Waves.** A wave starts when every task of the wave before it has passed its review. Inside a wave the controller dispatches all implementers in one message.
- **Ownership.** A task edits only the paths in its **Files** block. Two tasks of one wave never list the same path.
- **Each task:** implementer (fresh subagent) → spec review → code-quality review → fixes (at most 5 rounds, then a more capable model) → controller checks the gates itself. Reports go to `.superpowers/sdd/2026-10-04-viral-clone-engine/task-<N>-report.md`; the ledger is `progress.md` in that folder; every decision made without the owner is a `Ruling:` line there.
- **Model:** Tasks 2, 5, 6, 7 on the most capable model (they carry the design risk); the others on the standard one.
- **Gates of a task:** engine tasks `cd viraleditor && pnpm typecheck && pnpm test`; site tasks `cd web && pnpm lint && pnpm typecheck && pnpm test`, plus `pnpm e2e --grep-invert sweep` for Tasks 5, 9, 11.

### Common recipe (every task)

- [ ] Read the spec sections and the files the task names. Engine tasks also read `docs/reference/hypit-notes.md` once Task 4 has written it.
- [ ] Write the tests of the task's **Tests** list first; run them; see them fail for the right reason.
- [ ] Implement the smallest code that passes; keep every outside effect behind `ports.ts`.
- [ ] Run the task's gates until clean.
- [ ] `git add -A <owned paths>`; write the report: files, tests and what each proves, TDD evidence, contract change requests, concerns. Reply with status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), one line of test numbers, concerns, report path.

---

## Wave 0

### Task 1: Foundation — project, schema, contracts

**Files:** Create `viraleditor/package.json`, `viraleditor/tsconfig.json`, `viraleditor/vitest.config.ts`, `viraleditor/schema.sql`, `viraleditor/src/{contracts,ports,paths}.ts`, `viraleditor/src/template/{schema,estimate,card}.ts` and their tests, `viraleditor/src/db/open.ts` + test. Modify `.gitignore` (add `data/`), `web/package.json` (`@types/node` to `^24`).

**Interfaces — produces:**
- `schema.sql`, `contracts.ts`, `ports.ts` exactly as in "Contracts" above.
- `paths.ts`: `dataDir(): string` (`VC_DATA_DIR` or `<repo>/data`), `rel(...parts): string` (path under the data dir), `abs(relative): string` (throws on a path that leaves the data dir).
- `db/open.ts`: `openDb(file?: string): DatabaseSync` — creates the folder, runs `schema.sql`, returns the connection.
- `template/schema.ts`: `Template` (Zod) for spec §5, `Fill` (Zod), and the types `TemplateJson`, `FillJson`:

```ts
import { z } from 'zod';

const Box = z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });   // percent of the canvas
const Style = z.object({ font: z.string(), weight: z.number(), size: z.number(), align: z.enum(['left', 'center', 'right']), fill: z.string(), shadows: z.array(z.string()) });
const Shot = z.object({
  id: z.string(), at: z.number().int().min(0).optional(), for: z.number().int().positive().optional(), segment: z.string().optional(),
  products: z.array(z.string()), still_prompt: z.string().min(1), motion_prompt: z.string().min(1), clip_seconds: z.number().positive(),
  action: z.string().min(1),                              // one short sentence a person reads on the site; never the prompt
});
const Text = z.object({
  id: z.string(), at: z.number().int().min(0).optional(), for: z.number().int().positive().optional(), mark: z.string().optional(),
  box: Box, style: z.string(), copy: z.string(), source_copy: z.string(),
});
export const Template = z.object({
  id: z.string(),
  source: z.object({ kind: z.enum(['topads', 'shorts', 'link', 'upload', 'seed']), url: z.string(), metrics: z.object({ views: z.number(), likes: z.number(), ctr_band: z.string() }) }),
  title: z.string().min(1), description: z.string(), category: z.string(), tags: z.array(z.string()),
  mode: z.enum(['beats', 'speech']),
  canvas: z.object({ width: z.number().int(), height: z.number().int(), fps: z.number().int() }),
  products: z.object({ min: z.number().int().min(1), max: z.number().int().max(5) }),
  people: z.enum(['none', 'hands', 'face']),
  shots: z.array(Shot).min(1), texts: z.array(Text), styles: z.record(z.string(), Style),
  audio: z.object({ music: z.object({ prompt: z.string().min(1), gain: z.number() }) }),
  script: z.object({ segments: z.array(z.object({ id: z.string(), lines: z.string(), action: z.string(), seconds: z.number().positive() })) }).optional(),
  presenter: z.object({ still_prompt: z.string(), voice: z.object({ voice_id: z.string(), sample_text: z.string() }) }).optional(),
  cards: z.array(z.object({ selection: z.string(), image: z.string(), box: Box })).optional(),
  captions: z.object({ style: z.literal('word-by-word') }).optional(),
}).superRefine((t, ctx) => {
  const beats = t.mode === 'beats';
  for (const [i, shot] of t.shots.entries()) {
    if (beats ? shot.at === undefined || shot.for === undefined : !shot.segment) ctx.addIssue({ code: 'custom', path: ['shots', i], message: beats ? 'beats shot needs at and for' : 'speech shot needs segment' });
  }
  if (!beats && (!t.script || !t.presenter)) ctx.addIssue({ code: 'custom', path: ['script'], message: 'speech template needs script and presenter' });
});
export const Fill = z.object({
  language: z.string(),
  products: z.array(z.object({ name: z.string(), images: z.array(z.string()).min(1) })).min(1),
  texts: z.record(z.string(), z.string()),                                                   // text id → final copy
  shots: z.record(z.string(), z.object({ still_prompt: z.string(), motion_prompt: z.string() })),
  music: z.object({ prompt: z.string() }),
  script: z.record(z.string(), z.string()).optional(),                                       // segment id → lines
});
export type TemplateJson = z.infer<typeof Template>;
export type FillJson = z.infer<typeof Fill>;
```

- `template/estimate.ts`: `paidFor(template: TemplateJson, variants: number): Paid` — per variant: `images = shots.length (+1 when there is a presenter)`, `clips = shots.length`, `clipSeconds = Σ max(4, ceil(clip_seconds))`, `music = 1`, `voice = presenter ? 1 : 0`; times `variants`. `minutesFor(template): number` — `ceil(2 + shots.length × 1 + (mode === 'speech' ? 5 : 1))`.
- `template/card.ts`: `cardOf(template: TemplateJson, media: { image: string | null; video: string | null }): Card` — `seconds` from the last frame / fps (beats) or the sum of segment seconds (speech); one `CardShot` per shot (`from` / `to` in seconds, `action` = the shot's `action`, `text` = the copy of the text that overlaps the shot, `product` = the first numbered product ≥ 1 or `null`); `format` = `talking` for speech; `products` = `template.products.min`; `description` = the template's; `referenceViews` = the views in the compact form the site shows (`1900000` → `1.9M`, `500000` → `500K`, `0` → `''`).

**Tests:** the schema accepts the spec §5 example with one shot, refuses a beats shot without `at`, a speech template without `script`, a template with no shots; `paidFor` for a 5-shot beats template (5 images, 5 clips, 20 clip seconds when every clip is ≤ 4 s, 1 music, 0 voice) and ×3 variants; a clip of 6.2 s bills 7; `cardOf` seconds and shot ranges; `openDb` on a temp file creates every table and is idempotent; `abs('../x')` throws.

- [ ] Write `viraleditor/package.json` by hand (`"type": "module"`; scripts `test: vitest run`, `typecheck: tsc --noEmit`, `worker: node src/worker/main.ts`, `seed: node src/seed/index.ts`; dependencies `zod@^4`, `playwright-core@^1` (Task 8 drives the installed Chrome with it); devDependencies `vitest@^5`, `typescript@^5`, `@types/node@^24`), `tsconfig.json` (`strict`, `noEmit`, `module: nodenext`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`), then `cd viraleditor && pnpm install`.
- [ ] Follow the common recipe for the files above. In `web`: `pnpm add -D @types/node@^24`, then `pnpm typecheck && pnpm test` must stay green.

---

## Wave 1 (four tasks at the same time)

### Task 2: `compose` and the two golden templates

**Files:** `viraleditor/src/compose/**`, `viraleditor/src/template/**` (owner from now on), `viraleditor/src/compose/golden/{layering-01,lashly-01}/{template.json,fill.json}`.
**Reads:** `productions/layering-01/authors/{main.svml,recipes.svs}`, `productions/layering-01/runs/{main.svrun,main-kling.svrun}`, `productions/lashly-01/authors/{main.svml,recipes.svs}`, `productions/lashly-01/runs/{main.svrun,main-v2.svrun}`, spec §5, §6, §10.
**Interfaces — consumes:** `Template`, `Fill`. **Produces:** `compose(template: TemplateJson, fill: FillJson, options: { quality: Quality; tier: { model: string; resolution: string }; assets: { music: string; voice: Record<string, string> }; reuse: { buildId: string } | null }): { 'authors/main.svml': string; 'authors/recipes.svs': string; 'runs/main.svrun': string }` — a pure function: same input, same text.
**Tests:**
- Golden: write `template.json` + `fill.json` for both productions by hand from the existing author files; `compose` output written to a temp folder passes `hypit check`; `hypit plan --json` on it gives the same `providerRequestCount` as the original run (`layering-01/runs/main.svrun`, `lashly-01/runs/main.svrun`). These two tests run the real `hypit` binary (free, offline) and are skipped when it is missing.
- The three Hypit 0.2.17 workarounds are in the output: no exit animation; two shadows instead of `typo:Stroke`; one `Area` per text line (assert on the generated text).
- A text of three lines becomes three areas; a `{product}` left in a prompt after filling → throws `unfilled:<placeholder>`; a rival brand name is never copied from `source_copy` into the output (only `fill.texts` is used).
- `reuse` set → the run file satisfies finished outputs from that build the way `main-v2.svrun` does.
- Unsupported structures (a text box outside 0–100, a shot longer than 15 s, total over 60 s) → `ComposeError` with a code.

### Task 3: Queue, repositories, worker loop

**Files:** `viraleditor/src/db/{runs,templates,candidates,settings}.ts`, `viraleditor/src/worker/{claim,loop,main}.ts` (+ tests). Not `db/open.ts`.
**Interfaces — produces:**
- `runs.ts`: `RunRow` (a `runs` row with its JSON columns parsed), `enqueue(db, input: RunInput, ref: string, approved: Paid | null): string`, `claim(db, workerId: string, now: Date): RunRow | null`, `beat(db, id, now)`, `setSteps(db, id, steps: Step[])`, `addSent(db, id, paid: Partial<Paid>)`, `finish(db, id, result: RunResult)`, `stop(db, id, reason: StopReason | PrepareNote | ScanReason, missing: Paid | null)`, `operation(db, runId, key)`, `beginOperation(db, runId, key, kind)`, `endOperation(db, runId, key, patch)`.
- `templates.ts`, `candidates.ts`, `settings.ts`: `get`, `list`, `upsert`, `setState`; `settings.ts`: `readSettings(db): Settings` returns the defaults of `contracts.ts` when the row is missing, `takeUsage(db, kind: 'score' | 'prepare', day: string, cap: number): boolean` (atomic: false when the cap is reached).
- `worker/loop.ts`: `runWorker(deps: { db; handlers: Record<RunInput['kind'], (run: RunRow) => Promise<void>>; clock: Clock; workerId: string; idleMs: number }): { stop(): Promise<void> }` — claims, runs the handler, beats every 15 s, writes `health` every 30 s; a handler that throws stops the run with `engine-error`.
**Tests:** two `claim` calls on one queued run → one gets it; a `running` run with a 61-second-old heartbeat is taken over, a 30-second-old one is not; `prepare` / `scan` are not claimed while a `produce` run is queued; `beginOperation` twice with the same key → the second returns the existing row, no new row; `takeUsage` stops at the cap and starts again the next day; a throwing handler → `stopped` + `engine-error`, and the loop goes on with the next run; `stop()` waits for the running handler.

### Task 4: Adapters, facts about Hypit, the fake provider

**Files:** `viraleditor/src/adapters/**`, `packages/provider-fake/**`, `hypit.runtime.fake.json`, root `package.json` + `package-lock.json` (only to register the fake provider next to `@viral-clone/provider-magnific`), `docs/reference/hypit-notes.md`, `docs/reference/fixtures/*.json`.
**Reads:** `packages/provider-magnific/**` (how a provider is written and tested), `hypit.runtime.json`, `productions/_provider-test/**`, `.hypit/results/2026-10-03/*/{result.json,execution.jsonl}`, `hypit help <command>` for every command.
**Produces:**
- `docs/reference/hypit-notes.md`: how `plan --json` names provider requests per capability; how a running build reports progress (which file or command, which fields map to images, clips, render); how a run reuses outputs of an earlier build; how to start the local runtime with a given profile; captured JSON saved under `docs/reference/fixtures/`. Facts only, each with the command that showed it. No `build` against the real endpoint.
- `packages/provider-fake`: a Hypit provider with the same capabilities as `provider-magnific` that returns a canned image / clip from `packages/provider-fake/media/`, appends one line per request to the file named by `VC_FAKE_PROVIDER_LOG`, and can be told to fail the Nth clip (`VC_FAKE_FAIL_CLIP=N`). Offline tests in the style of `provider-magnific`.
- `hypit.runtime.fake.json`: the profile of `hypit.runtime.json` with the Magnific binding replaced by the fake endpoint.
- `adapters/hypit.ts`: `createHypit(options: { bin: string; profile: string; cwd: string }): Hypit` (spawns the CLI with `--json`); `adapters/audio.ts`: `createAudio(bin: string): Audio` (spawns `bin/magnific.py`); `adapters/llm.ts`: `createClaudeLlm(bin?: string): Llm` (`claude -p`, JSON extracted and parsed with the schema, one retry with the validation errors appended, then `LlmInvalid`); `adapters/downloader.ts`: `createDownloader(): Downloader` (`yt-dlp`); `adapters/fakes.ts`: `FakeHypit`, `FakeAudio`, `FakeLlm`, `FakeDownloader`, `FakeClock` — scripted answers plus a call log, for every other task's tests.
**Tests:** each adapter against a stub executable written to a temp dir (arguments passed, JSON parsed, non-zero exit → typed error, stderr never contains the key); `Llm`: valid first time; invalid then valid → two calls; invalid twice → `LlmInvalid`; `plan` parsing against the captured fixtures; `provider-fake` returns media, logs one line per request, fails the Nth clip when asked. One live test, skipped unless `VC_LIVE_HYPIT=1`: `hypit build` of `productions/_provider-test` with the fake profile ends `succeeded` and the request log has the planned number of lines.

### Task 5: Site — the `Engine` seam, durable store, port additions

**Files:** `web/src/data/ports.ts`, `web/src/data/index.ts`, `web/src/data/engine/{port,fake}.ts`, `web/src/data/real/{sqlite-engine,uploads}.ts` (stubs only), `web/src/data/mock/**` (including `persist.ts`, `uploads.ts`), tests next to them.
**Goal:** no behaviour change in fake mode: the 970 unit tests and the 35 e2e flows pass untouched (tests may change only where they import a moved helper).
**Produces:**
- `data/engine/port.ts` — synchronous on purpose (`node:sqlite` is, and a job start must stay one synchronous step):

```ts
export interface Engine {
  templates(): Template[];
  template(id: Id): Template | null;
  updateTemplate(id: Id, patch: Partial<Pick<Template, 'title' | 'category' | 'products' | 'status' | 'shots' | 'description' | 'tags'>>): Template;
  removeTemplate(id: Id): void;
  countGenerated(id: Id): void;
  addFromLink(ownerId: Id, url: string): Template;                 // private, preparing
  paid(templateId: Id, variants: number): Paid;                    // what the estimate shows
  minutes(templateId: Id, variants: number): number;
  start(job: JobRecord, approved: Paid, sample: boolean): void;
  resume(job: JobRecord, approved: Paid): void;
  refresh(job: JobRecord): JobRecord;                              // status, steps, stoppedReason, finishedAt, variants as of now
  missing(job: JobRecord): Paid;                                   // what a resume has to pay for; all zero when the job is not stopped
  candidates(): Candidate[];
  prepareCandidate(id: Id): Template;
  rejectCandidate(id: Id): void;
  scans(): Scan[];
  runScan(): Scan;
  settings(): AdminSettings;
  saveSettings(patch: Partial<AdminSettings>): AdminSettings;
  health(): { worker: 'running' | 'down'; lastSeen: string | null; provider: 'fake' | 'ready' | 'not-configured' };
}
```

- `data/engine/fake.ts`: today's behaviour moved here unchanged (templates in the store, progress by elapsed time and `VC_FAKE_SPEED`, the 20-second preparation, the 30-second scan, `STOP_TEMPLATE_ID`). `mock/jobs.ts`, `catalog.ts`, `admin.ts`, `admin-operations.ts`, `auth.ts` call `engine()` instead of touching `store.templates`, `store.candidates`, `store.scans`, `store.settings` or the clock-based progress. `costToResume(job)` becomes `refundEntryId ? job.credits : ceil(job.credits × missing.clips / total.clips)`.
- `data/ports.ts` additions (and nothing else): `Paid`; `StopReason`, `PreparationNote`, `ScanStopReason` widened to the codes of `contracts.ts`; `Template.preparation` may be set on a catalog template too; `TemplateCatalog.remove(id, viewerId): Promise<void>`; `AdminQueries.sampleCost(templateId): Promise<Paid>`, `generateSample(templateId, adminId, confirmed: Paid): Promise<Job>`, `health()`; `AdminSettings` gets `sources`, `searches`, `secondsMin`, `secondsMax`, `shortsMinViews`, `topAdsCards`, `perScan`; new port `Uploads { save(userId: Id, file: File): Promise<string> }` with a fake that returns the file name.
- `data/index.ts`: `VC_ENGINE=sqlite` selects `sqliteEngine` from `./real/sqlite-engine`; default `fake`. This task creates that file as a stub (`export function sqliteEngine(): Engine { throw new Error('engine-not-built'); }`) and `./real/uploads.ts` the same way (`export const diskUploads: Uploads`); from wave 2 on both belong to Task 9. `data.uploads` is the fake (it returns the file name) unless `VC_ENGINE=sqlite`.
- `mock/persist.ts`: with `VC_ENGINE=sqlite` the store starts from `data/site.json` when it exists, else from the user fixtures plus one opening ledger entry per fixture balance and no fixture jobs, purchases or templates; after every `data.*` call the store is written (temp file + rename) when its JSON changed. In fake mode nothing is read or written.
**Tests:** every existing test; the fake engine in isolation (the cases the job / catalog / admin tests cover today, addressed through the interface); `costToResume` with 3 of 5 clips done; persistence: start a job, build a new store from the file, the job, the charge and the balance are there and `keys` (a `Map`) survives; a broken `site.json` → a clear error, never a silent reset; fake mode writes no file.

---

## Wave 2 (four tasks at the same time)

### Task 6: Produce — from a confirmed run to mp4

**Files:** `viraleditor/src/produce/**`. **Consumes:** `compose`, `runs.ts`, `Hypit`, `Audio`, `Llm`, `paidFor`, the fakes.
**Produces:** `produceHandler(deps: { db; hypit: Hypit; audio: Audio; llm: Llm; clock: Clock }): (run: RunRow) => Promise<void>` for the worker.
**Steps of the handler, per variant:** adaptation (LLM → `fill.json`, validated by `Fill`; product images are passed as files, never the reference frames) → music and voice (`Audio`, an operation row first) → `compose` → `hypit check` → `hypit plan` → paid guard → `hypit build` (operation `v<k>:build`, the build id stored as soon as it is known; progress mapped to the `images`, `clips`, `edit`, `render` steps) → `hypit get` to `jobs/<runId>/v<k>/final.mp4` + a poster frame (`ffmpeg`). `sample: true` → afterwards copy to `templates/<id>/sample.mp4`, `poster.jpg` and update the card.
**Tests (all with the fakes):** a 5-shot beats template, 1 variant → steps go `waiting → running → done` in order, `result.variants` has one mp4 path, `sent` equals `approved`; 3 variants → three builds, one after another; the plan asks for more than approved → `stopped`, `estimate-exceeded`, zero builds, zero audio calls; a build that fails on a clip → `stopped`, `clips-failed`, `missing` counts only the clips that are not done, finished outputs kept; resume → the new run file reuses the stopped build and `sent` grows only by the missing part; a `pending` build operation with an id at start → `attach`, not `build`; a `pending` audio operation without an id → `submission-unknown`, nothing sent; `LlmInvalid` → `adaptation-failed`; the template folder is gone → `template-missing`; the provider log proves no request before the handler runs.

### Task 7: Template preparation and edits

**Files:** `viraleditor/src/prepare/**`. **Consumes:** `Hypit.transcribe/tile/check/plan`, `Llm`, `Downloader`, `compose`, `Template`, `cardOf`, `paidFor`, `takeUsage`.
**Produces:** `prepareHandler(deps)`, `editHandler(deps)` for the worker; `score(candidate files): { score: number; notes: string[]; unsupported: PrepareNote | null }`.
**Flow (spec §7.2):** download (link) or reuse `sources/<candidateId>` → transcript + frame sheet → LLM score (0–100: product visibility, face / speech risk, shot count, whether the engine can build it) → unsupported structures (split screen, green screen, in-shot transitions, over 60 s) end as `failed` with the note → LLM writes `template.json` (prompts describe the reference in words; no rival brand name) → check: schema → `compose` with a sample fill → `hypit check` → `hypit plan` → `ready` with `card`, `estimate`, `minutes`; else `failed` + `check-failed`. `edit`: apply the card's title, category, products, shot texts and times to `template.json`, check again, write the new card.
**Tests (fakes):** a good candidate → `ready`, `template.json` valid, card and estimate filled; score below the threshold and `force: false` → the candidate is `scored`, no template row is made, the result is `failed` + `below-threshold`; the same candidate with `force: true` is prepared; the scan row of the candidate gets `above_threshold + 1` when the score passes and `prepared + 1` when the template is `ready`; a split-screen answer → `failed` + `split-screen`; LLM invalid twice → `failed` + `llm-invalid`; `dailyTemplates` reached → the run stops with `daily-cap` and the candidate stays `scored` (the next day's scan queues it again); a user's link (owner set) is prepared whatever the score; a rival brand in the transcript does not appear in any prompt of the written template (the LLM fake returns one; the handler refuses and asks once more); an edit that moves a shot outside the video → `ok: false`, the old template stays.

### Task 8: Scan

**Files:** `viraleditor/src/scan/**`. **Consumes:** `TopAds`, `Shorts`, `Downloader`, `candidates.ts`, `readSettings`, `takeUsage`.
**Produces:** `scanHandler(deps)`; `createTopAds(): TopAds` (Playwright, system Chrome, TikTok Creative Center "Top Ads", US, last 7 days, all industries, no login); `createShorts(): Shorts` (`yt-dlp` search); `filter(cards, settings, seen): cards` (pure).
**Tests:** `filter` — seconds outside 6–35 dropped; Shorts under 500,000 views dropped; Top Ads sorted by likes, first 30; a URL already in `candidates` dropped; at most 15 pass; one source throws → that scan row is `stopped` + `source-unavailable` and the other source's scan still finishes `done`; `checked` written by the scan; every candidate that passes the filter gets a `prepare` run (`force: false`) until `dailyCandidates` is reached for the day, the rest stay `found` for the next scan. The two real sources each have one live test, skipped unless `VC_LIVE_SCAN=1`.

### Task 9: Site — SQLite engine, uploads, media

**Files:** `web/src/data/real/**`, `web/src/app/media/[...path]/route.ts`, `web/src/features/generate/{GenerateForm.tsx,ProductBlock.tsx,schema.ts,actions.ts}`, `web/src/features/gallery/{AddVideoView.tsx,TemplateDetail.tsx,actions.ts}`, `web/src/messages/{en,tr}/{generate,gallery}.json`, `web/next.config.ts` (only if `/media` images need it).
**Consumes:** `Engine` (Task 5), `viraleditor/schema.sql` (read from disk in tests to build a temp database), the row shapes of "Contracts".
**Produces:** `sqliteEngine(dataDir): Engine` — templates from the `templates` table (`published` → `published`; `hidden` → `hidden`; `ready` with no owner → `waiting`; an owner → `private` with `preparation`), `start` / `resume` insert or update `runs`, `refresh` reads `steps`, `state`, `reason`, `result`, `missing`; candidates, scans, settings, health from their tables. `uploads.save`: JPEG / PNG / WebP by magic bytes, at most 10 MB, at most 5 per product, stored as `uploads/<uuid>/<n>.<ext>`. `/media/[...path]`: a published template's files for everyone; a private or unpublished template's files for its owner and admins; a job's files for the job's owner and admins; uploads for the uploader and admins; `sources/**` (the reference video) for admins and for the owner of the private template made from it, never for anyone else (spec §3.8); `Range` requests for video; anything else 404. The generate form sends the files; "Delete this template" works for the owner.
**Tests:** the adapter against a temp database built from `schema.sql`: each mapping above; `start` twice with the same job id → one run (the unique index); `refresh` of a stopped run → status, reason, missing; a template row with broken JSON is skipped and logged, not a crash. Uploads: a PDF renamed `.jpg` → field error; 11 MB → field error; `../../x.jpg` as a name → stored under a generated name. Media: another user's job file → 404; `..%2f` in the path → 404; a published sample without a session → 200 with `Accept-Ranges`.

---

## Wave 3 (three tasks at the same time)

### Task 10: Seed data

**Files:** `viraleditor/src/seed/**`. **Consumes:** the golden templates of Task 2, `templates.ts`, `candidates.ts`.
**Produces:** `pnpm --dir viraleditor seed` (idempotent): `layering-01` and `lashly-01` become templates in state `ready` with the existing drafts copied in as `sample.mp4` + a poster (no new request); the 10 files under `references/_candidates/2026-10-03-secim/**/*.json` become candidates in state `found` (source `manual`; `beats` may be objects or strings).
**Tests:** on a temp data dir: two templates, both `ready`, cards filled, sample files present; ten candidates; a second run changes nothing; a candidate file with a missing field is skipped and named in the output.

### Task 11: Site — admin controls and new states

**Files:** `web/src/features/admin-templates/**`, `web/src/features/admin-settings/**`, `web/src/features/jobs/{StoppedView.tsx}`, `web/src/messages/{en,tr}/{adminTemplates,adminSettings,jobs}.json`.
**Produces:** "Generate sample" / "Regenerate sample" open a confirmation that lists the paid requests (`sampleCost`) and then call `generateSample`; a preparing or failed catalog template shows its state and reason in the inbox; "Check connection" shows `health()` (worker running / down, provider) instead of the hard-coded "Connected"; the settings form edits sources, the search list and the five thresholds; messages for every new reason code in English and Turkish (the generic fallback stays).
**Tests:** nothing is sent before the confirmation; the confirmation shows the counts from `sampleCost`; `health` down → the warning state; each new settings field validates (0–100, min ≤ max, non-empty search when Shorts is on); every `StopReason`, `PreparationNote` and `ScanStopReason` code has a message in both languages (a test over the unions).

### Task 12: Scheduler, launchd, runbook

**Files:** `viraleditor/src/worker/schedule.ts` (+ test), `viraleditor/src/worker/main.ts` (wiring only), `ops/launchd/app.viralclone.{web,worker}.plist`, `docs/runbook.md`.
**Produces:** `dueScans(settings: Settings, lastRun: Date | null, now: Date): ('topads' | 'shorts')[]` (pure) and its use in `main.ts`; `main.ts` builds the real adapters, with `VC_PROVIDER` default `fake`; two plist templates (not installed; they select the fake provider); the runbook: start and stop, where logs go, how to reset the data dir, how to open the site from a second device over Tailscale, and the checklist of Task 14.
**Tests:** at 09:00, 15:00, 21:00 a scan is due once per slot; a slot missed while the Mac slept runs once on wake, not three times; a source switched off is not scanned; changing the times in settings takes effect on the next tick.

---

## Wave 4

### Task 13: End to end with the fake provider, then the whole-branch review

**Files:** `web/e2e/real/*.spec.ts`, `web/playwright.real.config.ts`, `viraleditor/src/e2e/*.test.ts`.
**Tests:**
- Engine: seed → worker with the fake Hypit profile → enqueue a produce run for `layering-01` with one product image → `final.mp4` exists; `ffprobe` says 720×1280 and the template's length (± 1 frame); the shot count and text times of the composed file equal `template.json`; the provider log has exactly the approved number of lines.
- No request before a confirmation: with the worker running and no run queued, the provider log stays empty for 10 seconds.
- The test starts the worker as a child process, ends it with `child.kill()` during the build and starts a new one → the run finishes and the provider log has no duplicate line.
- Site (`VC_ENGINE=sqlite`, temp data dir, worker running): sign in → the seeded template → upload two product images → confirm → the job page moves through the steps → the result plays → the video is under My videos → restart the site → the job and the balance are still there.
- The stopped path: `VC_FAKE_FAIL_CLIP=3` → the job stops with the translated reason; resume asks for the missing part only; after the resume it finishes.
- Then: one reviewer on the most capable model reads the whole change against the spec and this plan; one fix wave; one scoped re-review.

## Gate (owner only)

### Task 14: First real paid trial

Not started by any agent. Needs: the owner's count and credit ceiling for one Fast no-talking video; the secrets env file readable; the Hypit runtime up with the real profile; `VC_PROVIDER=magnific` set by the owner. The runbook lists the steps and what to compare afterwards (requests sent = requests confirmed; spec §10 acceptance 1 and 2).

---

## Self-review (2026-10-04)

- **Spec coverage:** §4 life cycle → Tasks 7, 9, 10, 11 · §5 `template.json` → Tasks 1, 2 · §6 parts → `compose` Task 2, `template` Task 7, `scan` Task 8, `produce` Task 6, `worker` Tasks 3, 12, `web` Tasks 5, 9, 11 · §7.1 → Tasks 8, 12 · §7.2 → Task 7 · §7.3 → Tasks 6, 9 · §9 every row → Tasks 3, 4, 6, 7, 8 · §10 → Tasks 2, 13 · §11 phases 1, 2, 4, 5, 6 → waves 1–3 · §12 limits → runbook.
- **Not covered, on purpose:** the Kling fallback offer with the price difference (§9, §7.3) — the price table does not exist (§12) and the owner has not chosen tiers; the run stops with `clips-failed` and the admin retries. Marking a customer's finished job as a template's sample (§4): only "Generate sample" is built. Localised template titles (plan A ruling: data stays English). Real credit prices (owner). Everything in §13.
- **Open risk:** Task 2 and Task 6 depend on facts about Hypit that only the existing productions and the CLI show; Task 4 writes them down in wave 1, and Task 6 starts in wave 2 after it.
