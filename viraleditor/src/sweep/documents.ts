// The edit documents of the sweep, as builders. Texts, captions and cards use fills with the red channel at 255 (the media
// have it at 0); every box lies inside the safe area (left 6–86 %, top 14–65 %) or the element says "safe": false.
import type { Box, Captions, Edit, Shot, TextStyle, Transition } from '../edit/types.ts';
import { mediaOf } from './suite.ts';

export const RED: TextStyle = { font: 'Inter', weight: 800, size: 64, align: 'center', fill: '#ff0000', shadows: [] };
export const box = (top: number, bottom: number, left = 10, right = 80): Box => ({ left, top, right, bottom });

export function base(frames: number, keys: string[], shots: Shot[], extra: Partial<Edit> = {}, canvas: Edit['canvas'] = { width: 720, height: 1280, fps: 30 }): Edit {
  return { version: 1, language: 'en', canvas, frames, media: mediaOf(...keys), styles: { red: RED }, shots, ...extra };
}

/** 01: cuts on odd frames, a shot of one frame, a `from` offset, focus, every motion; texts whose edges meet a cut. */
export function cuts(): Edit {
  return base(150, ['va', 'vb', 'vc', 'img-p', 'img-q'], [
    { id: 's1', at: 0, for: 37, media: 'va', motion: { kind: 'push-in', to: 1.2 } },
    { id: 's2', at: 37, for: 21, media: 'img-p', motion: { kind: 'pull-out', from: 1.15 } },
    { id: 's3', at: 58, for: 1, media: 'vb', from: 40 },
    { id: 's4', at: 59, for: 44, media: 'vc', from: 20, focus: [30, 60], motion: { kind: 'push-in', to: 1.1 } },
    { id: 's5', at: 103, for: 47, media: 'img-q', motion: { kind: 'punch-in', at: 115 } },
  ], {
    texts: [
      { id: 'ta', at: 36, for: 3, box: box(20, 28), style: 'red', copy: 'BEFORE', enter: { kind: 'none' }, exit: { kind: 'none' } },
      { id: 'tb', at: 58, for: 2, box: box(32, 40), style: 'red', copy: 'ONE FRAME', enter: { kind: 'none' }, exit: { kind: 'none' } },
      { id: 'tc', at: 103, for: 5, box: box(44, 52), style: 'red', copy: 'AT CUT', enter: { kind: 'none' }, exit: { kind: 'none' } },
      { id: 'td', at: 100, for: 3, box: box(56, 64), style: 'red', copy: 'ENDS', enter: { kind: 'none' }, exit: { kind: 'none' } },
    ],
  });
}

/** 02: every transition kind between a clip and a picture and back (video → image, image → video), with motion and focus. */
export function transitionsVideoImage(): Edit {
  return base(7 * 30, ['va', 'vb', 'vc', 'img-p', 'img-q', 'img-r'], [
    { id: 's1', at: 0, for: 30, media: 'va' },
    { id: 's2', at: 30, for: 30, media: 'img-p', in: { kind: 'crossfade' }, motion: { kind: 'push-in', to: 1.15 } },
    { id: 's3', at: 60, for: 30, media: 'vb', from: 7, in: { kind: 'push', to: 'left' }, motion: { kind: 'pull-out', from: 1.12 }, focus: [70, 40] },
    { id: 's4', at: 90, for: 30, media: 'img-q', in: { kind: 'whip', to: 'right' } },
    { id: 's5', at: 120, for: 30, media: 'vc', from: 33, in: { kind: 'zoom' }, motion: { kind: 'punch-in', at: 140, frames: 3 } },
    { id: 's6', at: 150, for: 30, media: 'img-r', in: { kind: 'flash' } },
    { id: 's7', at: 180, for: 30, media: 'va', from: 61, in: { kind: 'dip' } },
  ]);
}

/** 06: the exits of a text on a flat picture: a fade, a blur and a slide with the same copy, so a measure can tell them apart. */
export function textExits(): Edit {
  return base(90, ['img-p'], [{ id: 's1', at: 0, for: 90, media: 'img-p' }], {
    texts: [
      { id: 'fade', at: 6, for: 56, box: box(16, 24), style: 'red', copy: 'FADE OUT', enter: { kind: 'none' }, exit: { kind: 'fade', frames: 12 } },
      { id: 'blur', at: 6, for: 56, box: box(30, 38), style: 'red', copy: 'BLUR OUT', enter: { kind: 'none' }, exit: { kind: 'blur', frames: 12 } },
      { id: 'blur-in', at: 20, for: 60, box: box(44, 52), style: 'red', copy: 'BLUR IN', enter: { kind: 'blur', frames: 10 }, exit: { kind: 'none' } },
      { id: 'slide', at: 6, for: 56, box: box(56, 64), style: 'red', copy: 'SLIDE UP', enter: { kind: 'none' }, exit: { kind: 'slide', to: 'top', frames: 12, distance: 3 } },
    ],
  });
}

