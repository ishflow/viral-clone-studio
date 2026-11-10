// The defaults of the edit document (design §4): text styles, easings, transition windows, safe areas, and the limits.
// Sizes are written for a canvas 1080 wide; on 720 they are multiplied by 2/3 and rounded.
import type { Box, Card, Captions, Ease, Edit, EditText, Enter, Exit, Frame, Frames, MediaKey, Motion, Shot, TextStyle, Transition, Window } from './types.ts';

export const FPS = 30;
export const CANVASES = [{ width: 720, height: 1280 }, { width: 1080, height: 1920 }] as const;
export const LIMITS = {
  seconds: 60, shotSeconds: 15,            // the whole video; one shot
  minBox: 16,                              // px: a box smaller than this is an error
  scale: [1.01, 1.5] as const,             // a motion's or a zoom's scale
  gain: [0, 2] as const,
  lanePoints: 512,                         // a volume lane holds no more (§12.2)
  loopStep: 3,                             // a pass of looped music is cut to a multiple of this many frames (§12.1)
  loopFrames: 30,                          // a file that is looped has at least this many frames: a shorter one makes dozens of elements
  blurred: 24,                             // elements that carry a blur: the linter warns from 25, captures go black at about 40 (§12.14)
};

/**
 * The most entries each list of a document may have, keyed by the place of the list (`[]`: each entry, `<name>`: each key).
 * A longer list is refused with `too-many` before anything walks it (parseEdit, and validate when it is called alone).
 * One table: the field reference of the command line and the guide read it.
 */
export const COUNTS = {
  media: 300, styles: 50, 'styles.<name>.shadows': 8,
  shots: 120, 'shots[].windows': 8, 'shots[].windows[].swaps': 8,
  texts: 200, 'captions.words': 600, cards: 100,
  'audio.sounds': 100, 'audio.music.duck.under': 600,
} as const;

/**
 * The most characters each string of a document may have (UTF-16 units), by what the string is. Every `z.string()` of the
 * schema reads its limit here, and a longer string is refused (`schema`) before any rule runs. One table: the field reference of
 * the command line reads it.
 *   id: an id, a media key, a style name (the id pattern allows 32; a reference to one is as long);
 *   file: `assets/` and a name: a path of a file name is never longer than that;
 *   colour: `#rrggbbaa` is 9; room is left for a stray space;
 *   shadow: "-12.5px -12.5px 100.25px #aabbccdd" is 35;
 *   language: "zh-Hant-TW" is 10; a BCP 47 tag with variants fits in 16;
 *   word: a caption word, no more than the pattern said before;
 *   copy: a text's words, as before.
 */
export const STRINGS = { id: 32, file: 200, colour: 32, shadow: 64, language: 16, word: 60, copy: 200 } as const;

// ── §4.2 easings ──
/** Control points of the cubic Bézier; null is linear. The tests use the numbers to predict a frame. */
export const EASINGS: Record<Ease, readonly [number, number, number, number] | null> = {
  linear: null,
  out: [0.16, 1, 0.3, 1],
  in: [0.7, 0, 0.84, 0],
  'in-out': [0.65, 0, 0.35, 1],
  back: [0.34, 1.56, 0.64, 1],
  whip: [0.8, 0, 0.2, 1],
};
export function cssEase(ease: Ease): string {
  const points = EASINGS[ease];
  return points ? `cubic-bezier(${points.join(',')})` : 'linear';
}

