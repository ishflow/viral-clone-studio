# viraleditor — revision of the engine plan (Hypit removed)

**Date:** 2026-10-04 · **Revises:** `docs/plans/2026-10-04-viral-clone-engine.md` (Tasks 2, 4, 6 replaced; contracts changed as in §3; everything else stays) · **Folder:** `engine/` is renamed `viraleditor/`.

**Why:** Hypit's licence forbids multi-tenant use and removing its name. viraleditor is our own editor: our code under MIT, built on HyperFrames (Apache-2.0), ffmpeg / ffprobe, whisper.cpp (through `hyperframes transcribe`) and our own HTTP client for Magnific. Nothing of Hypit's code, file formats or documentation text is used. The two productions are read only as a record of what a finished video contains.

---

## 1. Spike result

Folder `spike/viraleditor-render/` (untracked): `index.html` (the composition, written by hand), `assets/`, `verify.mjs` (frame check), `out/` (mp4, check JSON, render log, transcript). **It rendered.**

**Machine:** Apple M5, 10 cores, 24 GB · Node 25.9.0 · ffmpeg 8.1.1 · `hyperframes` 0.8.120 (75 packages, 128 MB, `npm install` 8.7 s). Chrome headless shell 152 was already in `~/.cache/hyperframes/chrome`; a clean machine downloads it on the first run.

**Commands** (all with `HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1`):

```bash
cd spike/viraleditor-render && npm init -y && npm install hyperframes
npx hyperframes lint                                                    # 0.8 s · 0 errors, 0 warnings
npx hyperframes check --no-contrast --json > out/check.json             # 4.4 s · exit 0 · ok: true
npx hyperframes render --fps 30 --quality looks --output out/beats.mp4  # "rendered in 5.9s" · wall 6.3–6.9 s
ffprobe -v error -show_streams -show_format out/beats.mp4
node verify.mjs out/beats.mp4                                           # frame table below
```

**Composition:** 720×1280, 30 fps, 180 frames. Three `<video>` back to back (A frames 0–46, B 47–115 with `data-media-start="1"`, C 116–179 = `web/public/samples/layering.mp4` through a symlink, `data-media-start="2"`), two texts (a two-line hook on frames 0–46; a label on frames 75–134, across the second cut) in boxes given in percent, weight 600, 27 / 23 px, white fill, two `text-shadow` layers, one `<audio>` (a 6 s tone, gain 0.9, 0.4 s fade-out). No script, no animation library, no network request.

**Output (`ffprobe`):** H.264 High, yuv420p, 720×1280, 30/1 fps, 180 frames, 6.000 s, 1.6 MB; AAC LC, 48 kHz stereo, 6.000 s. Render summary: `drawelement capture · hardware gpu · compile 0.1s · extract 0.2s · setup 1.1s · capture 4.2s · assemble 0.2s`, on one worker (limit 9). With `--workers 4`: rendered in 3.6 s, wall 4.5 s (`screenshot capture · hardware gpu`). With `--no-browser-gpu` (software path, 6 workers): wall 4.6 s. The frames checked were the same in all three.

**Frame accuracy** — clips A and B carry a bar whose position names the source frame; C is matched against the source frames of the real footage:

| Output frame | Clip | Source frame | Hook text | Label text |
|---|---|---|---|---|
| 46 | A | 46 | on | off |
| 47 | B | 30 (= 1 s offset) | off | off |
| 74 / 75 | B | 57 / 58 | off | off / **on** |
| 115 | B | 98 | off | on |
| 116 | C | 60 (= 2 s offset) | – | on |
| 134 / 135 | C | 78 / 79 | – | on / **off** |
| 179 | C | 123 | – | off |

Both cuts and all four text edges are on the intended frame; every output frame shows the intended source frame. Audio: gain and fade measured with `volumedetect` (−0.9 dB at gain 0.9; −33 dB in the last 0.2 s).

**What `check` checks:** lint (structure, ids, media attributes, fonts, timeline registration), runtime (console errors, failed requests), layout (text outside its box or the canvas, overlaps; 9 sample times by default, `--at` adds times), motion (only with a sidecar file), contrast (WCAG AA). A copy too long for its box gives `text_box_overflow` (error, exit 1): tried and confirmed.

**What did not work at first, and limits found:**

