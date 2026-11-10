// The edit document: the one file that fully describes a montage (docs/plans/2026-10-04-viraleditor-editor-design.md §3).
// Frozen contract: resolve() produces it, compose() consumes it, an agent may write it by hand. Changes go through the controller.

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
  media: Record<MediaKey, { file: string; kind: 'video' | 'image' | 'audio' }>;   // file: ^assets/[A-Za-z0-9_-][A-Za-z0-9._-]*$ (a name never starts with a dot)
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
  swaps?: { at: Frame; behind: MediaKey }[];        // the picture behind changes on these frames (a cut, no second shrink): a before / after in one window. Ascending, each inside the window's rest (after the shrink, before the return)
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
  fit?: 'contain' | 'cover';                         // default 'contain': the whole picture is shown, as large as the box allows, centred in it (a product photo is never cropped); 'cover' fills the box and crops
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
    loop?: boolean;                                  // default false (ask for music at least as long as the video). true: passes follow back to back, each cut to a multiple of 3 frames so that every pass starts on a whole millisecond
    fadeIn?: Frames; fadeOut?: Frames;               // default 0 / 12
    duck?: { to: number; ramp?: Frames; under: 'sound' | 'captions' | { at: Frame; for: Frames }[] };   // ramp default 6
  };
  sounds?: { id: Id; media: MediaKey; at: Frame; for?: Frames; from?: Frame; gain: number }[];   // effects; for defaults to the file's length
  master?: { lufs: number; peak?: number } | false;  // default { lufs: -14, peak: -1 }: after the render one gain-only pass brings the mix to this loudness (LUFS) without passing the peak (dBTP); false leaves the mix as rendered
}

// ── compose ──
/** What compose needs to know about a media file. video: frames at the canvas fps · audio: floor(seconds × fps) · image: 0. A ports.MediaFacts fits. */
export interface ComposeFacts { frames: number; audio: boolean; width?: number; height?: number }   // width / height: the picture's pixels; an image shown by a card with fit 'contain' needs them
/** One thing wrong with an edit document. path: 'shots[2].in.frames' · fix: what to change, written for an agent. Codes: design §6. */
export interface EditIssue { code: string; path: string; message: string; fix: string }
