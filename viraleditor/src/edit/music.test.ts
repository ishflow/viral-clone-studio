import { describe, expect, it } from 'vitest';
import type { Audio, Edit } from './types.ts';
import { shortEdit } from '../compose/fixture.ts';
import { duckRanges, musicGain, musicPasses } from './music.ts';

function withMusic(music: Partial<NonNullable<Audio['music']>>, change: (edit: Edit) => void = () => {}): Edit {
  const edit = shortEdit();
  edit.audio = { music: { media: 'beat', gain: 0.5, ...music } };
  change(edit);
  return edit;
}

describe('duckRanges', () => {
  it('under "captions": the words, two of them one range when the gap is shorter than 2 × ramp', () => {
    expect(duckRanges(withMusic({ duck: { to: 0.2, under: 'captions' } }))).toEqual([{ at: 62, end: 116 }]);
    const apart = withMusic({ duck: { to: 0.2, ramp: 3, under: 'captions' } }, (e) => { e.captions!.words[3] = { text: 'good', at: 102, for: 14 }; });
    expect(duckRanges(apart)).toEqual([{ at: 62, end: 96 }, { at: 102, end: 116 }]);            // a gap of 6 = 2 × 3: the ramps just fit
    const closer = withMusic({ duck: { to: 0.2, ramp: 3, under: 'captions' } }, (e) => { e.captions!.words[3] = { text: 'good', at: 101, for: 14 }; });
    expect(duckRanges(closer)).toEqual([{ at: 62, end: 115 }]);
  });

  it('under "sound": every shot with its own sound, for as long as it is on screen, tail included', () => {
    const edit = withMusic({ duck: { to: 0.2, under: 'sound' } }, (e) => { e.shots[0]!.sound = { gain: 1 }; e.shots[2]!.sound = { gain: 1 }; });
    expect(duckRanges(edit)).toEqual([{ at: 0, end: 68 }, { at: 120, end: 180 }]);
  });

  it('a list: sorted, and ranges that touch or overlap are one', () => {
    const edit = withMusic({ duck: { to: 0.2, ramp: 2, under: [{ at: 100, for: 10 }, { at: 20, for: 10 }, { at: 25, for: 20 }, { at: 49, for: 5 }] } });
    expect(duckRanges(edit)).toEqual([{ at: 20, end: 45 }, { at: 49, end: 54 }, { at: 100, end: 110 }]);
  });

  it('is empty without a duck', () => {
    expect(duckRanges(withMusic({}))).toEqual([]);
  });
});

describe('musicGain', () => {
  it('holds the gain and fades out over the last 12 frames by default', () => {
    expect(musicGain(withMusic({}))).toEqual([[0, 0.5], [168, 0.5], [180, 0]]);
    expect(musicGain(withMusic({ fadeOut: 0 }))).toEqual([[0, 0.5], [180, 0.5]]);
    expect(musicGain(withMusic({ fadeIn: 10, fadeOut: 0 }))).toEqual([[0, 0], [10, 0.5], [180, 0.5]]);
  });

  it('ramps down before a range and up after it', () => {
    expect(musicGain(withMusic({ fadeOut: 0, duck: { to: 0.1, ramp: 4, under: [{ at: 50, for: 30 }] } }))).toEqual([[0, 0.5], [46, 0.5], [50, 0.1], [80, 0.1], [84, 0.5], [180, 0.5]]);
  });

  it('cuts a ramp that would start before the video or end after it', () => {
    const gain = musicGain(withMusic({ fadeOut: 0, duck: { to: 0.1, ramp: 4, under: [{ at: 2, for: 10 }, { at: 170, for: 8 }] } }));
    expect(gain).toEqual([[0, 0.3], [2, 0.1], [12, 0.1], [16, 0.5], [166, 0.5], [170, 0.1], [178, 0.1], [180, 0.3]]);
  });

  it('multiplies the ducked level by the fade where both apply', () => {
    const gain = musicGain(withMusic({ fadeOut: 12, duck: { to: 0.2, under: [{ at: 100, for: 80 }] } }));
    expect(gain).toEqual([[0, 0.5], [94, 0.5], [100, 0.2], [168, 0.2], [180, 0]]);
  });
});

describe('musicPasses', () => {
  it('is one pass over the whole video without loop, from the offset given', () => {
    expect(musicPasses(withMusic({ from: 30, fadeOut: 0 }), 900)).toEqual([{ at: 0, for: 180, from: 30, points: [[0, 0.5], [180, 0.5]] }]);
  });

  it('loops in passes cut to a multiple of 3 frames; the offset is for the first pass only', () => {
    const passes = musicPasses(withMusic({ loop: true, from: 10, fadeOut: 0 }), 80);
    expect(passes.map((p) => [p.at, p.for, p.from])).toEqual([[0, 69, 10], [69, 78, 0], [147, 33, 0]]);
    expect(passes.every((p) => p.at % 3 === 0)).toBe(true);
  });

  it('does not cut a file that covers the video, loop or not', () => {
    expect(musicPasses(withMusic({ loop: true }), 181).map((p) => [p.at, p.for])).toEqual([[0, 180]]);
  });

  it('gives every pass a first point on its first frame and a last one on its end, with the gain of that frame', () => {
    const passes = musicPasses(withMusic({ loop: true, fadeOut: 0, duck: { to: 0.1, ramp: 6, under: [{ at: 50, for: 60 }] } }), 60);
    expect(passes.map((p) => p.points)).toEqual([
      [[0, 0.5], [44, 0.5], [50, 0.1], [60, 0.1]],
      [[60, 0.1], [110, 0.1], [116, 0.5], [120, 0.5]],
      [[120, 0.5], [180, 0.5]],
    ]);
    const split = musicPasses(withMusic({ loop: true, fadeOut: 0, duck: { to: 0.1, ramp: 6, under: [{ at: 63, for: 60 }] } }), 60);
    expect(split[0]!.points.at(-1)).toEqual([60, 0.3]);                                    // half way down the ramp 57 … 63
    expect(split[1]!.points.slice(0, 2)).toEqual([[60, 0.3], [63, 0.1]]);
  });

  it('is empty when a pass would have no frame, and without music', () => {
    expect(musicPasses(withMusic({ loop: true }), 2)).toEqual([]);
    expect(musicPasses(withMusic({ loop: true, from: 59 }), 60)).toEqual([]);
    expect(musicPasses(shortEdit(), 0).length).toBe(1);
    expect(musicPasses({ ...shortEdit(), audio: undefined }, 900)).toEqual([]);
  });
});