1. **Six-decimal seconds repeat a frame.** With `data-start="1.566667"` (47/30 rounded up) the shot showed its first source frame twice and ran one frame late to its end. The cut itself stayed on frame 47 (clip windows snap to the frame grid within 0.001 frame); the source-frame lookup does not snap (`floor((t − start) × fps + 1e-9)` in 0.8.120). With `1.5666666666666667` (full double precision) every frame is right. **Rule: seconds = `String(frame / fps)`, never rounded.**
2. **The default `check` fails** on white text over footage (contrast 4.28:1 and 1.93:1, exit 1). Our gate runs `--no-contrast`.
3. **No timeline needs `data-no-timeline` on the root**, otherwise lint error `missing_timeline_registry` (and, by the lint message, a 45 s wait at every render). The HyperFrames skill text says a registered GSAP timeline is required; the CLI accepts a composition without one. Trusted what ran.
4. A timed element that contains a `<div>` warns `nested_structure_needs_subcomposition`. One untimed full-frame layer holding timed **leaf** elements is clean.
5. `data-volume` is ignored once a volume lane (`data-automation`) is present: lane 1.0 + volume 0.9 gave 0 dB; volume 0.5 alone gave −6.1 dB. The gain goes into the lane points.
6. A second `<audio>` that takes its sound from an mp4 (`data-media-start="2"`) is mixed in at the right level, but the music moved −0.9 dB in that render. Cause not established.
7. **A real provider clip** (`productions/layering-01/assets/kling/body-oil.mp4`: 1072×1928, 24 fps, one keyframe) renders and is cover-cropped correctly; frames map as `floor(k × 24 / 30)` (every fifth output frame repeats). The CLI warns `sparse keyframes … seek failures and frame freezing`. We normalise clips ourselves before composing (§2).
8. Render progress is human text (`Streaming frame 46/180`); JSON output exists only for `--batch`.
9. **The automatic worker count is not stable:** on the GPU path the calibration failed on the flat-colour test frames (`suspect small frame`) and fell from 6 workers to 1; on the software path it took 6 and warned that the Node heap supports about 5. The adapter passes `--workers 4`.
10. Telemetry is on by default (this Mac's `~/.hyperframes/config.json` has it on); the three variables above switch it and the update check off. The skill asks for a `hyperframes feedback` report after a render: not sent (public channel).
11. `npx hyperframes transcribe ../../web/public/samples/lashly.mp4 -d out --engine whisper --model small.en --language en --json`: 91 words with `start` / `end` in 16.1 s for 30 s of speech (model already cached). It heard "try" where the script says "tried": captions must show our script, timed by alignment.

**Not tried:** 1080p canvas, videos longer than 6 s, many text elements, any animation, Docker mode, a worker started by `launchd`.

---

## 2. Architecture

One project, `viraleditor/` (`LICENSE`: MIT for our code), run by Node directly. It talks to the site only through `data/db.sqlite` and files under `data/` (unchanged).

```
viraleditor/
  LICENSE  package.json  schema.sql
  src/
    contracts.ts  ports.ts  paths.ts                                      frozen; §3 changes applied by the controller
    template/  schema.ts  estimate.ts  card.ts                            Task 2
    compose/   index.ts  beats.ts  speech.ts  script.ts  captions.ts  styles.ts  time.ts  write.ts  golden/   Task 2
    adapters/  magnific.ts  routes.ts  fake-generator.ts  renderer.ts  transcriber.ts  media.ts  llm.ts  downloader.ts  fakes.ts   Task 4
    produce/   index.ts  adapt.ts  paid.ts  pool.ts  images.ts  clips.ts  audio.ts  assemble.ts   Task 6
    db/  worker/                                                          Task 3 (done)
    prepare/  scan/  seed/                                                Tasks 7, 8, 10
```

| Part | Does | Outside world |
|---|---|---|
| `template` | schema, `paidFor`, `cardOf` | none |
| `compose` | pure: `template.json` + `fill.json` + media facts → `index.html` (a HyperFrames composition) + `timeline.json` (the frame table) | none; `write.ts` only writes inside `data/` |
| render | `Renderer`: `hyperframes check` then `hyperframes render` → mp4. HyperFrames mixes the audio itself (ffmpeg inside); we add no mix of our own | CLI child process, without the API key in its environment |
| generation client | `Generator`: our HTTP client for Magnific | `fetch` to `api.magnific.com`, only with `VC_PROVIDER=magnific` |
| `produce` / `prepare` / `scan` | the pipelines | through `ports.ts` |
| queue, worker | Task 3, unchanged | SQLite |

**Data directory:** `jobs/<runId>/` now holds `fill.json`, `v<k>/index.html`, `v<k>/timeline.json`, `v<k>/assets/*`, `v<k>/final.mp4`, `v<k>/poster.jpg` (no author or run files).

### "beats" mode → composition (proved by the spike)

- **Root:** `<div data-composition-id="main" data-width data-height data-fps data-duration data-no-timeline>`; duration = last frame / fps. No `<script>`, no URL outside the folder: the output is checked for that.
- **Time:** every `at` / `for` becomes `data-start` / `data-duration` = `String(frame / fps)`.
- **Shots:** one `<video muted playsinline>` per shot, full frame, `object-fit: cover`, direct child of the root, in shot order. Shots must tile the timeline: a gap or an overlap is an error. Each clip is first **normalised** (`Media.normalize`: cover-crop to the canvas, the template's fps, a keyframe every second, no sound), so a 24 fps provider clip never meets the 30 fps grid inside the renderer.
- **Texts:** one untimed full-frame layer; **one timed leaf `<div>` per text line**. The text's box (`left`, `top`, `right`, `bottom` in percent of the canvas) is split into equal rows, one per line, and written as `left: L%; top: T%; right: (100 − R)%; bottom: (100 − B)%`; the line is centred in its row, `white-space: nowrap`.
- **Styles:** one CSS class per style: `@font-face` to a local `woff2`, `font-weight`, `font-size` in canvas pixels, `color` = `fill`, `text-align`; `shadows` become `text-shadow` layers. **Two shadows instead of a stroke** (a tight dark one and a soft wide one), as both productions do.
- **No exit animation:** there is no timeline at all; a line or a shot is gone on the frame after its last one.
- **Music:** one `<audio>` over the whole length; the gain and a 0.4 s fade-out are points of its volume lane.
- **Injection:** copy is HTML-escaped; colours, shadows, font names and boxes are validated against fixed patterns before they reach CSS (`template.json` is written by an LLM, the copy comes from customers).

### "speech" mode → composition (designed, not proved)

Time comes from the speech, so `compose` runs after the clips exist and are measured.

- **Presenter clips:** one clip per script segment (the presenter still + the voice sample as references, the segment's lines as dialogue). Segments are laid end to end; a segment's length is its normalised clip's frame count. Each segment is a `<video muted>` plus an `<audio>` on the same file.
- **Marks:** the script marks word ranges in **our own syntax**, `[name]…[/name]` (may nest); `script.ts` parses lines into words and mark ranges. A text or a card names a mark and gets that range's frames.
- **Word timings:** `Transcriber.words(clip)` per segment, then `alignWords(script words, heard words)` (pure sequence alignment; a word that was not heard gets a time between its neighbours). Captions show the script's words, never the recogniser's.
- **Captions:** groups of at most 4 words and 2 lines; one timed leaf element per word state, in a fixed caption box.
- **Product cards:** `<img>` in its box, on screen for the frames of its mark (`image: "product:1"` = the customer's first product image). No pop-in motion in the first version.
- **Music:** looped under the speech at the template's gain.

**What speech mode needs that the spike did not prove:** (1) a paid clip that really speaks the lines in the sample voice, in sync; (2) alignment quality on generated speech; (3) hundreds of timed caption elements: check and render time; (4) picture and sound of one clip staying in sync over 30 s; (5) looping the music to a length known only after the clips; (6) the presenter shrinking to an inset during a mark, and generated evidence stills: `lashly-01` has both, the schema's `cards` cannot say either, so the golden leaves them out; (7) any motion needs an animation runtime, and GSAP is free of charge but not open source: use CSS / WAAPI or none.

---

## 3. Paid steps are ours now

Every image, clip, music and voice request is sent by `produce` through `Generator`. One `operations` row per request, written **before** it is sent. There is no planning command any more: the count is `paidFor(template, variants)`, checked against the rows actually begun.

### `viraleditor/src/ports.ts` — `Hypit`, `Audio`, `PlanFacts`, `BuildProgress`, `BuildEnd` are removed; this replaces them

```ts
// ── paid generation: our own HTTP client. produce writes the operations row BEFORE each call. ──
export interface Tier { model: string; resolution: string }                              // Settings.tiers[quality]
export interface ImageRequest { prompt: string; references: string[]; aspect: string }   // references: local image files · aspect: '9:16'
export type ClipRequest =
  | { mode: 'first-frame'; firstFrame: string; prompt: string; seconds: number; tier: Tier }
  | { mode: 'speaker'; presenter: string; voice: string; prompt: string; seconds: number; tier: Tier; aspect: string };
export interface MusicRequest { prompt: string }
export interface VoiceRequest { text: string; voiceId: string }
export interface Generated { taskId: string; file: string }                              // file: the path given as `to`
/** Called once, as soon as the provider has accepted the request. The ticket is all `resume` needs; it is stored in operations.external_id. */
export type OnSubmitted = (ticket: string) => void;

export type GeneratorErrorCode =
  | 'submission-unknown'   // the submit got no usable answer: the request may exist. Never send it again.
  | 'rejected'             // the provider refused the submit (HTTP 4xx): nothing was started
  | 'upload-failed'        // a reference file could not be uploaded: nothing was started
  | 'task-failed'          // the provider started the task and reported it failed
  | 'empty-result'         // the task finished without a file
  | 'timeout'              // not finished in time; the ticket stays valid
  | 'download-failed'      // finished, but the file could not be fetched; the ticket stays valid
  | 'not-configured';      // no key in the environment
export class GeneratorError extends Error {
  code: GeneratorErrorCode;
  ticket: string | null;
  constructor(code: GeneratorErrorCode, message: string, ticket: string | null = null) { super(message); this.code = code; this.ticket = ticket; }
}
export interface Generator {
  image(request: ImageRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated>;
  clip(request: ClipRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated>;
  music(request: MusicRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated>;
  voice(request: VoiceRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated>;
  resume(ticket: string, to: string): Promise<Generated>;                                // asks for a task submitted earlier; never submits
  ready(): Promise<{ ready: boolean; note: string | null }>;                             // free requests only
}

// ── local tools ──
export interface CheckIssue { code: string; message: string; target: string | null; second: number | null }
export interface MediaFacts { width: number; height: number; fps: number; frames: number; seconds: number; audio: boolean }
export class RenderError extends Error {}
export interface Renderer {
  check(dir: string): Promise<{ ok: boolean; issues: CheckIssue[] }>;                    // the composition folder: lint, runtime, layout
  render(dir: string, to: string, onProgress: (p: { frame: number; frames: number }) => void): Promise<MediaFacts>;   // throws RenderError
  ready(): Promise<{ ready: boolean; note: string | null }>;
}
export interface Word { text: string; start: number; end: number }                       // seconds from the start of the media
export interface Transcriber { words(media: string, language: string): Promise<Word[]> }
export type ContactSheet = (media: string, to: string, grid: { columns: number; rows: number }) => Promise<{ seconds: number[] }>;
export interface Media {                                                                 // ffmpeg / ffprobe
  probe(file: string): Promise<MediaFacts>;
  normalize(file: string, to: string, target: { width: number; height: number; fps: number; audio: boolean }): Promise<MediaFacts>;
  still(file: string, second: number, to: string): Promise<void>;                        // the poster
  sheet: ContactSheet;                                                                   // frame sheet for template preparation
}
// Llm, Downloader, TopAds, Shorts, Clock, LlmInvalid: unchanged.
```

### `viraleditor/schema.sql` — the `operations` table

```sql
CREATE TABLE IF NOT EXISTS operations (     -- one row per paid request, written BEFORE the request is sent
  run_id        TEXT NOT NULL REFERENCES runs(id),
  key           TEXT NOT NULL,              -- 'v1:image:s1', 'v1:image:presenter', 'v1:clip:s1', 'v1:music', 'v1:voice'; a resend after a failed row: '<key>:r2'
  kind          TEXT NOT NULL CHECK (kind IN ('image','clip','music','voice')),
  state         TEXT NOT NULL CHECK (state IN ('pending','done','failed','unknown')),
  external_id   TEXT,                       -- the Generator's ticket; NULL until the provider has accepted the request
  output        TEXT,                       -- the downloaded file, relative to data/
  error         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (run_id, key)
);
```

No migration: no database with real rows exists yet; a `data/db.sqlite` made from the old schema is removed by hand.

### `viraleditor/src/contracts.ts`

```ts
export interface Health { workerAt: string; provider: 'fake' | 'magnific'; renderer: 'ready' | 'not-ready'; note: string | null }
```

Nothing else changes: `Paid`, `Step`, `StepKey`, `StopReason`, `RunInput`, `RunResult`, `Settings` stay, so the site's `Engine` seam (Task 5) is untouched.

### Applied by the controller before wave 1 (frozen files and Task 3's files)

The rename `engine/` → `viraleditor/`; package name `viraleditor`; `LICENSE` (MIT); the three blocks above; `package.json` gains `hyperframes` at exactly `0.8.120`, `@fontsource-variable/inter` and `@fontsource-variable/montserrat`; in Task 3's files `OperationRow['kind']` (`db/runs.ts`) becomes `'image' | 'clip' | 'music' | 'voice'` and `hypit` becomes `renderer` (`worker/loop.ts`, `worker/main.ts`, their tests); `.gitignore` gains `spike/`.

### "Rules every task relies on" — new text

- **Paid counting** (replaces the old rule). Every image, clip, music and voice request is sent by `produce` through `Generator`; nothing else sends a paid request. The need of a run is `paidFor(template, variants)`, and it must equal what a clean run sends. Before the first request: every field of the need ≤ `approved`, else the run stops with `estimate-exceeded` and nothing is sent. Before each request: the run's `operations` rows of that kind (in any state) + 1 ≤ `approved` for that kind, and for a clip the billed seconds likewise, else `estimate-exceeded`. Then, in this order: the row is written (`pending`) → the request is sent → the provider's acceptance stores the ticket in `external_id` and adds the request to `sent` → the downloaded file goes to `output`, state `done`. On restart: `pending` with a ticket → `Generator.resume` (asks, never submits); `pending` without a ticket → `unknown`, the run stops with `submission-unknown`; an `unknown` row is never sent again by the worker.
- **Resume** (second sentence replaced). `missing` = the need − rows `done` − rows `pending` with a ticket. The worker goes on from the first step that is not `done`: a `done` row is reused from its `output`; a `pending` row with a ticket is asked for again, free; a `failed` row is sent again under the next key (`…:r2`), which is a new, newly approved request; a run that has an `unknown` row stops again at once.
- **Concurrency** (the bracket replaced). One render at a time; paid requests at most 3 at a time: `produce` runs them through one pool of 3.
- **Global constraints.** "No paid request": the real `Generator` is built only when `VC_PROVIDER=magnific`, which no task, test, script or plist sets; tests use a scripted `fetch`. "No secrets": the key is read from `MAGNIFIC_API_KEY` only by `adapters/magnific.ts`, goes only to the API host in the `x-magnific-api-key` header, never to upload or download URLs, never into a log, an error text or a child process. The common recipe reads `docs/reference/viraleditor-notes.md` in place of the Hypit notes.
- **Spec wording.** Where spec §6, §7.2, §7.3 and §10 say `hk check` / `hk plan` / `hk build`, read `Renderer.check` / `paidFor` / `Generator` + `Renderer.render`.

---

## 4. Rewritten tasks

### Task 2: `compose`, the composition folder, the two golden templates

**Files:** `viraleditor/src/compose/**`, `viraleditor/src/template/**` (owner from now on), `viraleditor/src/compose/golden/{layering-01,lashly-01}/{template.json,fill.json}`.
**Reads:** this document §1, §2; `spike/viraleditor-render/{index.html,verify.mjs}`; spec §5, §10; `productions/layering-01/authors/{main.svml,recipes.svs}`, `productions/lashly-01/authors/{main.svml,recipes.svs}` and `productions/layering-01/drafts/final-v6.mp4` as a record of what the two videos contain (shots, frames, boxes, sizes, colours, copy, prompts). No syntax, name or sentence of those files goes into ours.
**Interfaces — consumes:** `Template`, `Fill`, `Word`. **Produces:**
- `compose(template: TemplateJson, fill: FillJson, media: ComposeMedia): Composition` — pure: same input, same text. `ComposeMedia = { clips: Record<string, { file: string; frames: number }>; music: string | null; cards: Record<string, string>; words: Record<string, Word[]> }` (paths relative to the composition folder; `words` by segment id, empty in beats). `Composition = { html: string; timeline: Timeline; fonts: string[] }`, `Timeline = { fps: number; frames: number; shots: { id: string; at: number; for: number }[]; texts: { id: string; line: number; at: number; for: number }[] }`.
- `writeComposition(dir: string, composition: Composition, sources: Record<string, string>): void` — writes `index.html` and `timeline.json`, links each `assets/<name>` to its source file, copies the font files.
- `seconds(frame: number, fps: number): string`; `parseScript(lines: string): { words: string[]; marks: Record<string, { from: number; to: number }> }`; `alignWords(script: string[], heard: Word[]): { start: number; end: number }[]`; `ComposeError` with a `code`.
- `template/estimate.ts`: `paidFor` for speech counts 1 image per variant (the presenter still), not `shots + 1`: a speaker clip is made from the presenter still. `template/schema.ts`: `shots[].action` and `description` as the plan's contract lists them (the file on disk lacks both; `card.ts` shows the prompt as the action today).
**Tests:**
- **Golden, beats:** `layering-01` written by hand (5 shots at frames 0, 39, 87, 125, 170 for 39, 48, 38, 45, 70; 6 text lines; 2 styles; music gain 0.9). `compose` with placeholder clips (ffmpeg colour clips with the frame bar of `verify.mjs`), written to a temp folder: `hyperframes check --no-contrast --json` says `ok`; `hyperframes render` gives 720×1280, 30 fps, 240 frames, an audio stream; on each of the four cuts the frame before shows the previous clip's last used source frame and the frame after shows source frame 0 of the next; each text is absent on frame `at − 1`, present on `at` and on its last frame, absent on the next. The tests call the CLI through a test-only helper in `golden/`, not through Task 4's adapter (same wave); they are skipped when `hyperframes doctor --json` reports no Chrome.
- **Golden, speech:** `lashly-01` written by hand within the schema (3 segments, texts and 4 product cards on marks, captions, music; the evidence stills and the inset are left out and named in the report). `compose` with placeholder segment clips and synthetic word timings passes `check`; segments follow each other without a gap; every mark resolves to a frame range; every script word is in exactly one caption.
- `paidFor(layering golden, 1)` = 5 images, 5 clips, 20 clip seconds, 1 music, 0 voice (what that production used); the speech golden = 1 image, 3 clips, 30 clip seconds, 1 music, 1 voice.
- The three rules are in the output: no `<script>` and no tween anywhere; a style's shadows become `text-shadow` layers and no stroke property appears; a text of three lines becomes three elements whose boxes split the text's box into three rows.
- `seconds(47, 30)` is `"1.5666666666666667"`; the root carries `data-no-timeline`; the output has no `http` and no `<script`.
- Copy `<b>&"` appears escaped; a `fill` of `red;background:url(x)` → `ComposeError('style-value')`; a `{product}` left in a prompt or a copy → `unfilled:<placeholder>`; a rival brand name in `source_copy` never appears in the output (only `fill.texts` is used).
- `ComposeError` codes: `box-out-of-range`, `shots-gap`, `shot-too-long` (over 15 s), `too-long` (over 60 s), `clip-short` (a clip with fewer frames than its shot), `style-unknown`, `mark-unknown`, `mark-unbalanced`.
- `alignWords`: identical words keep their times; "tried" against a heard "try" still matches; a word that was not heard lies between its neighbours.

### Task 4: Adapters and fakes

**Files:** `viraleditor/src/adapters/**`, `docs/reference/viraleditor-notes.md`, `docs/reference/fixtures/*`. (`packages/provider-fake/**` and the fixtures written for the Hypit version of this task are no longer used; leave them and say so in the report.)
**Reads:** `bin/magnific.py`, `packages/provider-magnific/README.md`, `src/{routes,provider,errors}.js`, `test/provider.test.js` — for the wire facts and the test style only. The client is written fresh on `fetch`; nothing is imported or copied from `@hypit/*`. `spike/viraleditor-render/out/*` for real CLI output.
**Produces:**
- `adapters/magnific.ts` + `routes.ts`: `createMagnific(options: { apiKey: string; fetch?: typeof fetch; baseUrl?: string; pollMs?: number; requestTimeoutMs?: number; taskTimeoutMs?: number; sleep?: (ms: number) => Promise<void> }): Generator`. Wire facts: header `x-magnific-api-key`; a reference is uploaded once per request (`POST /v1/ai/uploads/request-url` → `PUT` to the signed URL with its signed headers, no key → `asset_url`); image `POST /v1/ai/text-to-image/nano-banana-pro` (`prompt`, `reference_images: [{ image, mime_type }]`, `aspect_ratio`, `num_images: 1`; at most 14 references); clip `POST /v1/ai/video/<model>-<resolution>` for the Seedance routes of `routes.js` (`first-frame`: `image`, `prompt`, integer `duration` ≥ 4, `sound_effects: false`, no `aspect_ratio`; `speaker`: `reference_images`, `reference_audios`, the named ratio, `sound_effects: true`, `no_music: true`), poll path per the route table; a tier whose model is `kling-v3-pro` / `kling-v3-std` uses the Kling route of `bin/magnific.py` (`first-frame` only; the clips delivered for `layering-01` came from it); music `POST /v1/ai/music-generation/lyria-3`; voice `POST /v1/ai/voiceover/elevenlabs-turbo-v2-5`; a task is `{ data: { task_id, status, generated, error } }` with `CREATED` / `IN_PROGRESS` / `COMPLETED` / `FAILED`. The ticket is the poll path with the task id. Results are downloaded at once (links expire), without the key.
- `adapters/fake-generator.ts`: `createFakeGenerator(options: { log: string; failClip?: number; delayMs?: number }): Generator` — makes a valid image, clip (requested seconds, with the frame bar) or audio file with ffmpeg, appends one JSON line per **submitted** request to the log (`VC_FAKE_GENERATOR_LOG`), fails the Nth clip when asked (`VC_FAKE_FAIL_CLIP`); `resume` returns the file and adds no line.
- `adapters/renderer.ts`: `createRenderer(options: { bin: string; ffprobe: string }): Renderer` — `check`: `hyperframes check <dir> --no-contrast --json --at <middle of every text window from timeline.json>`, errors of lint, runtime and layout become issues; `render`: `hyperframes render <dir> --fps <fps> --quality looks --workers 4 --output <to>`, progress from the `frame n/N` lines, then `ffprobe`: size, fps and frame count must equal `timeline.json`, else `RenderError`. The child's environment has the three switches of §1 and no `MAGNIFIC_API_KEY`.
- `adapters/transcriber.ts`: `createTranscriber(bin: string): Transcriber` (`hyperframes transcribe … --json`, reads `transcript.json`; `small.en` for English, `large-v3` otherwise). `adapters/media.ts`: `createMedia(ffmpeg: string, ffprobe: string): Media` (the sheet: `fps`, `scale`, `tile` → one jpg and the second of every tile). `adapters/llm.ts`: `createClaudeLlm(bin?: string): Llm` (`claude -p`, JSON extracted and parsed with the schema, one retry with the validation errors appended, then `LlmInvalid`). `adapters/downloader.ts`: `createDownloader(): Downloader` (`yt-dlp`).
- `adapters/fakes.ts`: `FakeGenerator` (scripted answers and errors, a call log, in memory), `FakeRenderer`, `FakeTranscriber`, `FakeMedia`, `FakeLlm`, `FakeDownloader`, `FakeClock`.
- `docs/reference/viraleditor-notes.md`: the Magnific wire facts and the HyperFrames CLI facts, each with its source (file and line, or the command that showed it); fixtures: a `check` JSON, the render progress lines, a `transcript.json`.
**Tests:**
- Magnific, with a scripted `fetch` (no network): every route's path and body; a reference uploaded once and the key never sent to the upload or the download URL; `onSubmitted` called with the ticket before the first poll; `CREATED → IN_PROGRESS → COMPLETED` → the file is written; `FAILED` → `task-failed` with the provider's reason; `COMPLETED` with no result → `empty-result`; a network error or a non-JSON answer on the submit → `submission-unknown` and no second `POST`; HTTP 400 on the submit → `rejected`; 429 then 200 while polling → polling goes on, no new `POST`; `resume(ticket)` sends only `GET`s; too long → `timeout` with the ticket; no error text contains the key or a signed URL.
- Fake generator: the files are valid media of the asked length; one log line per submit; the Nth clip fails; `resume` adds no line.
- Renderer, transcriber, media, LLM, downloader against a stub executable in a temp dir: arguments passed, output parsed (the fixtures), non-zero exit → typed error, the key never in the child's environment. `Llm`: valid first time; invalid then valid → two calls; invalid twice → `LlmInvalid`. `Media`: on a real ffmpeg clip of 1072×1928 at 24 fps, `normalize` gives 720×1280 at 30 fps with the asked frame count; `sheet` gives one jpg and the tile times.

### Task 6: Produce — from a confirmed run to mp4

**Files:** `viraleditor/src/produce/**`. **Consumes:** `compose`, `writeComposition`, `runs.ts`, `Generator`, `Renderer`, `Transcriber`, `Media`, `Llm`, `paidFor`, `readSettings`, the fakes.
**Produces:** `produceHandler(deps: { db: DatabaseSync; generator: Generator; renderer: Renderer; transcriber: Transcriber; media: Media; llm: Llm; clock: Clock }): (run: RunRow) => Promise<void>`.
**Steps of the handler** (each step covers all variants, so the steps go forward once):
1. **adaptation** — LLM → `jobs/<runId>/fill.json`, validated by `Fill`; product images are passed as files, never the reference frames; a speech script must keep every mark of the template.
2. **paid guard** — `paidFor(template, variants)` against `approved`; every request below goes through one function (`paid.ts`) that applies the "Paid counting" rule: row first, then send, ticket stored on acceptance.
3. **images** — one per shot in beats (prompt from the fill, references = the product images the shot names), one presenter still in speech; a pool of 3.
4. **clips** — beats: `first-frame` from the shot's image, the motion prompt, `max(4, ceil(clip_seconds))` seconds, the tier of the run's quality. Speech: `speaker` clips from the presenter still and the voice sample. The same pool of 3.
5. **music / voice** — one music request per variant; speech: one voice request per variant, sent before the clips (it is their input) and counted in this step.
6. **edit** — `Media.normalize` every clip to the canvas and fps; speech: `Transcriber.words` per segment; `compose` → `writeComposition` into `jobs/<runId>/v<k>/` → `Renderer.check`; a failed check stops the run with `render-failed`.
7. **render** — one at a time: `Renderer.render` → `v<k>/final.mp4`, then `Media.still` → `poster.jpg`; progress in frames.
`sample: true` → afterwards copy to `templates/<id>/sample.mp4`, `poster.jpg` and update the card.
**Stop and resume:** when a request fails, the requests already in flight finish (they are paid), no new one starts, the step and the run become `stopped` with `images-failed`, `clips-failed` or `audio-failed`, and `missing` is written. `GeneratorError` → row state: `submission-unknown` → `unknown` (reason `submission-unknown`); `timeout`, `download-failed` → the row stays `pending` with its ticket; the rest → `failed`; `not-configured` → `engine-error`. Resume follows the "Resume" rule.
**Tests (all with the fakes):** a 5-shot beats template, 1 variant → the steps go `waiting → running → done` in order, `result.variants` has one mp4 path, `sent` equals `approved` equals `paidFor`; 3 variants → 15 images, 15 clips, 3 music, three renders one after another; never more than 3 requests in flight; the need is larger than `approved` → `stopped`, `estimate-exceeded`, the fake's log is empty; **an operation row exists before each request** (the fake reads the database when it is called); the third clip fails → `clips-failed`, `missing` = the clips without a `done` row, finished files kept; resume → only the missing clips are sent, the failed one under `…:r2`, `sent` grows by the missing part only; a `pending` row with a ticket at start → `resume`, not a new request; a `pending` row without a ticket → `unknown`, `submission-unknown`, nothing sent; a resume of that run stops again; `timeout` leaves the row `pending` with its ticket; `LlmInvalid` → `adaptation-failed`; a fill that lost a mark → `adaptation-failed`; the check fails → `render-failed`, no render; the template folder is gone → `template-missing`; no request before the handler runs.

---

## 5. Effects on other tasks

- **Task 7 (prepare, edit):** the transcript comes from `Transcriber`, the frame sheet from `Media.sheet`; the automatic check is schema → `compose` with a sample fill and placeholder clips from the fake generator → `Renderer.check`; the estimate is `paidFor`. No `plan` step.
- **Task 8 (scan):** no change except the folder name.
- **Task 10 (seed):** the golden templates come from `viraleditor/src/compose/golden`; the samples are still the existing drafts; nothing else changes.
- **Task 12 (scheduler, launchd, runbook):** `main.ts` builds the fake generator by default and the Magnific client only with `VC_PROVIDER=magnific` and a key; `health.renderer` comes from `Renderer.ready()`; the plists start no Hypit runtime, set the three HyperFrames switches and a `PATH` with `/opt/homebrew/bin`; the runbook covers `hyperframes doctor`, the Chrome cache and the extracted-frame cache in the system temp folder (`hyperframes clean`).
- **Task 13 (end to end):** the engine test runs a **real** HyperFrames render with the fake generator's media: 720×1280, the template's length with no frame of tolerance, cut frames by the bar, log lines = approved requests; the kill test kills the worker during the clips step and expects no duplicate log line (the run finishes, or stops with `submission-unknown`). Task 14 needs no Hypit runtime.

Left as history, not used by the product: `bin/hk`, `packages/provider-magnific`, `packages/provider-fake`, `hypit.runtime.json`, `.hypit/`, the root `package.json`. Removing them is the owner's call.

---

## 6. Risks and open points

**HyperFrames**
- It is a 0.x CLI. We depend on behaviour read from 0.8.120 (frame lookup, `data-no-timeline`, the progress text, the `check` JSON). Pin the exact version; the golden render test is the alarm on an upgrade.
- Three capture paths ran here (`drawelement` on the GPU, which is marked experimental and macOS-only; screenshot on the GPU; screenshot in software). The frames checked were the same, but pixel equality between the paths was not compared, and no render was started from `launchd`. HyperFrames names Docker mode as the reproducible one; not tried.
- `check` measures layout at sample times only; the adapter adds the middle of every text window. Text over footage is never contrast-checked (we switch that audit off).
- The −0.9 dB shift with two audio elements is unexplained. If levels matter, render the picture and mix with our own ffmpeg command.
- First run on a clean machine downloads Chrome headless shell; telemetry and the update check must stay off in the worker. The spike installed with npm; under pnpm confirm that `sharp` and `esbuild` load (build scripts are blocked by default).
- Fonts: text in a script that Inter and Montserrat do not cover (CJK, Arabic) falls back silently. The two font packages were not installed in the spike (it used Geist from Next's files).

**Not proved**
- All of speech mode beyond "sound from an mp4 is mixed" and "word timings exist" (§2 list). The speech golden is a reduced `lashly-01`: evidence stills and the inset need a schema decision from the owner.
- 1080p, 30–60 s videos, hundreds of timed elements.
- Changing `paidFor` for speech changes the estimate the site shows: needs the owner's yes.

**Render speed against the "10 minutes" target (spec §10.1)**
- Local work is small: real time or faster for the render (6 s of video in 3.6–5.9 s), 4.4 s for the check, about half real time for transcription. An 8–15 s no-talking video costs well under a minute locally.
- The rest of the 10 minutes is paid generation: 5 images, then 5 clips, three at a time. Its latency was not measured here and decides the target.

**Licences of what we propose**

| Dependency | Licence |
|---|---|
| `hyperframes` 0.8.120 | Apache-2.0 (`package.json`; the repository's `LICENSE` is the unmodified text, © 2026 HeyGen, Inc., no added conditions) |
| its installed tree, 75 packages (from their `package.json`) | MIT 52 · Apache-2.0 9 (`puppeteer-core`, `sharp`, …) · ISC 6 · BSD-3-Clause 2 · CC0-1.0 1 · 0BSD 1 · LGPL-3.0-or-later 1 (`@img/sharp-libvips-darwin-arm64`, prebuilt, loaded dynamically) · 1 combined Apache-2.0 / LGPL-3.0-or-later / MIT (`@img/sharp-wasm32`) |
| Chrome headless shell | Chromium: BSD-3-Clause and bundled third-party licences |
| ffmpeg / ffprobe (Homebrew), x264 | GPL-2.0-or-later; called as separate programs, not linked |
| whisper.cpp and the Whisper models | MIT |
| WhisperX | BSD-2-Clause (its repository's `LICENSE`); not installed here, not needed while `hyperframes transcribe` is enough |
| Inter, Montserrat (`@fontsource-variable/inter`, `@fontsource-variable/montserrat`, 5.3.0) | OFL-1.1 (npm metadata) |
| `zod`, `vitest` · `typescript`, `playwright-core` · `yt-dlp` | MIT · Apache-2.0 · Unlicense |
| GSAP | "Standard 'no charge' license" (npm metadata): free, not open source. **Not used** |
| `claude` CLI, Magnific API | proprietary services behind `Llm` and `Generator`; replaceable |

H.264 / AAC patent terms for a paid product were not checked.

**Needs a paid trial to settle**
- Latency and failure rate of images and clips, and so the 10-minute target.
- Size, frame rate and length of Seedance clips (the Kling clips on disk are 1072×1928 at 24 fps, 3.04 s), and whether a first-frame clip follows the 9:16 frame.
- Whether a finished task's download links can be fetched again after they expire (matters for `download-failed` and `resume`).
- A talking presenter from a still and a voice sample: lip sync, voice match, word-timing quality.
- The Kling fallback, the tiers, and the real cost of one video against the credit price.