const six = (sides: ['top', 'bottom', 'left']): Transition[] => [
  { kind: 'crossfade', frames: 9 }, { kind: 'push', to: sides[0] }, { kind: 'whip', to: sides[1] }, { kind: 'zoom', scale: 1.4 }, { kind: 'flash', colour: '#ff8000' }, { kind: 'dip', colour: '#404040' },
];

/** 03: every transition kind between two clips (video → video), each clip taken from another offset; motions on some. */
export function transitionsVideoVideo(): Edit {
  const kinds = six(['top', 'bottom', 'left']);
  const clips: [string, number][] = [['va', 0], ['vb', 11], ['vc', 3], ['va', 90], ['vb', 50], ['vc', 70], ['va', 25]];
  const shots: Shot[] = clips.map(([media, from], i) => ({
    id: `s${i + 1}`, at: i * 30, for: 30, media, from, ...(i > 0 ? { in: kinds[i - 1]! } : {}),
    ...(i % 3 === 1 ? { motion: { kind: 'push-in' as const, to: 1.12 } } : i % 3 === 2 ? { motion: { kind: 'pull-out' as const, from: 1.2 }, focus: [25, 70] as [number, number] } : {}),
  }));
  return base(7 * 30, ['va', 'vb', 'vc'], shots);
}

/** 04 (1080 × 1920): every transition kind between two pictures (image → image), after one clip. */
export function transitionsImageImage(): Edit {
  const kinds: Transition[] = [{ kind: 'crossfade', frames: 6 }, { kind: 'push', to: 'right', frames: 12 }, { kind: 'whip', to: 'top', frames: 7 }, { kind: 'zoom', frames: 10 }, { kind: 'flash', colour: '#00ffff', frames: 5 }, { kind: 'dip', colour: '#808080', frames: 9 }];
  const keys = ['va', 'img-p', 'img-q', 'img-r', 'img-s', 'img-t', 'img-p'];
  const shots: Shot[] = keys.map((media, i) => ({
    id: `s${i + 1}`, at: i * 24, for: 24, media, ...(i > 0 ? { in: kinds[i - 1]! } : {}),
    ...(i === 2 ? { motion: { kind: 'push-in' as const, to: 1.3 } } : i === 4 ? { motion: { kind: 'pull-out' as const, from: 1.25 } } : {}),
  }));
  return base(7 * 24, ['va', 'img-p', 'img-q', 'img-r', 'img-s', 'img-t'], shots, {}, { width: 1080, height: 1920, fps: 30 });
}

/** 05: texts whose enter and exit meet a cut exactly, one frame before and one after, over footage; a staggered three-line text. */
export function textsAtCuts(): Edit {
  const none = { kind: 'none' as const };
  return base(150, ['vx', 'vy', 'vz'], [
    { id: 's1', at: 0, for: 40, media: 'vx' },
    { id: 's2', at: 40, for: 40, media: 'vy', from: 9 },
    { id: 's3', at: 80, for: 40, media: 'vz', from: 25, focus: [60, 40] },
    { id: 's4', at: 120, for: 30, media: 'vx', from: 100 },
  ], {
    texts: [
      { id: 'lines', at: 4, for: 30, box: box(14, 40), style: 'red', copy: 'ONE\nTWO\nTHREE', stagger: 3, enter: { kind: 'pop', frames: 8 }, exit: { kind: 'fade', frames: 6 } },
      { id: 't1', at: 40, for: 40, box: box(14, 24), style: 'red', copy: 'STARTS ON CUT', enter: { kind: 'pop', frames: 8 }, exit: { kind: 'fade', frames: 6 } },
      { id: 't2', at: 79, for: 14, box: box(34, 44), style: 'red', copy: 'ONE BEFORE', enter: { kind: 'fade', frames: 6 }, exit: none },
      { id: 't3', at: 81, for: 24, box: box(54, 64), style: 'red', copy: 'ONE AFTER', enter: { kind: 'slide', from: 'left', frames: 8, distance: 3 }, exit: { kind: 'fade', frames: 4 } },
      { id: 't4', at: 90, for: 29, box: box(14, 24), style: 'red', copy: 'ENDS BEFORE', enter: none, exit: { kind: 'blur', frames: 8, radius: 1.5 } },
      { id: 't5', at: 100, for: 21, box: box(34, 44), style: 'red', copy: 'ENDS AFTER', enter: none, exit: { kind: 'slide', to: 'bottom', frames: 8, distance: 3 } },
    ],
  });
}

