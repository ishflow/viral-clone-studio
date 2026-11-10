// Documents for the tests: the short one of the design (§3) and the facts of its media.
import type { ComposeFacts, Edit } from '../edit/types.ts';

/** The short document of design §3, as printed there. `width` 720 gives the same montage on the small canvas. */
export function shortEdit(width: 720 | 1080 = 1080): Edit {
  return {
    version: 1, language: 'en',
    canvas: { width, height: width === 720 ? 1280 : 1920, fps: 30 }, frames: 180,
    media: {
      a: { file: 'assets/a.mp4', kind: 'video' }, b: { file: 'assets/b.mp4', kind: 'video' },
      c: { file: 'assets/c.mp4', kind: 'video' }, serum: { file: 'assets/serum.png', kind: 'image' },
      beat: { file: 'assets/beat.mp3', kind: 'audio' },
    },
    shots: [
      { id: 's1', at: 0, for: 60, media: 'a', motion: { kind: 'push-in' } },
      { id: 's2', at: 60, for: 60, media: 'b', from: 20, in: { kind: 'crossfade' }, motion: { kind: 'punch-in', at: 90 } },
      { id: 's3', at: 120, for: 60, media: 'c', from: 40, in: { kind: 'whip', to: 'left' }, motion: { kind: 'pull-out' } },
    ],
    texts: [{ id: 'hook', at: 0, for: 54, box: { left: 9, top: 15, right: 91, bottom: 27 }, style: 'hook', copy: 'My lashes grew visibly in three weeks' }],
    cards: [{ id: 'product', at: 70, for: 40, media: 'serum', box: { left: 31, top: 36, right: 69, bottom: 58 } }],
    captions: {
      box: { left: 9, top: 52, right: 86, bottom: 64 },
      words: [{ text: 'never', at: 62, for: 12 }, { text: 'looked', at: 74, for: 14 }, { text: 'so', at: 88, for: 8 }, { text: 'good', at: 96, for: 20 }],
    },
    audio: { music: { media: 'beat', gain: 0.5, duck: { to: 0.2, under: 'captions' } } },
  };
}

/** Facts that fit the short document: three clips of 5 s, a picture, 30 s of music. */
export function shortFacts(): Record<string, ComposeFacts> {
  return {
    a: { frames: 150, audio: false }, b: { frames: 150, audio: false }, c: { frames: 150, audio: false },
    serum: { frames: 0, audio: false, width: 720, height: 1280 }, beat: { frames: 900, audio: true },
  };
}

const RICH_WORDS: [string, number, number][] = [
  ['this', 62, 8], ['is', 70, 6], ['what', 76, 8], ['nobody', 84, 10], ['tells', 94, 8], ['you.', 102, 10], ['Use', 125, 8], ['it', 133, 5],
  ['every', 138, 9], ['night', 147, 10], ['and', 170, 6], ['wait', 176, 8], ['a', 184, 3], ['full', 187, 8], ['minute', 195, 12], ['okay', 215, 10],
];

/** A document that uses every kind of everything once: all transitions and motions, a window with a swap, a plate, looped music. */
export function richEdit(): Edit {
  return {
    version: 1, language: 'tr',
    canvas: { width: 1080, height: 1920, fps: 30 }, frames: 360,
    background: '#101418',
    media: {
      a: { file: 'assets/a.mp4', kind: 'video' }, b: { file: 'assets/b.mp4', kind: 'video' }, c: { file: 'assets/c.mp4', kind: 'video' },
      proof: { file: 'assets/proof.png', kind: 'image' }, serum: { file: 'assets/serum.png', kind: 'image' },
      beat: { file: 'assets/beat.mp3', kind: 'audio' }, ping: { file: 'assets/ping.mp3', kind: 'audio' },
    },
    styles: {
      mine: { font: 'Montserrat', weight: 700, size: 52, align: 'left', fill: '#ffe000', shadows: ['0px 2px 6px #000000'], upper: true, tracking: 0.05, leading: 1.2 },
    },
    shots: [
      { id: 's1', at: 0, for: 60, media: 'a', motion: { kind: 'push-in' }, sound: { gain: 1 },
        windows: [{ at: 10, for: 40, corner: 'bottom-right', behind: 'proof', swaps: [{ at: 30, behind: 'serum' }], behindMotion: { kind: 'push-in', to: 1.1 } }] },
      { id: 's2', at: 60, for: 40, media: 'b', in: { kind: 'push', to: 'left' } },
      { id: 's3', at: 100, for: 40, media: 'c', from: 10, in: { kind: 'zoom' } },
      { id: 's4', at: 140, for: 40, media: 'a', from: 70, in: { kind: 'flash' } },
      { id: 's5', at: 180, for: 40, media: 'proof', in: { kind: 'dip', frames: 11 }, motion: { kind: 'pull-out' } },
      { id: 's6', at: 220, for: 40, media: 'b', from: 50, in: { kind: 'whip', to: 'top' }, focus: [30, 40], motion: { kind: 'punch-in', at: 240 } },
      { id: 's7', at: 260, for: 40, media: 'c', from: 60, in: { kind: 'crossfade' } },
      { id: 's8', at: 300, for: 60, media: 'a', from: 120 },
    ],
    texts: [
      { id: 'title', at: 5, for: 60, box: { left: 8, top: 16, right: 84, bottom: 30 }, style: 'hook', copy: 'Three weeks\nvisible results', enter: { kind: 'slide', from: 'left' }, exit: { kind: 'blur' } },
      { id: 'badge', at: 70, for: 50, box: { left: 20, top: 34, right: 70, bottom: 40 }, style: 'tag', copy: 'New formula' },
      { id: 'note', at: 130, for: 60, box: { left: 8, top: 20, right: 84, bottom: 30 }, style: 'label', copy: 'İşte ğüşöç bakımı ✨ şimdi', lines: 2 },
      { id: 'claim', at: 200, for: 80, box: { left: 8, top: 40, right: 84, bottom: 50 }, style: 'mine', copy: 'clinically tested', valign: 'top', enter: { kind: 'none' }, exit: { kind: 'pop' } },
    ],
    cards: [
      { id: 'zoom-card', at: 150, for: 60, media: 'serum', box: { left: 20, top: 42, right: 60, bottom: 62 }, fit: 'cover', motion: { kind: 'push-in', to: 1.1 }, enter: { kind: 'fade' }, exit: { kind: 'fade' } },
      { id: 'product', at: 310, for: 40, media: 'serum', box: { left: 31, top: 36, right: 69, bottom: 58 } },
    ],
    captions: {
      box: { left: 9, top: 52, right: 86, bottom: 64 },
      words: RICH_WORDS.map(([text, at, length]) => ({ text, at, for: length })),
      group: { words: 4, lines: 2, hold: 8, pause: 10 },
      active: { kind: 'pill', colour: '#7c3aed', text: '#ffffff' },
    },
    audio: {
      music: { media: 'beat', gain: 0.6, loop: true, fadeIn: 6, duck: { to: 0.2, under: 'sound' } },
      sounds: [{ id: 'ping', media: 'ping', at: 150, for: 20, gain: 0.8 }],
      master: { lufs: -16 },
    },
  };
}