// ── §12.16 safe areas, percent of the canvas; right and bottom are edges ──
// The safe area is a rectangle minus the column of the platform's buttons at its lower right.
const SAFE_AREAS: Record<NonNullable<Edit['safe']>, Box> = {
  tiktok: { left: 6, top: 8, right: 94, bottom: 78 },
  reels: { left: 6, top: 14, right: 94, bottom: 65 },
  both: { left: 6, top: 14, right: 94, bottom: 65 },
  none: { left: 0, top: 0, right: 100, bottom: 100 },
};
const BUTTONS = { left: 86, top: 45 };     // the column runs from here to the right edge of the canvas and to the rectangle's bottom
/** The rectangle of the safe area. */
export function safeArea(edit: Edit): Box {
  return SAFE_AREAS[edit.safe ?? 'both'];
}
/** The column of the buttons, which nothing safe may enter; null when the document has no safe area. */
export function buttonColumn(edit: Edit): Box | null {
  return (edit.safe ?? 'both') === 'none' ? null : { left: BUTTONS.left, top: BUTTONS.top, right: 100, bottom: safeArea(edit).bottom };
}
/** Does a box reach into another one? Boxes that only touch do not. */
export function meets(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// ── §4.1 text styles ──
const PRESET_STYLES: Record<string, TextStyle> = {
  hook: { font: 'Inter', weight: 800, size: 72, align: 'center', fill: '#ffffff', shadows: ['0px 4px 14px #00000080'], leading: 1.15, outline: { width: 0.08, colour: '#000000' } },
  label: { font: 'Inter', weight: 600, size: 44, align: 'center', fill: '#ffffff', shadows: [], outline: { width: 0.07, colour: '#000000' } },
  tag: { font: 'Inter', weight: 700, size: 40, align: 'center', fill: '#ffffff', shadows: [], plate: { colour: '#e0508c', radius: 0.3, padX: 0.5, padY: 0.22 } },
  caption: { font: 'Montserrat', weight: 900, size: 84, align: 'center', fill: '#ffffff', shadows: [], upper: true, leading: 1.28, outline: { width: 0.08, colour: '#000000' } },
};
export const DEFAULT_LEADING = 1.15;
/** The height of one line of a style at `size`, in whole pixels (R5). */
export function lineHeightOf(style: TextStyle, size: number = style.size): number {
  return Math.round(size * (style.leading ?? DEFAULT_LEADING));
}

/** A length written for the 1080 canvas, on a canvas `width` wide. */
function scaled(px: number, width: number): number {
  return Math.round((px * width) / 1080);
}

/** The styles a document can name: the presets at this canvas's size, then the document's own (which may replace a preset). */
export function stylesOf(edit: Edit): Record<string, TextStyle> {
  const styles: Record<string, TextStyle> = {};
  for (const [name, style] of Object.entries(PRESET_STYLES)) {
    styles[name] = {
      ...style,
      size: scaled(style.size, edit.canvas.width),
      shadows: style.shadows.map((shadow) => shadow.replace(/(-?\d+(?:\.\d+)?)px/g, (_, px: string) => `${scaled(Number(px), edit.canvas.width)}px`)),
    };
  }
  for (const [name, style] of Object.entries(edit.styles ?? {})) styles[name] = style;
  return styles;
}

// ── how a text comes and goes when it does not say (§4.1; a style that is not a preset: fade 6 / fade 6, §8) ──
interface TextMotion { enter: Enter; exit: Exit; stagger: number }
const TEXT_MOTION: Record<string, TextMotion> = {
  hook: { enter: { kind: 'pop', frames: 8 }, exit: { kind: 'fade', frames: 6 }, stagger: 2 },
  label: { enter: { kind: 'fade', frames: 6 }, exit: { kind: 'fade', frames: 6 }, stagger: 0 },
  tag: { enter: { kind: 'pop', frames: 6 }, exit: { kind: 'fade', frames: 6 }, stagger: 0 },
  caption: { enter: { kind: 'pop', frames: 5, from: 0.8 }, exit: { kind: 'none' }, stagger: 0 },
};
const OTHER_TEXT_MOTION: TextMotion = { enter: { kind: 'fade', frames: 6 }, exit: { kind: 'fade', frames: 6 }, stagger: 0 };

/**
 * A text's motion. `own` is the document's `styles`: a style it names is a style of its own, even when it carries a
 * preset's name (it replaces the preset), and takes the fade 6 / fade 6 of a style of its own, not the preset's.
 */
export function textMotion(text: EditText, own?: Edit['styles']): TextMotion {
  const preset = Object.hasOwn(TEXT_MOTION, text.style) && !(own && Object.hasOwn(own, text.style)) ? TEXT_MOTION[text.style]! : OTHER_TEXT_MOTION;
  return { enter: text.enter ?? preset.enter, exit: text.exit ?? preset.exit, stagger: text.stagger ?? preset.stagger };
}
export function cardMotion(card: Card): { enter: Enter; exit: Exit } {
  return { enter: card.enter ?? { kind: 'pop', frames: 8 }, exit: card.exit ?? { kind: 'pop', frames: 8 } };
}

// ── enter and exit (§3) ──
const ENTER_FRAMES = { none: 0, fade: 6, pop: 8, slide: 8, blur: 8 } as const;
export const ENTER = { popFrom: 0.6, popTo: 0.8, popFade: 4, slideDistance: 4, blurRadius: 2.2 };   // distance: % of the height; radius: % of the width
/** Frames an enter or an exit takes; `none` takes 0. */
export function motionFrames(motion: Enter | Exit): number {
  return motion.kind === 'none' ? 0 : motion.frames ?? ENTER_FRAMES[motion.kind];
}

// ── captions (§3) ──
export function captionDefaults(captions: Captions) {
  return {
    style: captions.style ?? 'caption',
    words: captions.group?.words ?? 3, lines: captions.group?.lines ?? 2, hold: captions.group?.hold ?? 12, pause: captions.group?.pause ?? 15,
    active: captions.active ?? { kind: 'colour' as const, colour: '#ffe000', scale: 1.06 },
    enter: captions.enter ?? { kind: 'pop' as const, frames: 5, from: 0.8 },
  };
}
export const ACTIVE_SCALE = 1.06;            // of the active word when `colour` gives none
export const ACTIVE_POP = 0.06;              // the word's pop goes this far past its scale

// ── shots: motion and transitions (§3, §4.3) ──
export const MOTION = { pushTo: 1.08, pullFrom: 1.08, punchTo: 1.2, punchFrames: 4 };
/** The scale a motion starts from and ends at. */
export function motionScale(motion: Motion): { from: number; to: number } {
  if (motion.kind === 'pull-out') return { from: motion.from ?? MOTION.pullFrom, to: 1 };
  return { from: 1, to: motion.to ?? (motion.kind === 'push-in' ? MOTION.pushTo : MOTION.punchTo) };
}

const TRANSITION_FRAMES = { cut: 0, crossfade: 8, push: 10, whip: 8, zoom: 8, flash: 6, dip: 12 } as const;
export const TRANSITION = { zoomScale: 1.3, flashColour: '#ffffff', dipColour: '#000000', whipBlur: 3.3 };   // whipBlur: % of the width
export function transitionOf(shot: Shot): Transition {
  return shot.in ?? { kind: 'cut' };
}
/** Frames the effect of a transition takes; a cut takes 0. */
export function transitionFrames(transition: Transition): number {
  return transition.kind === 'cut' ? 0 : transition.frames ?? TRANSITION_FRAMES[transition.kind];
}
/** Does the outgoing shot stay on screen under the incoming one (§4.3)? */
export function overlaps(transition: Transition): boolean {
  return transition.kind === 'crossfade' || transition.kind === 'push' || transition.kind === 'whip';
}
/** Frames shot `index` stays after its own time, because the next shot comes in over it. */
export function tailOf(shots: Shot[], index: number): number {
  const next = shots[index + 1];
  if (!next) return 0;
  const transition = transitionOf(next);
  return overlaps(transition) ? transitionFrames(transition) : 0;
}

// ── windows (§3) ──
export const WINDOW = { width: 38, radius: 2.6, frames: 10 };
/** Percent of the height a window keeps clear of the safe area's edge: more than the rounding of its size to whole pixels adds (under 9 px of 1280). */
const WINDOW_CLEAR = 1;
/**
 * The widest window the document may ask for, in percent of the canvas width. A window has the canvas's ratio, so its
 * height in percent of the height is its width in percent of the width, and it must fit the height of the safe area
 * ('both' and 'reels': 51 % high → 50). `window.width` is checked against it.
 */
export function maxWindowWidth(edit: Edit): number {
  const area = safeArea(edit);
  return Math.min(60, area.bottom - area.top - WINDOW_CLEAR);
}
/** The pictures behind a window in time order: the first from the window's start, each swap from its frame to the next one. */
export function windowPictures(window: Window): { behind: MediaKey; at: Frame; for: Frames }[] {
  const all = [{ at: window.at, behind: window.behind }, ...(window.swaps ?? [])];
  return all.map((picture, i) => ({ behind: picture.behind, at: picture.at, for: (all[i + 1]?.at ?? window.at + window.for) - picture.at }));
}
export const CARD_RADIUS = 3.3;              // % of the width

// ── sound (§3, §12) ──
export const MUSIC = { fadeIn: 0, fadeOut: 12, ramp: 6 };
export const MASTER = { lufs: -14, peak: -1 };