const CAP: TextStyle = { font: 'Montserrat', weight: 800, size: 64, align: 'center', fill: '#ff0000', shadows: [] };
/** Words of 1 and 2 frames among longer ones, a cut under the middle of a group and another on a group's first word. */
export const WORDS: { text: string; at: number; for: number }[] = [
  { text: 'HELLO', at: 8, for: 6 }, { text: 'THERE', at: 14, for: 2 }, { text: 'MY', at: 16, for: 1 },
  { text: 'FRIEND', at: 17, for: 8 }, { text: 'LOOK', at: 25, for: 2 }, { text: 'AT', at: 27, for: 1 },
  { text: 'THIS', at: 52, for: 4 }, { text: 'COOL', at: 56, for: 2 }, { text: 'CUT', at: 58, for: 1 },
  { text: 'NOW', at: 60, for: 1 }, { text: 'HERE', at: 61, for: 2 }, { text: 'WE', at: 63, for: 1 },
  { text: 'GO', at: 70, for: 20 },
];
function captions(active: Captions['active'], top = 34, bottom = 52): Captions {
  return { box: box(top, bottom), style: 'cap', words: WORDS, active };
}

/** 07: word by word captions with the pill, across a cut. */
export function captionsPill(): Edit {
  return base(120, ['img-p', 'img-q'], [
    { id: 's1', at: 0, for: 60, media: 'img-p' },
    { id: 's2', at: 60, for: 60, media: 'img-q' },
  ], { styles: { red: RED, cap: CAP }, captions: captions({ kind: 'pill', colour: '#ff00ff', text: '#ffff00' }) });
}

/** 08 (1080 × 1920): the same words with the colour highlight (and its scale), across a cut. */
export function captionsFill(): Edit {
  const big: TextStyle = { ...CAP, size: 96 };
  return base(120, ['img-s', 'img-u'], [
    { id: 's1', at: 0, for: 60, media: 'img-s' },
    { id: 's2', at: 60, for: 60, media: 'img-u' },
  ], { styles: { red: RED, cap: big }, captions: captions({ kind: 'colour', colour: '#00ff00', scale: 1.06 }) }, { width: 1080, height: 1920, fps: 30 });
}

/** 09: cards on word ranges (contain, cover, with and without motion) over captions. */
export function cardsOnWords(): Edit {
  return base(120, ['img-s', 'img-u', 'card-wide', 'card-tall'], [
    { id: 's1', at: 0, for: 60, media: 'img-s' },
    { id: 's2', at: 60, for: 60, media: 'img-u' },
  ], {
    styles: { red: RED, cap: CAP },
    captions: captions({ kind: 'colour', colour: '#00ff00' }, 52, 64),
    cards: [
      { id: 'ca', at: 16, for: 12, media: 'card-wide', box: box(14, 36), fit: 'contain', enter: { kind: 'fade', frames: 3 }, exit: { kind: 'fade', frames: 3 } },
      { id: 'cb', at: 52, for: 8, media: 'card-tall', box: box(14, 40, 8, 40), fit: 'cover', enter: { kind: 'none' }, exit: { kind: 'none' } },
      { id: 'cc', at: 60, for: 36, media: 'card-wide', box: box(14, 40, 50, 86), fit: 'cover', motion: { kind: 'push-in', to: 1.2 } },
    ],
  });
}

/** 10: windows over a picture: one, two in order, with swaps, and a window of another corner on the next shot. */
export function windowsImage(): Edit {
  return base(150, ['img-p', 'img-q', 'img-r', 'img-s', 'img-t'], [
    { id: 's1', at: 0, for: 90, media: 'img-p', windows: [
      { at: 6, for: 30, corner: 'bottom-right', behind: 'img-q' },
      { at: 44, for: 44, corner: 'bottom-right', behind: 'img-r', swaps: [{ at: 66, behind: 'img-s' }] },
    ] },
    { id: 's2', at: 90, for: 60, media: 'img-t', windows: [{ at: 100, for: 40, corner: 'top-left', width: 45, radius: 4, behind: 'img-q', frames: 7 }] },
  ]);
}