export function richFacts(): Record<string, ComposeFacts> {
  return {
    a: { frames: 300, audio: true }, b: { frames: 300, audio: false }, c: { frames: 300, audio: false },
    proof: { frames: 0, audio: false, width: 720, height: 1280 }, serum: { frames: 0, audio: false, width: 720, height: 1280 },
    beat: { frames: 100, audio: true }, ping: { frames: 40, audio: true },
  };
}

/**
 * A document that has exactly as many entries as the limits allow, everywhere at once (`COUNTS` of edit/presets.ts):
 * 120 shots, 8 windows on one of them with 8 swaps each, 200 texts, 50 styles with 8 shadows each, 100 cards,
 * 600 caption words, 600 ducking ranges, 100 sounds, 300 media keys. It is valid and composes.
 */
export function limitEdit(): Edit {
  const media: Edit['media'] = { a: { file: 'assets/a.mp4', kind: 'video' }, beat: { file: 'assets/beat.mp3', kind: 'audio' }, ping: { file: 'assets/ping.mp3', kind: 'audio' } };
  for (let i = 0; i < 297; i++) media[`p${i}`] = { file: `assets/p${i}.png`, kind: 'image' };
  const styles: NonNullable<Edit['styles']> = {};
  for (let i = 0; i < 50; i++) styles[`k${i}`] = { font: 'Inter', weight: 700, size: 40, align: 'center', fill: '#ffffff', shadows: Array.from({ length: 8 }, (_, j) => `0px ${j}px 2px #000000`) };
  // the first shot is long enough for 8 windows of 10 frames: 1 to shrink, 8 at rest with a swap on each, 1 to return
  const windows = Array.from({ length: 8 }, (_, k) => ({
    at: 2 + 13 * k, for: 10, frames: 1, corner: 'top-left' as const, behind: 'p0',
    swaps: Array.from({ length: 8 }, (_, j) => ({ at: 2 + 13 * k + 1 + j, behind: `p${j + 1}` })),
  }));
  return {
    version: 1, language: 'en', canvas: { width: 1080, height: 1920, fps: 30 }, frames: 110 + 119 * 14,
    media, styles,
    shots: Array.from({ length: 120 }, (_, i) => (i === 0 ? { id: 's0', at: 0, for: 110, media: 'a', windows } : { id: `s${i}`, at: 110 + (i - 1) * 14, for: 14, media: 'a' })),
    texts: Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, at: (i * 8) % 1700, for: 20, box: { left: 10, top: 20, right: 80, bottom: 26 }, style: `k${i % 50}`, copy: 'ok', enter: { kind: 'none' as const }, exit: { kind: 'none' as const } })),
    cards: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, at: i * 15, for: 20, media: `p${i}`, box: { left: 20, top: 30, right: 60, bottom: 44 }, fit: 'cover' as const, enter: { kind: 'none' as const }, exit: { kind: 'none' as const } })),
    captions: { box: { left: 9, top: 52, right: 86, bottom: 64 }, words: Array.from({ length: 600 }, (_, i) => ({ text: 'go', at: 2 * i, for: 2 })) },
    audio: {
      music: { media: 'beat', gain: 0.5, duck: { to: 0.2, under: Array.from({ length: 600 }, (_, i) => ({ at: 2 * i, for: 1 })) } },
      sounds: Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, media: 'ping', at: i * 10, for: 5, gain: 1 })),
    },
  };
}

export function limitFacts(): Record<string, ComposeFacts> {
  return { a: { frames: 400, audio: false }, beat: { frames: 2000, audio: true }, ping: { frames: 40, audio: true } };
}
