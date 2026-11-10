# viraleditor — the edit document, and what HyperFrames 0.8.120 renders exactly (spike S1)

**Date:** 2026-10-04 · **Adds to:** `docs/plans/2026-10-04-viraleditor-revision.md` (§2 "beats → composition" is extended by this document; where the two differ, this one is newer) · **Spike folder:** `spike/viraleditor-motion/` (git-ignored; every number below comes from a script there) · **For:** the builders of `compose`.

Every statement is marked **[ran]** (a script in the spike folder produced the number) or **[designed]** (follows from what ran, but was not rendered). Machine: Apple M5, Node 25.9.0, ffmpeg 8.1.1, `hyperframes` 0.8.120, Chrome headless shell 152.0.7977.30, macOS. The machine was shared during the spike; no render time below is a finding.

---

## 1. What was proved, in short

1. **CSS `@keyframes` are seeked frame-exactly** by HyperFrames, with no script and no timeline registration (`data-no-timeline` stays). An animation's local time is `t − start of the nearest ancestor-or-self that has data-start` (the root counts, with 0). Opacity, position, scale and blur followed their curve on every frame (opacity error ≤ 0.006, position ≤ 0.3 px). The Web Animations API is just as exact but needs a `<script>`; it is not used. **[ran: P1]**
2. **Animating `opacity` / `scale` / `transform` directly is exact but not reproducible.** Chrome moves such elements to compositor layers; 1–20 % of the scaled frames differed between two identical renders (edge pixels, up to 52 / 255; once on a text, 226 / 255). `will-change: transform` made runs equal only for a fixed worker count, and made video content differ. **Driving a registered custom property instead (`@property --ve-s`, element style `scale: var(--ve-s)`) gave byte-identical renders** — 4 renders with 4 workers, 2 with 1 worker, and 4 workers against 1 worker. Every animation in this design goes through registered custom properties. **[ran: P1b, P1, P3, P4, P5, P10]**
3. **Edges sit on half frames.** Every animation starts and ends at `(frame − 0.5) / fps`, so no frame time ever coincides with an edge and no float rounding can move one. A value on frame `f` of an animation over frames `at … at+for−1` is `from + (to − from) · ease((f − at + 0.5) / for)`. All 61 active-word edges of 60 caption words were on their frame. **[ran: P1, P3]**
4. **Transitions keep both sources exact.** Over 540 frames with cut, crossfade, push (left, up), zoom punch, whip (blur + move), flash and dip, 563 source-frame bars were decoded: 0 wrong, worst position error 0.48 px (6 px = one source frame). Three renders identical. **[ran: P4]**
5. **Everything else on the brief's list renders exactly:** Ken Burns and punch-in on video (360 frames, 0 wrong source frames, scale error ≤ 0.003), inset window (rect exact to the pixel at rest), evidence image zoom, image card pop-in, word-by-word captions, compose-time text fitting, Inter and Montserrat variable at 100–900, looped and ducked music, a clip's own sound, and one 1080×1920 composition with shots, motion, transitions, a fitted hook, a card, captions and music together (lint and check clean, two renders identical). **[ran: P2–P10]**

What is **not** byte-reproducible: a video drawn smaller than its pixel size (the inset). 13 of 150 frames differed between three renders, by 1 / 255 on at most 271 pixels; after H.264 the decoded difference reached 23 / 255 on single pixels. Content and timing were right on every frame. See §9.

---

## 2. Rules compose follows (all from the spike)