/** 11: windows over footage, one that ends on the frame before a crossfade, one after a crossfade, one with a motion behind it, and a clip behind a window. */
export function windowsVideo(): Edit {
  return base(180, ['va', 'vb', 'vc', 'img-p', 'img-q', 'img-r'], [
    { id: 's1', at: 0, for: 60, media: 'va', windows: [{ at: 10, for: 50, corner: 'top-right', behind: 'img-q' }] },
    { id: 's2', at: 60, for: 60, media: 'img-p', in: { kind: 'crossfade', frames: 10 }, windows: [{ at: 75, for: 40, corner: 'bottom-left', behind: 'vb' }] },
    { id: 's3', at: 120, for: 60, media: 'vc', from: 20, in: { kind: 'dip', frames: 8 }, windows: [{ at: 140, for: 30, corner: 'bottom-right', behind: 'img-r', behindMotion: { kind: 'push-in', to: 1.1 } }] },
  ]);
}

/** 12: looped music (a file of 70 frames: no multiple of 3), sounds, ducking under the sound, fade out; master off so levels are as written. */
export function musicLoop(): Edit {
  return base(150, ['img-p', 'm-loop', 'fx-a'], [{ id: 's1', at: 0, for: 150, media: 'img-p' }], {
    audio: { music: { media: 'm-loop', gain: 1, loop: true, fadeOut: 12, duck: { to: 0.3, ramp: 6, under: 'sound' } }, sounds: [{ id: 'fa', media: 'fx-a', at: 40, gain: 1 }, { id: 'fb', media: 'fx-a', at: 100, for: 10, gain: 0.5 }], master: false },
  });
}

/** 13: music without loop, from an offset, fade in and out, ducking under captions, a sound from an offset, the default master pass. */
export function musicCaptions(): Edit {
  return base(100, ['img-s', 'm-b', 'fx-b'], [{ id: 's1', at: 0, for: 100, media: 'img-s' }], {
    styles: { red: RED, cap: CAP },
    captions: { box: box(34, 52), style: 'cap', words: [{ text: 'ONE', at: 30, for: 5 }, { text: 'TWO', at: 36, for: 5 }, { text: 'THREE', at: 42, for: 10 }], active: { kind: 'colour', colour: '#00ff00' } },
    audio: { music: { media: 'm-b', gain: 1, from: 10, fadeIn: 15, fadeOut: 20, duck: { to: 0.4, ramp: 6, under: 'captions' } }, sounds: [{ id: 'fb', media: 'fx-b', at: 70, for: 20, from: 5, gain: 0.8 }] },
  });
}

/** 14: thirty seconds: eighteen shots of 50 frames, clips and pictures in turn, every transition kind, texts and a card. */
export function longDocument(): Edit {
  const kinds: Transition[] = [{ kind: 'cut' }, { kind: 'crossfade', frames: 8 }, { kind: 'push', to: 'left', frames: 10 }, { kind: 'whip', to: 'right', frames: 8 }, { kind: 'zoom', frames: 8 }, { kind: 'flash', frames: 6 }, { kind: 'dip', frames: 12 }];
  const clips = ['va', 'vb', 'vc'];
  const images = ['img-p', 'img-q', 'img-r', 'img-s', 'img-t'];
  const shots: Shot[] = Array.from({ length: 18 }, (_, i) => ({
    id: `s${i + 1}`, at: i * 50, for: 50, media: i % 2 === 0 ? clips[(i / 2) % 3]! : images[Math.floor(i / 2) % 5]!, ...(i % 2 === 0 ? { from: (i * 7) % 60 } : {}),
    ...(i > 0 ? { in: kinds[i % kinds.length]! } : {}),
    ...(i % 4 === 1 ? { motion: { kind: 'push-in' as const, to: 1.1 } } : i % 4 === 3 ? { motion: { kind: 'pull-out' as const, from: 1.1 } } : {}),
  }));
  const texts = [1, 3, 5, 9, 11, 13].map((i) => ({ id: `t${i}`, at: i * 50 + 14, for: 30, box: box(20, 30), style: 'red', copy: `SHOT ${i + 1}`, enter: { kind: 'fade' as const, frames: 6 }, exit: { kind: 'fade' as const, frames: 6 } }));
  return base(900, ['va', 'vb', 'vc', ...images, 'card-wide'], shots, { texts, cards: [{ id: 'cd', at: 7 * 50 + 14, for: 30, media: 'card-wide', box: box(40, 60, 20, 70), enter: { kind: 'fade', frames: 4 }, exit: { kind: 'fade', frames: 4 } }] });
}