| # | Rule | Why (evidence) |
|---|---|---|
| R1 | Frames are the only time unit in the document. Seconds in the composition are `String(frame / fps)`; half frames are `String((frame − 0.5) / fps)`. Never rounded. | revision §1.1; P1 |
| R2 | An animation edge is always at `frame − 0.5`. Enter: `animation-delay` = `(at − clipAt − 0.5) / fps`, `animation-duration` = `for / fps`. | P1 probes f5, f6; P3 |
| R3 | Nothing animates `opacity`, `translate`, `scale`, `filter`, `transform`, `border-radius` directly. Keyframes set registered custom properties (`--ve-*`); the element's static style reads them. No `will-change` anywhere. | P1b |
| R4 | Enter animations use `animation-fill-mode: backwards`, exit animations `forwards`, never `both` on two animations of one property (the later one's backwards fill hides the earlier one: probe g2 showed opacity 1 on the first frame instead of 0.06). A motion that spans its whole clip uses `both`. | P1 probe g2 |
| R5 | Every box, font size and line height reaches CSS as **integer pixels**. Percent of the canvas is rounded once, in compose. | first run of P1 (output since overwritten): a text in a percent box (fractional pixels) with direct animations sat 1 px higher with 1 worker than with 4; with integer pixels it did not |
| R6 | The transition lives on an untimed wrapper `<div class="ve-shot">` around the timed `<video>` / `<img>`; the motion on the shot (Ken Burns, punch-in) lives on the media element itself. No timed element has a timed ancestor. | P4, P5; lint `video_nested_in_timed_element` |
| R7 | Outline = a ring of hard `text-shadow` copies, not `-webkit-text-stroke`. | P2: the stroke draws miter spikes on N, K, V, W; `stroke-linejoin: round` has no effect on HTML text in Chrome 152 |
| R8 | Text is fitted at compose time from a metrics table; compose writes the final pixel size and the line breaks. A character the table does not know is an error, never a silent fallback. | P7, P8 |
| R9 | Each font is emitted as two `@font-face` rules (`latin` and `latin-ext` files, with their `unicode-range`), `font-weight: 100 900`. | P8: with the `latin` file alone, İ ş ğ fall back silently and lint, check and render all pass |
| R10 | `upper` is applied by compose (`toLocaleUpperCase(language)`), never by CSS `text-transform`; `<html lang>` is the document language. | P10: `lang="tr"` + `text-transform: uppercase` turned the English "is" into "İS" |
| R11 | Media that scales past its box carries `data-layout-allow-overflow` (otherwise check reports `container_overflow`, info). | P6 |
| R12 | Loop = further `<audio>` elements back to back. Gain, fades and ducking are points of each element's volume lane, **in seconds local to that element**. | P9 |
| R13 | `Media.normalize` writes BT.709 tags and converts with the 709 matrix. | P9: an untagged clip rendered rgb(40,140,70) as (31,125,65); the tagged one as (36,138,65) |
| R14 | The renderer runs with a fixed `--workers 4`. The gate is `hyperframes check --no-contrast --json --at <timeline.checkAt>`; lint alone does not notice a missing font file, check does (`http_error`, exit 1), render succeeds silently with a fallback font. `writeComposition` therefore refuses to write when a font or media file is missing. | P8 |

---

## 3. The edit document (`edit.json`)

One file fully describes a montage. `resolve(template, fill, media)` produces it in the pipeline; an agent may write it by hand. `compose(edit, facts)` is pure.

```ts
// viraleditor/src/edit/schema.ts — plain types; each interface becomes one zod object (z.strictObject: unknown keys are errors)

export type Frame = number;        // integer ≥ 0, on the timeline of the whole video (never relative to a shot)
export type Frames = number;       // integer ≥ 1, a length
export type Percent = number;      // 0..100 of the canvas: x of its width, y of its height
export type Colour = string;       // ^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$
export type Id = string;           // ^[a-z][a-z0-9-]{0,31}$ — becomes an HTML id
export type MediaKey = string;     // ^[a-z][a-z0-9-]{0,31}$ — a key of Edit.media
export type Ease = 'linear' | 'out' | 'in' | 'in-out' | 'back' | 'whip';
export type Side = 'left' | 'right' | 'top' | 'bottom';

/** As in template/schema.ts: right and bottom are edges, not insets. left < right, top < bottom. */
export interface Box { left: Percent; top: Percent; right: Percent; bottom: Percent }

export interface Edit {
  version: 1;
  language: string;                                  // BCP 47 ('en', 'tr'): <html lang>, upper-casing, line breaking
  canvas: { width: 720 | 1080; height: 1280 | 1920; fps: 30 };   // the two sizes that were rendered
  frames: Frames;                                    // must equal the end of the last shot; ≤ 60 s
  background?: Colour;                               // behind everything; default '#000000'
  safe?: 'tiktok' | 'reels' | 'both' | 'none';       // default 'both' (§4.4)
  media: Record<MediaKey, { file: string; kind: 'video' | 'image' | 'audio' }>;   // file: ^assets/[A-Za-z0-9._-]+$
  styles?: Record<string, TextStyle>;                // own styles; the presets of §4.1 exist without being listed
  shots: Shot[];                                     // in time order; they tile 0 … frames
  texts?: EditText[];
  captions?: Captions;
  cards?: Card[];
  audio?: Audio;
}

// ── picture ──
export interface Shot {
  id: Id;
  at: Frame; for: Frames;                            // the frames this shot owns; shots[i].at = shots[i−1].at + shots[i−1].for
  media: MediaKey;                                   // a video or an image
  from?: Frame;                                      // first source frame of a video; default 0
  focus?: [Percent, Percent];                        // the point a crop keeps and a motion zooms on; default [50, 50]
  motion?: Motion;
  in?: Transition;                                   // how this shot replaces the previous one; default { kind: 'cut' }; not allowed on shots[0]
  sound?: { gain: number };                          // the clip's own sound, 0..2; absent = silent
  windows?: Window[];                                // periods in which this shot is a small window over another picture
}
export type Motion =
  | { kind: 'push-in'; to?: number; ease?: Ease }                    // scale 1 → to (1.01..1.5, default 1.08) over the whole time on screen
  | { kind: 'pull-out'; from?: number; ease?: Ease }                 // scale from (default 1.08) → 1
  | { kind: 'punch-in'; at: Frame; to?: number; frames?: Frames };   // 1 → to (default 1.2) over frames (default 4, ease 'out'), stays; at lies inside the shot
export type Transition =
  | { kind: 'cut' }
  | { kind: 'crossfade'; frames?: Frames }                           // default 8
  | { kind: 'push'; to: Side; frames?: Frames }                      // default 10; `to`: the side the pictures travel to
  | { kind: 'whip'; to: Side; frames?: Frames }                      // default 8; a push with blur
  | { kind: 'zoom'; frames?: Frames; scale?: number }                // default 8, 1.3
  | { kind: 'flash'; frames?: Frames; colour?: Colour }              // default 6, '#ffffff'
  | { kind: 'dip'; frames?: Frames; colour?: Colour };               // default 12, '#000000'
export interface Window {
  at: Frame; for: Frames;                            // inside the shot; the shrink takes the first `frames`, the return the last `frames`
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';   // of the safe area
  width?: Percent;                                   // of the canvas width, 20..60, default 38; height follows the canvas ratio
  radius?: Percent;                                  // of the canvas width, 0..8, default 2.6
  frames?: Frames;                                   // default 10
  behind: MediaKey;                                  // the image (or video) that fills the frame meanwhile
  behindMotion?: Motion;                             // push-in / pull-out only
}

// ── text ──
export interface TextStyle {
  font: 'Inter' | 'Montserrat';
  weight: number;                                    // 100..900
  size: number;                                      // px on this canvas (as Template.styles)
  align: 'left' | 'center' | 'right';
  fill: Colour;
  shadows: string[];                                 // text-shadow layers, each ^-?\d+(\.\d+)?px -?\d+(\.\d+)?px \d+(\.\d+)?px #hex$ (existing field)
  upper?: boolean;
  tracking?: number;                                 // letter-spacing in em, −0.05..0.3
  leading?: number;                                  // line height as a multiple of the size, 1..2, default 1.15
  outline?: { width: number; colour: Colour };       // width in em of the final size, 0.02..0.12
  plate?: { colour: Colour; radius: number; padX: number; padY: number };   // a filled shape behind each line; em
}
export interface EditText {
  id: Id;
  at: Frame; for: Frames;
  box: Box;
  style: string;                                     // a key of Edit.styles or a preset name
  copy: string;                                      // 1..200 characters; '\n' forces a line break
  lines?: number;                                    // most lines, 1..4; default: the lines of copy if it has '\n', else 2
  shrink?: number;                                   // smallest size as a share of the style size, 0.5..1; default 0.6
  valign?: 'top' | 'middle' | 'bottom';              // of the lines inside the box; default 'middle'
  enter?: Enter; exit?: Exit;                        // default: the preset's (§4.1); { kind: 'none' } switches one off
  stagger?: number;                                  // frames between the enter of one line and the next, 0..6
  safe?: false;                                      // false: allowed to leave the safe area
}
export type Enter =
  | { kind: 'none' }
  | { kind: 'fade'; frames?: Frames }                                      // default 6
  | { kind: 'pop'; frames?: Frames; from?: number }                        // default 8; scale from (default 0.6) with overshoot, 4-frame fade
  | { kind: 'slide'; from: Side; frames?: Frames; distance?: Percent }     // default 8; distance in % of the canvas height, default 4; with fade
  | { kind: 'blur'; frames?: Frames; radius?: Percent };                   // default 8; radius in % of the canvas width, default 2.2; with fade
export type Exit =
  | { kind: 'none' }
  | { kind: 'fade'; frames?: Frames }
  | { kind: 'pop'; frames?: Frames; to?: number }                          // scale to (default 0.8) with fade
  | { kind: 'slide'; to: Side; frames?: Frames; distance?: Percent }
  | { kind: 'blur'; frames?: Frames; radius?: Percent };

export interface Captions {
  box: Box;
  style?: string;                                    // default 'caption'
  words: { text: string; at: Frame; for: Frames }[]; // in order, not overlapping; the script's words, timed by alignment
  group?: { words?: number; lines?: 1 | 2; hold?: Frames; pause?: Frames };   // defaults 3 (max 4), 2, 12, 15
  active?: { kind: 'none' } | { kind: 'colour'; colour: Colour; scale?: number } | { kind: 'pill'; colour: Colour; text?: Colour };
                                                     // default { kind: 'colour', colour: '#ffe000', scale: 1.06 }
  enter?: Enter;                                     // of each group; default { kind: 'pop', frames: 5, from: 0.8 }
  safe?: false;
}

// ── pictures over the footage ──
export interface Card {
  id: Id;
  at: Frame; for: Frames;
  media: MediaKey;                                   // an image
  box: Box;
  radius?: Percent;                                  // of the canvas width, default 3.3
  enter?: Enter; exit?: Exit;                        // default pop 8 / pop 8
  motion?: Motion;                                   // push-in / pull-out (a full-frame evidence image with a slow zoom is a Shot on an image, or a Card with the box 0,0,100,100)
  safe?: false;
}

// ── sound ──
export interface Audio {
  music?: {
    media: MediaKey;
    gain: number;                                    // 0..2
    from?: Frame;                                    // offset into the file, default 0
    loop?: boolean;                                  // default true
    fadeIn?: Frames; fadeOut?: Frames;               // default 0 / 12
    duck?: { to: number; ramp?: Frames; under: 'sound' | 'captions' | { at: Frame; for: Frames }[] };   // ramp default 6
  };
  sounds?: { id: Id; media: MediaKey; at: Frame; for?: Frames; from?: Frame; gain: number }[];   // effects; for defaults to the file's length
}

// ── compose ──
export interface MediaFacts { frames: number; audio: boolean }   // video: frames at the canvas fps; audio: floor(seconds × fps); image: 1 (what probing a picture reports; compose does not read it for an image, so 0 is accepted too)
export function compose(edit: Edit, facts: Record<MediaKey, MediaFacts>): Composition;   // throws ComposeError
export interface Composition { html: string; timeline: Timeline; fonts: string[]; files: string[] }
```

`ducking.under`: `'sound'` = every period in which a shot with `sound` is on screen; `'captions'` = the caption words, merged when the gap between two words is shorter than `2 × ramp`.

### A short document that already looks finished **[designed; its composition is P10, which ran]**

```json
{
  "version": 1, "language": "en",
  "canvas": { "width": 1080, "height": 1920, "fps": 30 }, "frames": 180,
  "media": { "a": { "file": "assets/a.mp4", "kind": "video" }, "b": { "file": "assets/b.mp4", "kind": "video" },
             "c": { "file": "assets/c.mp4", "kind": "video" }, "serum": { "file": "assets/serum.png", "kind": "image" },
             "beat": { "file": "assets/beat.mp3", "kind": "audio" } },
  "shots": [
    { "id": "s1", "at": 0,   "for": 60, "media": "a", "motion": { "kind": "push-in" } },
    { "id": "s2", "at": 60,  "for": 60, "media": "b", "from": 20, "in": { "kind": "crossfade" }, "motion": { "kind": "punch-in", "at": 90 } },
    { "id": "s3", "at": 120, "for": 60, "media": "c", "from": 40, "in": { "kind": "whip", "to": "left" }, "motion": { "kind": "pull-out" } }
  ],
  "texts": [ { "id": "hook", "at": 0, "for": 54, "box": { "left": 9, "top": 15, "right": 91, "bottom": 27 }, "style": "hook", "copy": "My lashes grew visibly in three weeks" } ],
  "cards": [ { "id": "product", "at": 70, "for": 40, "media": "serum", "box": { "left": 31, "top": 36, "right": 69, "bottom": 58 } } ],
  "captions": { "box": { "left": 9, "top": 52, "right": 86, "bottom": 64 },
    "words": [ { "text": "never", "at": 62, "for": 12 }, { "text": "looked", "at": 74, "for": 14 }, { "text": "so", "at": 88, "for": 8 }, { "text": "good", "at": 96, "for": 20 } ] },
  "audio": { "music": { "media": "beat", "gain": 0.5, "duck": { "to": 0.2, "under": "captions" } } }
}
```

---

## 4. Presets and defaults

Sizes are given for a 1080-wide canvas; on 720 they are multiplied by 2/3 and rounded.

### 4.1 Text styles (available by name; `Edit.styles` may override or add)

| Name | Font | Size | Fill | Outline | Other | Enter | Exit | Stagger |
|---|---|---|---|---|---|---|---|---|
| `hook` | Inter 800 | 72 | `#ffffff` | 0.08 em `#000000` | shadow `0px 4px 14px #00000080`, leading 1.15, center | pop 8 | fade 6 | 2 |
| `label` | Inter 600 | 44 | `#ffffff` | 0.07 em `#000000` | center | fade 6 | fade 6 | 0 |
| `tag` | Inter 700 | 40 | `#ffffff` | none | plate `#e0508c`, radius 0.3, padX 0.5, padY 0.22; center | pop 6 | fade 6 | 0 |
| `caption` | Montserrat 900 | 84 | `#ffffff` | 0.08 em `#000000` | upper, leading 1.28, center | (group) pop 5 | none | – |

`hook` at 72 and `caption` at 84 are the sizes rendered in P10 (two caption words per line fit a box 888 px wide). `label` and `tag` are **[designed]**.

### 4.2 Easings

| Name | CSS | Used for |
|---|---|---|
| `linear` | `linear` | fades, Ken Burns |
| `out` | `cubic-bezier(0.16,1,0.3,1)` | enters, punch-in, the incoming half of a zoom |
| `in` | `cubic-bezier(0.7,0,0.84,0)` | exits, the outgoing half of a zoom |
| `in-out` | `cubic-bezier(0.65,0,0.35,1)` | push, window |
| `back` | `cubic-bezier(0.34,1.56,0.64,1)` | pop (overshoot) |
| `whip` | `cubic-bezier(0.8,0,0.2,1)` | whip |

Measured against these curves in P1 (out, back, in), P4 (in-out, whip, in, out) and P5 (in-out, out).

### 4.3 Transition windows

`C` = the incoming shot's `at`. `n` = `frames`.

| Kind | Effect frames | Outgoing shot stays until | Needs from the outgoing clip |
|---|---|---|---|
| `cut` | – | `C − 1` | – |
| `crossfade`, `push`, `whip` | `C … C+n−1` | `C+n−1` (its `tail` = n) | `n` more source frames (`clip-short` otherwise) |
| `zoom` | `C−⌊n/2⌋ … C+⌈n/2⌉−1` | `C − 1` | – |
| `flash`, `dip` | `C−⌊n/2⌋ … C+⌈n/2⌉−1` (a colour layer over both) | `C − 1` | – |

The incoming shot's source frame `from` is on output frame `C` in every kind: a transition never moves the timeline.

### 4.4 Safe areas (percent of the canvas) — REPLACED by §12.16 (a rectangle minus the button column) **[designed — the numbers are from the platforms' published guidance as remembered; not re-checked, the spike made no network request]**

| `safe` | left | top | right | bottom |
|---|---|---|---|---|
| `tiktok` | 6 | 8 | 86 | 78 |
| `reels` | 6 | 14 | 86 | 65 |
| `both` | 6 | 14 | 86 | 65 |
| `none` | 0 | 0 | 100 | 100 |

A text, the caption box or a card whose box leaves the safe area is the error `outside-safe-area` unless it says `"safe": false`. Shots and `behind` pictures are never checked. A `Window` is placed inside the safe area by its corner.

---

## 5. What compose emits

### 5.1 Document and root (unchanged from revision §2, plus the stylesheet)

```html
<!doctype html>
<html lang="{language}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={W}, height={H}" />
    <title>viraleditor</title>
    <style>
      /* per font used: two rules */
      @font-face { font-family: "Inter"; src: url("assets/fonts/inter-latin-wght-normal.woff2") format("woff2"); font-weight: 100 900; font-style: normal; font-display: block; unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
      @font-face { font-family: "Inter"; src: url("assets/fonts/inter-latin-ext-wght-normal.woff2") format("woff2"); font-weight: 100 900; font-style: normal; font-display: block; unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: {W}px; height: {H}px; overflow: hidden; background: {background}; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: {background}; }
      .ve-layer { position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; }
      .ve-shot { position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; overflow: hidden; }
      .ve-shot > video, .ve-shot > img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
      .ve-fx { position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; }
      .ve-line { position: absolute; display: flex; align-items: center; white-space: nowrap; }
      .ve-card { position: absolute; object-fit: cover; }
      .ve-cap { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .ve-cap-line { display: block; white-space: nowrap; }
      .ve-w { display: inline-block; padding: 0 0.14em; border-radius: 0.25em; }
      /* §5.2 motion stylesheet, then one class per (style, final size): .st-hook-65 { … } */
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="{W}" data-height="{H}" data-fps="{fps}" data-duration="{frames/fps}" data-no-timeline>
      <!-- shots in order, each in its wrapper, z-index 1…n -->
      <!-- transition colour layers (.ve-fx), z-index 100 -->
      <div id="overlays" class="ve-layer" style="z-index:200"> <!-- cards, then text lines, then caption groups: timed leaf elements --> </div>
      <!-- <audio> elements -->
    </div>
  </body>
</html>
```

No `<script>`, no URL outside the folder (both still checked on the output). `.ve-line` gets `justify-content: flex-start | center | flex-end` from the style's `align`.

### 5.2 The motion stylesheet (verbatim; the text of `spike/viraleditor-motion/lib/vecss.mjs`) **[ran]**

```css
@property --ve-o { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --ve-x { syntax: "<length-percentage>"; inherits: false; initial-value: 0px; }
@property --ve-y { syntax: "<length-percentage>"; inherits: false; initial-value: 0px; }
@property --ve-s { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --ve-b { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --ve-wx { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --ve-wy { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --ve-ws { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --ve-wr { syntax: "<length>"; inherits: false; initial-value: 0px; }
.ve-m { opacity: var(--ve-o); translate: var(--ve-x) var(--ve-y); scale: var(--ve-s); }
.ve-mb { filter: blur(var(--ve-b)); }
.ve-win { transform-origin: 0 0; transform: translate(var(--ve-wx), var(--ve-wy)) scale(var(--ve-ws)); border-radius: var(--ve-wr); }
@keyframes ve-fade-in { from { --ve-o: 0; } to { --ve-o: 1; } }
@keyframes ve-fade-out { from { --ve-o: 1; } to { --ve-o: 0; } }
@keyframes ve-move-in { from { --ve-x: var(--ve-in-x); --ve-y: var(--ve-in-y); } to { --ve-x: 0px; --ve-y: 0px; } }
@keyframes ve-move-out { from { --ve-x: 0px; --ve-y: 0px; } to { --ve-x: var(--ve-out-x); --ve-y: var(--ve-out-y); } }
@keyframes ve-scale-in { from { --ve-s: var(--ve-in-s); } to { --ve-s: 1; } }
@keyframes ve-scale-out { from { --ve-s: 1; } to { --ve-s: var(--ve-out-s); } }
@keyframes ve-blur-in { from { --ve-b: var(--ve-in-b); } to { --ve-b: 0px; } }
@keyframes ve-blur-out { from { --ve-b: 0px; } to { --ve-b: var(--ve-out-b); } }
@keyframes ve-scale { from { --ve-s: var(--ve-s0); } to { --ve-s: var(--ve-s1); } }
@keyframes ve-flash { 0% { --ve-o: 0; } 50% { --ve-o: 1; } 100% { --ve-o: 0; } }
@keyframes ve-window-in { from { --ve-wx: 0px; --ve-wy: 0px; --ve-ws: 1; --ve-wr: 0px; } to { --ve-wx: var(--ve-win-x); --ve-wy: var(--ve-win-y); --ve-ws: var(--ve-win-s); --ve-wr: var(--ve-win-r); } }
@keyframes ve-window-out { from { --ve-wx: var(--ve-win-x); --ve-wy: var(--ve-win-y); --ve-ws: var(--ve-win-s); --ve-wr: var(--ve-win-r); } to { --ve-wx: 0px; --ve-wy: 0px; --ve-ws: 1; --ve-wr: 0px; } }
@keyframes ve-word-colour { from, to { color: var(--ve-active); } }
@keyframes ve-word-pill { from, to { background-color: var(--ve-pill); } }
@keyframes ve-word-pop { 0% { --ve-s: 1; } 25% { --ve-s: var(--ve-pop-s); } 100% { --ve-s: var(--ve-hold-s); } }
```

The parameters (`--ve-in-x`, `--ve-out-s`, `--ve-win-x`, …) are plain custom properties written into the element's `style` by compose; they hold numbers compose produced, never text from the document. An element that is animated carries `class="… ve-m"` (and `ve-mb` only when it has a blur, `ve-win` only when it has a window).

**One animation, as text.** For an animation over frames `at … at+for−1` on an element whose clock starts at frame `base` (its own `data-start` frame, or the frame of the nearest ancestor with `data-start`; 0 for a shot wrapper):

```
animation: <keyframes> <String(for / fps)>s <ease css> <String((at − base − 0.5) / fps)>s <fill>
```

Several animations are joined with `, ` in one `animation` declaration. Order: enter animations first, exit animations last.

### 5.3 Shots, motion, transitions **[ran: P4, P5, P10]**

```html
<div id="{id}" class="ve-shot ve-m[ ve-mb]" style="z-index:{i+1};[--ve-in-…;][--ve-out-…;][animation:{transition animations}]">
  <video id="{id}-v" class="clip[ ve-m]" [data-layout-allow-overflow] src="{file}"
         data-start="{at/fps}" data-duration="{(for+tail)/fps}" data-media-start="{from/fps}" data-track-index="{i % 2}" muted playsinline
         [style="--ve-s0:{a};--ve-s1:{b};transform-origin:{fx}% {fy}%;animation:{motion animation}"]></video>
</div>
```

An image shot is the same with `<img id="{id}-v" class="clip…" src alt="" data-start data-duration data-track-index>` (no `data-media-start`, no `muted`). `object-position: {fx}% {fy}%` when `focus` is given **[designed]**.

Motion (on the media element; its clock starts at the shot's `at`; `L = for + tail`):

| Motion | `--ve-s0` → `--ve-s1` | Animation |
|---|---|---|
| `push-in` | 1 → `to` | `ve-scale {L/fps}s {ease, default linear} {−0.5/fps}s both` |
| `pull-out` | `from` → 1 | the same |
| `punch-in` | 1 → `to` | `ve-scale {frames/fps}s cubic-bezier(0.16,1,0.3,1) {(at − shot.at − 0.5)/fps}s both` |

Transition (on the wrappers; clock starts at 0, so delays are absolute). `B` = incoming shot, `A` = outgoing, `C = B.at`, `n = frames`, `d = String((C − 0.5)/fps)`:

| Kind | On `B`'s wrapper | On `A`'s wrapper | Extra |
|---|---|---|---|
| `crossfade` | `ve-fade-in {n/fps}s linear {d}s backwards` | – | `A.tail = n` |
| `push` to `left` | `--ve-in-x:100%;--ve-in-y:0px` · `ve-move-in {n/fps}s in-out {d}s backwards` | `--ve-out-x:-100%;--ve-out-y:0px` · `ve-move-out {n/fps}s in-out {d}s forwards` | `A.tail = n`; to `right`: 100 % ↔ −100 % swapped; to `top`: `--ve-in-y:100%`, `--ve-out-y:-100%`; to `bottom`: swapped |
| `whip` | as push with ease `whip`, plus `--ve-in-b:{blur}px` · `ve-blur-in {n/fps}s whip {d}s backwards`, class `ve-mb` | as push with ease `whip`, plus `--ve-out-b:{blur}px` · `ve-blur-out … forwards`, class `ve-mb` | `A.tail = n`; blur = 3.3 % of the canvas width |
| `zoom` | `--ve-in-s:{scale}` · `ve-scale-in {⌈n/2⌉/fps}s out {d}s backwards` | `--ve-out-s:{scale}` · `ve-scale-out {⌊n/2⌋/fps}s in {(C−⌊n/2⌋−0.5)/fps}s forwards` | – |
| `flash`, `dip` | – | – | `<div id="{B.id}-fx" class="clip ve-fx ve-m" data-start="{(C−⌊n/2⌋)/fps}" data-duration="{n/fps}" data-track-index="5" style="z-index:100;background:{colour};animation:ve-flash {n/fps}s linear {−0.5/fps}s both"></div>` |

Window (class `ve-win` on the shot's wrapper; the `behind` picture is a second wrapper directly before it in the DOM, timed `at … at+for−1`) **[ran: P6]**:

```
style="--ve-win-x:{left}px;--ve-win-y:{top}px;--ve-win-s:{width/W};--ve-win-r:{radius / (width/W)}px;
       animation:ve-window-in {frames/fps}s in-out {(at−0.5)/fps}s forwards, ve-window-out {frames/fps}s in-out {(at+for−frames−0.5)/fps}s forwards"
```

`left`, `top`, `width` are integer pixels and `width / W × H` must be an integer too (compose rounds `width` to the nearest value for which it is: multiples of 9 px).

### 5.4 Text lines **[ran: P1, P7, P10; plate designed]**

Compose fits the copy (§5.8), then emits one timed leaf per line inside `#overlays`:

```html
<div id="{id}-{k}" class="clip ve-line ve-m st-{style}-{size}" data-start="{at/fps}" data-duration="{for/fps}" data-track-index="{t}"
     style="left:{x}px;top:{y + (k−1)·lh}px;width:{w}px;height:{lh}px;[--ve-in-s:…;--ve-in-x:…;…]animation:{enter animations}, {exit animations}">{escaped line}</div>
```

```css
.st-hook-65 { font-family: "Inter", sans-serif; font-weight: 800; font-size: 65px; line-height: 75px; color: #ffffff;
  text-shadow: {ring(0.08 × 65 = 5.2 px, #000000)}, 0px 4px 14px #00000080; }
```

- `x, y, w` = the box in integer pixels; `lh = round(size × leading)`; `y` = the box top plus the free height according to `valign`.
- **Outline:** `ring(r, colour)` = `n` shadows `{r·cos a}px {r·sin a}px 0 {colour}` (two decimals) for `a = 2πi/n`, `n = clamp(⌈2πr / 1.5⌉, 8, 32)`; the style's own `shadows` follow. `r = outline.width × size`.
- **Plate** **[designed]**: the line's text is wrapped in `<span class="ve-plate">` with `background`, `border-radius`, `padding` in em from the style.
- `data-track-index`: at most 5 timed elements per index (lint warned `timeline_track_too_dense` at 7 and 8 on one index and not at 5; 6 was not tried).
- Line `k` of a text with `stagger s`: its enter delay is `(s·(k−1) − 0.5)/fps`.

Enter / exit → animations (clock = the element's own `at`; `e` = enter frames, `x` = exit frames, `F` = the text's `for`):

| Kind | Enter (fill `backwards`, delay `−0.5/fps`) | Exit (fill `forwards`, delay `(F − x − 0.5)/fps`) |
|---|---|---|
| `fade` | `ve-fade-in {e/fps}s linear` | `ve-fade-out {x/fps}s linear` |
| `pop` | `--ve-in-s:{from}` · `ve-scale-in {e/fps}s back`, `ve-fade-in {min(4,e)/fps}s linear` | `--ve-out-s:{to}` · `ve-scale-out {x/fps}s in`, `ve-fade-out {x/fps}s linear` |
| `slide` | `--ve-in-x / --ve-in-y:{±distance px}` · `ve-move-in {e/fps}s out`, `ve-fade-in {e/fps}s linear` | `--ve-out-x / --ve-out-y` · `ve-move-out {x/fps}s in`, `ve-fade-out {x/fps}s linear` |
| `blur` | `--ve-in-b:{radius px}` · `ve-blur-in {e/fps}s out`, `ve-fade-in {e/fps}s linear`, class `ve-mb` | `--ve-out-b` · `ve-blur-out {x/fps}s in`, `ve-fade-out {x/fps}s linear`, class `ve-mb` |

### 5.5 Captions **[ran: P3, P10]**

Grouping (pure): walk the words; a group is closed when it has `group.words` words, or the next word starts `≥ group.pause` frames after the previous one ends, or the previous word ends with `.`, `!` or `?`, or one more word would not fit on `group.lines` lines of the box at the style size (metrics table). Lines inside a group: balanced by width. A group is on screen from its first word's `at` until the next group's first word, at most `group.hold` frames after its last word ends. Word `i` is active from its `at` until the next word of the group starts (the last one until the group ends).

```html
<div id="cap-{g}" class="clip ve-cap ve-m st-caption-84" data-start="{G.at/fps}" data-duration="{G.for/fps}" data-track-index="{t}"
     style="left:{x}px;top:{y}px;width:{w}px;height:{h}px;animation:ve-scale-in {5/fps}s out {−0.5/fps}s backwards, ve-fade-in {5/fps}s out {−0.5/fps}s backwards">
  <span class="ve-cap-line"><span class="ve-w ve-m" style="animation:{word animations}">NEVER</span> <span class="ve-w ve-m" style="…">LOOKED</span></span>
  <span class="ve-cap-line">…</span>
</div>
```

The caption class also sets `--ve-active`, `--ve-pill`, `--ve-pop-s` (`scale + 0.06`), `--ve-hold-s` (`scale`), `--ve-in-s`. Word animations (`len = (activeUntil − word.at)/fps`, `delay = (word.at − G.at − 0.5)/fps`):

| `active.kind` | Animations |
|---|---|
| `colour` | `ve-word-colour {len}s step-end {delay}s 1 normal none, ve-word-pop {len}s linear {delay}s 1 normal none` |
| `pill` | `ve-word-pill {len}s step-end {delay}s 1 normal none` (+ `ve-word-colour` when `text` is given) |
| `none` | – |

### 5.6 Cards **[ran: P6, P10]**

```html
<img id="{id}" class="clip ve-card ve-m" src="{file}" alt="" data-start="{at/fps}" data-duration="{for/fps}" data-track-index="{t}"
     style="left:{x}px;top:{y}px;width:{w}px;height:{h}px;border-radius:{r}px;--ve-in-s:0.6;--ve-out-s:0.8;animation:{enter}, {exit}" />
```

Two cards with the same file, start and length make lint warn `duplicate_media_discovery_risk`; compose reports it as `card-duplicate`.

### 5.7 Audio **[ran: P9]**

```html
<audio id="music-{k}" src="{file}" data-start="{at/fps}" data-duration="{len/fps}" data-media-start="{from/fps}" data-track-index="10"
       data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0.5},…]}]}'></audio>
<audio id="{shot.id}-sound" src="{the shot's video file}" data-start="{at/fps}" data-duration="{(for+tail)/fps}" data-media-start="{from/fps}" data-track-index="11" data-volume="{gain}"></audio>
```

- Loop: element `k` covers `fileFrames − from` frames first, then `fileFrames` each, until `Edit.frames`.
- Points: `t` = seconds from the **element's own** start (`String(frame / fps)`), `v` = gain. Every music element gets a first point at `t = 0` and a last one at its end. Gain, `fadeIn`, `fadeOut` and ducking ramps are points; an element with a lane carries no `data-volume` (it is ignored there, revision §1.5). A shot's own sound has a constant gain and uses `data-volume` alone (that is the form that ran).
- Ducking: for each range `[a, b)`: gain goes `gain → to` over frames `a − ramp … a`, back over `b … b + ramp`.

### 5.8 Text fitting **[ran: P7]**

`fit(copy, style, boxPx, { lines, shrink })` (the code of `spike/viraleditor-motion/lib/fit.mjs`, about 50 lines):

1. width of a string = Σ advance(grapheme, weight) × size / 1000 + tracking; advances from a table per font: 329 characters (printable ASCII, U+00A0–U+017F, ten punctuation marks) × weights 100…900, linear between two weights; an emoji counts 1 em.
2. For `size` from the style's size down to `⌈size × shrink⌉`: wrap greedily into the box width × 0.98; accept the first size with `lines ≤ max`, every line within the width and `lines × round(size × leading) ≤ box height`.
3. Balance: the narrowest wrap width that keeps that line count.
4. No size fits → `text-too-long`. A character without an entry → `text-glyph`.

The table is built once by `lib/metrics.mjs` (headless Chrome of HyperFrames, `canvas.measureText` at 1000 px, local `woff2`, no network; 37.5 KB for both fonts) and is checked in next to the font files.

### 5.9 Injection

Copy and caption words are HTML-escaped (`& < > " '`). Everything else that reaches CSS is a number compose computed, a colour that matched `Colour`, a shadow that matched the pattern, a font name from the enum, an id that matched `Id`, or a file that matched `^assets/[A-Za-z0-9._-]+$`. Style names become classes only through `Id`-checked keys.

---

## 6. Validation errors

> Newer than this list: §12.10–17 (the codes `window-range` for windows out of order, `media-facts`, `music-short`, `duck-too-dense`, `media-size-unknown`, `sound-duplicate`, `blur-too-many`, `id-duplicate` for derived ids). The full, current list is what `viraleditor codes` prints: it is generated from the one table the checks use.

`compose` collects every issue (at most 100: `MAX_ISSUES`, `edit/schema.ts`), then throws one `ComposeError`:

```ts
export interface EditIssue { code: string; path: string; message: string; fix: string }   // path: 'shots[2].in.frames'
export class ComposeError extends Error { code: string; issues: EditIssue[] }              // code = issues[0].code (the codes of revision §4 keep their meaning)
```

| Code | What is wrong | Message says | How to fix it |
|---|---|---|---|
| `schema` | a field is missing, of the wrong type, not an integer, or unknown | the path and what was expected | correct that field; unknown keys are not ignored |
| `canvas-unsupported` | canvas is not 720×1280 or 1080×1920 at 30 fps | the canvas given | use one of the two |
| `id-duplicate` | two shots, texts, cards or sounds share an id | the id and both paths | rename one |
| `media-unknown` | an element names a media key that `media` lacks | the key and the keys that exist | add it to `media` or use an existing key |
| `media-kind` | a card or `behind` names audio, music names a video or image, a shot names audio | the kind found and the kind needed | point to a file of the right kind |
| `media-file` | `file` does not match `^assets/[A-Za-z0-9._-]+$` | the value | put the file in `assets/` and name it with those characters |
| `shots-gap` | `shots[i].at ≠ shots[i−1].at + shots[i−1].for`, or `shots[0].at ≠ 0`, or the last shot does not end at `frames` | the two frame numbers | set `at` to the given frame (transitions never change `at`) |
| `shot-too-long` | a shot is longer than 15 s | frames and the limit | split it |
| `too-long` | `frames` is more than 60 s | frames and the limit | shorten |
| `clip-short` | `from + for + tail` exceeds the clip's frame count | needed and available frames; the `tail` and the transition that causes it | lower `from` or `for`, shorten the next shot's transition, or use `cut` / `zoom` / `flash` / `dip` (no tail) |
| `transition-first` | `shots[0]` has an `in` other than `cut` | – | remove it |
| `transition-too-long` | `frames` is more than half of the incoming or the outgoing shot | both lengths | at most the given number |
| `motion-range` | a scale outside 1.01…1.5, or `punch-in.at` outside the shot | the value and the range | – |
| `window-range` | a window leaves its shot, is shorter than `2 × frames + 1`, or two windows of a shot overlap | the frames | move or lengthen it |
| `box-out-of-range` | a box value outside 0…100, `left ≥ right` or `top ≥ bottom`, or a box smaller than 16 px | the box | – |
| `outside-safe-area` | a text, caption or card box leaves the safe area | the box and the safe area in percent | move the box inside, or add `"safe": false` |
| `time-range` | `at + for` exceeds `frames` (text, card, sound, caption word) | both numbers | shorten or move |
| `animation-too-long` | `enter.frames + exit.frames + stagger × (lines − 1) > for` | the three numbers | shorten the animations or lengthen the element |
| `style-unknown` | a style name that is neither in `styles` nor a preset | the name and the names available | – |
| `style-value` | a colour, shadow, weight, size, outline or plate value fails its pattern or range | the value and the pattern | – |
| `text-empty` | `copy` is empty after trimming | – | – |
| `text-glyph` | the copy has a character the font's table does not cover | the characters (for example CJK, Arabic) | remove them; only Latin, Latin-1 and Latin Extended-A are covered |
| `text-too-long` | the copy does not fit its box on `lines` lines at `shrink` × size | the smallest size tried, the width needed, the box width | shorten the copy, enlarge the box, raise `lines` or lower `shrink` (≥ 0.5) |
| `words-order` | caption words overlap or are not in ascending order | the two words and their frames | – |
| `caption-word-too-long` | one caption word is wider than the box at the style size | the word, its width, the box width | enlarge the box or lower the style's size |
| `card-duplicate` | two cards with the same media, `at` and `for` | both ids | change one frame or merge them |
| `gain-range` | a gain outside 0…2, a duck `to` above the music gain | the value | – |
| `unfilled:<placeholder>` | a `{placeholder}` is left in a copy (as today) | the placeholder | – |

`mark-unknown` and `mark-unbalanced` stay in `resolve` (speech mode), not in `compose`: an edit document has no marks, only frames.

---

## 7. `timeline.json`

Everything a test needs to check a render by frame, without reading the HTML.

```ts
export interface Rect { x: number; y: number; width: number; height: number }       // integer pixels
export interface Rest { at: Frame; for: Frames }                                    // frames on which the element stands still at full opacity

export interface Timeline {
  fps: number; frames: number; width: number; height: number;
  shots: { id: string; element: string; media: string; at: Frame; for: Frames; tail: Frames; from: Frame }[];
  //   on screen on frames at … at+for+tail−1; output frame f shows source frame  from + (f − at)
  transitions: { kind: string; from: string; to: string; cut: Frame; at: Frame; for: Frames; overlap: boolean }[];
  //   cut = the incoming shot's at; at / for = the frames on which the effect is visible
  windows: { shot: string; behind: string; at: Frame; for: Frames; frames: Frames; rect: Rect; radius: number }[];
  texts: { id: string; line: number; element: string; copy: string; at: Frame; for: Frames; rect: Rect; size: number; rest: Rest }[];
  captions: { group: number; element: string; at: Frame; for: Frames; rect: Rect; size: number; lines: string[];
              words: { index: number; text: string; at: Frame; for: Frames }[]; rest: Rest }[];   // word.at / for = the frames on which it is the active word
  cards: { id: string; element: string; media: string; at: Frame; for: Frames; rect: Rect; rest: Rest }[];
  audio: { element: string; media: string; at: Frame; for: Frames; from: Frame; gain: [Frame, number][] }[];   // points on the timeline, linear in between
  animations: { element: string; property: 'opacity' | 'x' | 'y' | 'scale' | 'blur' | 'window' | 'active';
                at: Frame; for: Frames; from: number; to: number; ease: Ease | 'step'; hold: 'before' | 'after' | 'both' | 'none' }[];
  checkAt: Frame[];                                                                  // the middle frame of every rest window; the renderer passes frame / fps to check --at
}
```

**Value of an animation on frame `f`:** `p = (f − at + 0.5) / for`; `f < at` → `from` when `hold` is `before` or `both`, else the element's resting value; `f ≥ at + for` → `to` when `hold` is `after` or `both`, else the resting value; otherwise `from + (to − from) · ease(p)` (`step`: `to`). `x`, `y`, `blur` are in pixels, `window` is 0 (full frame) … 1 (the window's rect), `active` is 0 / 1.

What a test checks with it (each of these checks exists in the spike's verifiers):
- **every cut:** frame `cut − 1` shows source frame `A.from + (cut − 1 − A.at)` of the outgoing shot, frame `cut` shows `B.from` of the incoming one; inside an overlap both are present (`p4-transitions/run.mjs`);
- **every text edge:** nothing in `rect` on `at − 1` and on `at + for`; the text is solid on every frame of `rest` (on the first and the last frame of a fade it is at 1/(2n) opacity — a pixel test must use `rest`, P10 showed that);
- **every animation edge:** the measured opacity, position or scale on `at`, `at + for − 1` and `at + for` equals the value rule (`p1-text/run.mjs`);
- **captions:** the active word changes exactly on the `at` of each word (`p3-captions/run.mjs`);
- **sound:** the gain measured per 100 ms equals the points (`p9-av/run.mjs`).

---

## 8. How the pipeline reaches an edit document **[designed]**

- `resolve(template: TemplateJson, fill: FillJson, media: ComposeMedia): Edit` — pure. Beats: `shots` keep `at` / `for`, `media` = `clip:<shot id>` → key `<shot id>`; `texts` take `fill.texts[id]` as `copy`, the template's box and style; `styles` are the template's (the existing six fields are a valid `TextStyle`); `audio.music` = `{ media: 'music', gain }`. Speech: shot lengths are the measured segment clips, `shot.sound = { gain: 1 }`, `captions.words` come from `alignWords` (seconds → `Math.round(seconds × fps)`), marks become `at` / `for` of texts and cards, `duck.under = 'sound'`.
- **Template gains optional fields with the Edit types**, copied by `resolve`: `shots[].in`, `shots[].motion`, `shots[].windows`, `texts[].enter`, `texts[].exit`, `texts[].lines`, `captions.{box, style, group, active}`, `cards[].{enter, exit}`, `audio.music.{duck, fadeOut}`, `safe`. Without them the presets of §4 apply (a text in a template whose style is not a preset gets `fade 6 / fade 6`).
- `compose(edit, facts)` replaces `compose(template, fill, media)`; `seconds()`, `writeComposition`, `parseScript`, `alignWords` keep their signatures. `Composition.files` lists every `assets/…` the HTML names, so `writeComposition` can refuse a missing one (R14).
- Tests of revision §4 Task 2 that change: "no tween anywhere" → "no `<script>`, no `will-change`, and no keyframe that names `opacity`, `scale`, `translate`, `transform` or `filter`"; "no stroke property appears" stays; "a line is gone on the frame after its last one" stays; "a text of three lines becomes three elements" stays, with pixel boxes.
- A hand-written document: `node viraleditor/src/cli.ts check <edit.json>` (validate → compose → `Renderer.check`), `… render <edit.json> --out <mp4>`, `… frames <edit.json> --at 12,48 --out <dir>` (stills, so an agent can look at its own work). The CLI probes the files of `media` for `MediaFacts` through `Media`.

---

## 9. Left out on purpose

- **Byte-identical output for an inset.** A video drawn below its pixel size differs by 1 / 255 on a few hundred pixels in about one frame in ten. Tests for compositions with a window compare decoded positions, not checksums.
- Speed changes, freeze frames, reverse; rotation, 3D, masks, shape wipes, shader transitions; per-letter animation; text on a path; free keyframes (an agent picks from the kinds above, it does not author curves).
- Colour grading, LUTs, filters on footage; `fit: contain` with a blurred fill; two videos side by side (only the window).
- Scripts in the output; GSAP, Lottie, sub-compositions; WAAPI (exact, but it needs a script).
- Fonts other than Inter and Montserrat; scripts beyond Latin Extended-A (an error, not a fallback); a bundled emoji font (an emoji renders in the machine's own emoji font and counts 1 em).
- Canvases other than 720×1280 and 1080×1920, frame rates other than 30.
- Beat detection, sound effects libraries, audio effects.

---

## 10. Spike facts

All commands run inside `spike/viraleditor-motion/` (first `node lib/gen-assets.mjs` for the test media, see its header for how a clip names its source frame); the CLI is `../viraleditor-render/node_modules/.bin/hyperframes` with `HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1` (`lib/hf.mjs`). Renders: `hyperframes render <dir> --fps 30 --quality looks --workers 4 --output <mp4>`; "identical" = equal `ffmpeg -f framemd5` of the decoded video on every frame; PNG comparisons use `--format png-sequence`. Results are in each folder's `out/result.json`.

| # | Technique | Command | Result | Numbers |
|---|---|---|---|---|
| P1 | CSS keyframes on a timed clip, on its child, on an untimed element; WAAPI; half-frame start; exit; enter + exit on one property; slide with three easings; scale with overshoot; blur-in | `node p1-text/run.mjs` | frame-exact, all four techniques; lint 0 findings, check ok | 150 frames, 720×1280. Opacity error ≤ 0.006 (1.5 / 255; 0.008 under the blur); position ≤ 0.28 px; width of a 60 px square ≤ 1.4 px; 0 edge errors. Two animations with fill `both` on one property: first frame shows 1.0 instead of 0.06. Renders with 4 workers ×2 and 1 worker: identical |
| P1b | The same scale animation written three ways, on text, a `<div>` and an `<img>` | `node p1-text/determinism.mjs` | only the custom-property form is reproducible | 90 frames, PNG, 4 renders with 4 workers + 2 with 1 worker. Custom property: 0 frames differ in every comparison, also 4 workers against 1. Direct `scale`: text 0–1 frame (max 226 / 255), div and img 3–16 of 90 (max 52). `will-change: transform`: 0 between runs with equal workers, 23 of 90 between 4 workers and 1 (max 148). In earlier runs of the same file direct `scale` on a div differed on 15–21 frames |
| P2 | Two shadows / `-webkit-text-stroke` + `paint-order` / ring of shadows, on bright and dark footage, 720 and 1080 | `node p2-outline/run.mjs` | outline wins on bright footage, equal on dark; the stroke has spikes, the ring does not (`c1080/out/zoom-caption-bright.png`) | Contrast of the white fill against the 2 px around it, bright footage: two shadows 2.3–3.4 : 1, stroke 6.4–9.9 : 1, ring 6.3–9.9 : 1. Dark footage: 6.6–9.9 : 1 for all. 1080 gives slightly higher values than 720 (9.9 against 7.3 for the hook). lint, check clean |
| P3 | 60 words over 20 s, 15 groups, one timed element per group, active word by keyframes on spans (colour + scale; pill) | `node p3-captions/run.mjs` | every edge on its frame | 600 frames. 61 active-word edges expected, 61 found, 0 missing, 0 extra; group on / off frames equal; 0 frames with the wrong style; 3 renders identical. lint: 2 warnings `timeline_track_too_dense` (8 and 7 groups on one track index); check ok |
| P4 | cut, crossfade 12, push left 12, zoom 8, whip left 10, flash 6, push up 12, dip 12 between nine shots of three bar clips | `node p4-transitions/run.mjs` | both sources exact on every frame | 540 frames. 563 bars decoded, 0 wrong, 0 unexpected, worst row error 0.48 px (6 px = one frame); 23 not decodable (opacity or width too small). Progress against the curve: crossfade ≤ 0.023, push ≤ 1 px, zoom scale ≤ 0.002, whip ≤ 12 px (blurred edge), flash ≤ 0.009, dip ≤ 0.017. 3 renders identical |
| P5 | Ken Burns (linear; in-out with the origin at 30 % / 40 %) and punch-in, on the wrapper and on the video | `node p5-shot-motion/run.mjs` | source frames exact under motion | 360 frames. 0 wrong source frames, scale error ≤ 0.0028, row error ≤ 0.13 px. 3 PNG renders: 0 frames differ; mp4 ×2 identical. In an earlier variant a wrapper with `will-change: transform` around a video differed on 26 of 60 frames |
| P6 | Window (40 % bottom right, 35 % top left) over an image, there and back; evidence image 1 → 1.1; card pop-in over footage | `node p6-inset/run.mjs` | exact; the window is not byte-reproducible | 480 frames. Window: 0 wrong source frames in 300, rect at rest exactly [392,640,288,512] and [40,128,252,448], ≤ 1.8 px off during the move, corner shows the picture behind. Image zoom: scale error ≤ 0.0034. Card: width error ≤ 2.2 px. 3 PNG renders: window 40 % differs on 13 of 150 frames (1 / 255 on ≤ 271 px), window 35 %, image and card on 0. mp4 ×2: 70 frames differ, up to 23 / 255. An earlier variant that animated `left / top / width / height` differed on 19 of 150 |
| P7 | Fitting: metrics table / container units / inline script; six copies (short, Turkish, emoji, one 44-letter word, 2 lines, 3 lines), box 600 px | `node lib/metrics.mjs && node p7-fit/run.mjs` | all three fit, pass check and render identically twice | Metrics: sizes 36, 26, 25, 25, 31, 27 px; estimate − ink width = +3.1…+5.7 px; the five shrunk copies fill 567–580 of 600 px; lines balanced. Container units: ink 452–594 px (one copy uses 75 % of the box, one ends 3 px from each edge). Script: ink 580–596 px, but needs a `<script>` and compose does not know the size |
| P8 | Inter and Montserrat at 100…900 from one variable `woff2` each; a missing font file; the `latin` subset alone with Turkish copy | `node p8-fonts/run.mjs` | weights work; only check notices a missing file; nothing notices a missing subset | Ink per weight rises strictly (Inter 953 → 6504, Montserrat 856 → 7530). Missing file: lint exit 0, check exit 1 (`http_error: 404`, `request_failed`), render exit 0 with a fallback font in two weights. Subset without `latin-ext`: lint 0, check ok, render 0, İ ş ğ in another font |
| P9 | Music looped by a second element, gain 0.5, ducked to 0.15 with 6-frame ramps, 12-frame fade-out; a clip's own sound; untagged against BT.709 clip | `node p9-av/run.mjs` | gains follow the lane; lane time is local to the element | Gain per 100 ms: music within 0.005 of the points outside ramps, ramps 0.411 / 0.238 against 0.413 / 0.238; own sound 0.984–1.003. rgb(40,140,70): untagged → (31,125,65), tagged → (36,138,65) |
| P10 | 1080×1920, 180 frames: three shots (push-in, punch-in, pull-out), crossfade, whip, fitted two-line hook with ring outline, card, two caption groups, looped ducked music | `node p10-all/run.mjs` | lint 0, check 0 findings (with `--at`), H.264 1080×1920 30 fps 180 frames + AAC 48 kHz, 2 renders identical | Hook fitted to 65 px, lines 709 and 866 px in 888 px. Caption edges on frames 62, 120, 122 |

Other facts read or seen on the way:

- The CSS adapter of the runtime sets `currentTime = max(0, t − start) × 1000` on every `CSSAnimation` whose target has a computed `animation-name` (`hyperframe.runtime.iife.js`, the adapter named `css`); the frame image that replaces a `<video>` copies the video's computed `opacity`, `transform`, `translate`, `scale`, `filter`, `border-radius`, `clip-path`, `object-fit`, `object-position`, `z-index` on every frame (`MEDIA_VISUAL_STYLE_PROPERTIES`). **[read]**
- With CSS animations present the render log says `static-frame dedup: disabled (no GSAP tweens (non-GSAP animation)+running CSS/WAAPI animation)`; with 4 workers the capture is `screenshot`, not `drawelement`. **[ran]**
- The pipeline is sensitive to one differing capture: x264 spreads a 1 / 255 difference over the following frames of the GOP (P6). **[ran]**
- `hyperframes snapshot` sends frames to Gemini when `GEMINI_API_KEY` is set (its help text); the spike never ran it. **[read]**
- Fonts were installed with `npm install --offline` from the npm cache into the spike folder (`@fontsource-variable/inter` 5.3.0, `@fontsource-variable/montserrat` 5.3.0, OFL-1.1); `lib/metrics.mjs` drives Chrome with the `puppeteer-core` 25.12.0 (Apache-2.0) that `hyperframes` installs. No package was added to `viraleditor/`.

---

## 11. Open

**Not proved**

- **Other machines.** Everything ran on one Mac, GPU path, Chrome 152. Whether renders are identical between two machines, on Linux or in Docker (`beginframe` capture) was not tried. The custom-property rule removes the cause found here; it is not shown to be the only cause.
- **The window, byte for byte.** No way was found to make a downscaled video reproducible (transform: 1–13 of 150 frames; layout: 19 of 150). Pre-scaling the clip with ffmpeg for the time it rests in the window would avoid it; not tried.
- **Length and count.** Longest render 20 s / 600 frames; most timed elements in one composition 21. Hundreds of caption groups, 60 s and their render time belong to the other spikes. The `timeline_track_too_dense` threshold lies between 6 and 7 elements per track index; 6 was not tried.
- **Designed, not rendered:** `plate`, `stagger`, `slide` and `blur` as text exits through the final stylesheet (slide-out and blur-out ran as shot transitions and as probes), `focus` as `object-position`, a `window` over a video instead of an image, `push` to `right` / `bottom`, `sounds`, `fadeIn`, the `label` and `tag` presets, the caption grouping rule (P3 used fixed groups of four), `resolve`, the CLI.
- **Safe-area numbers** (§4.4) are from memory of the platforms' guidance. They need one look at the current TikTok and Reels specifications before they become defaults.
- **Emoji.** The fit counts 1 em (measured for Apple Color Emoji). On a machine with another emoji font the width and the picture differ.
- **Colour.** BT.709 tags brought the error from 15 / 255 to 5 / 255, not to 0. `--video-frame-format png` was not tried.
- **Kerning.** The table ignores it; the estimate was 3–6 px wider than the ink on six copies (the safe side). A font with strong kerning pairs in large sizes could come closer to the 2 % margin than these did.
- **check during motion.** The gate samples rest frames only. Whether a text that slides in from outside its box makes `check` report an overflow on a frame inside the animation was not tried; `checkAt` avoids those frames.

**Needs the owner or the controller**

- `Edit.canvas` allows only the two sizes that ran. If 24 or 25 fps output is wanted, P1 and P4 have to be run again at that rate (the half-frame rule does not depend on the rate, the proof does).
- The metrics table needs a driver for Chrome at build time. `playwright-core` is already a dependency of `viraleditor/`; the spike used `puppeteer-core` from HyperFrames' own tree. With `playwright-core` the script was not run.
- Template fields for motion (§8) change `template/schema.ts`, which the Task 2 owner holds.

---

## 12. Controller rulings after the spikes (binding; newer than the sections above)

The types of §3 and §7 are in `viraleditor/src/edit/types.ts` and `viraleditor/src/edit/timeline.ts` (frozen contract files; they carry the changes below).

1. **Music is not looped by default** (`loop` default `false`). Spike S3: a loop of several `<audio>` elements clicks unless every pass starts on a whole millisecond (a 32-sample hole was measured), and a bed that fades out leaves a hole. With `loop: true` each pass is cut to a multiple of 3 frames (100 ms), so every pass starts on a whole millisecond. Music shorter than the video without `loop` → error `music-short` (fix: a longer file, or `"loop": true`). The pipeline asks for music after the clips are measured, at least as long as the video.
2. **A volume lane has at most 512 points** (S3: more are cut silently). More than 512 on one element → error `duck-too-dense` (fix: fewer ducking ranges, or `under: 'sound'`).
3. **Loudness is ours.** `Edit.audio.master` (default `{ lufs: -14, peak: -1 }`, `false` = off) goes into `timeline.json` as `master`; after the render the renderer measures the mix and applies one gain-only pass (video stream copied) that brings it to the target without passing the peak. No dynamics processing. A video with no sound at all skips the pass.
4. **Nothing draws on a `<video>`**: `box-shadow` and `border` on a video are not rendered (S3). A window's ring, if one is ever wanted, is its own element. Not in version 1.
5. **Captions are fitted by compose**, never left to `hyperframes check` (S3: an overlong caption line is missed by the default samples and is only a warning when sampled).
6. **Time of a word** in `captions.words` is frames; `resolve` rounds seconds with `Math.round(seconds × fps)` and then removes overlaps (a word never starts before the previous one ends; a word of 0 frames gets 1).
7. **`compose(edit, facts)`** takes `Record<MediaKey, ComposeFacts>`; a `ports.MediaFacts` fits. `ComposeError` lives in `viraleditor/src/compose/`; `EditIssue` in `edit/types.ts`.
8. **Text fitting is its own module**, `viraleditor/src/fit/` (the metrics table and `fitText`); compose and the caption grouping call it.
9. **Tests that compare checksums** do so only for compositions without a window (§9). A composition with a window is checked by decoded positions.
10. **Track indexes:** HyperFrames 0.8.120 warns above 3 non-video timed elements per track index (not 5, §5.4) and on overlapping audio on one index. Compose allocates indexes: at most 3 per index, never overlapping, sound elements never back to back.
11. **`animation-too-long`** is `enter + exit + stagger × (lines − 1) ≥ for`: every element keeps at least one rest frame (the timeline's `rest` and `checkAt` need one).
12. **Windows:** the windows of one shot are in ascending order, share one corner, width and radius, cannot combine with a `zoom` transition into the shot and cannot start during the incoming overlap. `behindMotion` sits on the wrapper behind the window. A window can change its picture (`swaps`, §3 types) instead of returning and shrinking again.
13. **A card with a `motion`** is a box plus an image, like a shot. A card shows the whole picture by default (`fit: 'contain'`): the facts carry the picture's `width` and `height`.
14. **Two more codes:** `sound-duplicate` (two sounds with the same file, start and length) and `blur-too-many` (more than 24 blurred elements: the linter warns at 25 and captures go black at about 40). Also `media-facts`, `music-short`, `duck-too-dense`, `media-size-unknown`.
15. **Whip and push:** on the cut frame the incoming shot is still almost wholly off screen (99.8 % of the width); a test reads its source frame on the first readable frame with the rule `from + (f − cut)`. §4.3's sentence is about the clock (`data-start = C / fps`), and that holds in every kind.
16. **Safe area** (replaces the table of §4.4): a rectangle minus the button column. `both` and `reels`: left 6, top 14, right 94, bottom 65; `tiktok`: left 6, top 8, right 94, bottom 78. The button column is x from 86 to 100, y from 45 to the rectangle's bottom: no text, caption or card box may enter it. (The single rectangle with right = 86 refused every wide hook at the top, the design's own example included.) The numbers come from third-party guides; the platforms publish no single figure.
17. **`checkAt`:** a sample lies inside an element's rest AND outside every transition's effect frames and every other element's enter and exit; an element whose rest has no such frame gives no sample.
