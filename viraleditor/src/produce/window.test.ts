import { describe, expect, it } from 'vitest';
import { WINDOW_GAIN, musicStart } from './window.ts';

const FPS = 30;
const flat = (n: number, lufs: number): number[] => Array.from({ length: n }, () => lufs);
// a 3 s video is 90 frames and 30 values; the music is 12 s = 360 frames
const VIDEO = 90, MUSIC = 360;

describe('musicStart', () => {
  it('a quiet intro and a louder middle: the music starts where the loud part begins, in frames (3 per value)', () => {
    const values = [...flat(50, -21), ...flat(70, -12)];
    expect(musicStart(values, MUSIC, VIDEO, FPS)).toBe(150);          // value 50 = 5 s = frame 150
  });

  it('the earliest of equal windows wins', () => {
    const values = [...flat(30, -20), ...flat(40, -12), ...flat(50, -12)];
    expect(musicStart(values, MUSIC, VIDEO, FPS)).toBe(90);
  });

  it('stays at 0 unless the best window is WINDOW_GAIN LU louder than the opening', () => {
    const under = [...flat(30, -13), ...flat(90, -13 + WINDOW_GAIN - 0.01)];
    const over = [...flat(30, -13), ...flat(90, -13 + WINDOW_GAIN + 0.01)];
    expect(musicStart(under, MUSIC, VIDEO, FPS)).toBe(0);
    expect(musicStart(over, MUSIC, VIDEO, FPS)).toBe(90);
  });

  it('a silent opening loses to any sound; an all-silent file stays at 0', () => {
    expect(musicStart([...flat(30, -Infinity), ...flat(90, -30)], MUSIC, VIDEO, FPS)).toBe(90);
    expect(musicStart(flat(120, -Infinity), MUSIC, VIDEO, FPS)).toBe(0);
  });

  it('music exactly as long as the video, or shorter: 0', () => {
    expect(musicStart([...flat(10, -30), ...flat(20, -10)], VIDEO, VIDEO, FPS)).toBe(0);
    expect(musicStart(flat(120, -10), 60, VIDEO, FPS)).toBe(0);
  });

  it('never starts a window that runs past the end of the file or of the measurements', () => {
    const values = [...flat(20, -30), ...flat(30, -10)];              // 5 s of music, 3 s video
    expect(musicStart(values, 150, VIDEO, FPS)).toBe(60);            // value 20 = 2 s: the last whole window
    expect(musicStart(flat(10, -10), MUSIC, VIDEO, FPS)).toBe(0);    // fewer values than one window
    expect(musicStart([], MUSIC, VIDEO, FPS)).toBe(0);
  });

  it('the file\'s length bounds the start on its own: more values than the music holds, the loudest window that still fits wins', () => {
    const values = [...flat(30, -30), ...flat(30, -5)];               // 6 s of values, but the music is 5 s = 150 frames, the video 3 s
    expect(musicStart(values, 150, VIDEO, FPS)).toBe(60);             // the all-loud window at value 30 (frame 90) would end at 180 > 150: value 20 is the last that fits
  });

  it('the first three values of a measured file are -Infinity (nothing to measure yet): they do not make the opening look quiet', () => {
    const flatMusic = [-Infinity, -Infinity, -Infinity, ...flat(17, -10)];   // a 1 s video is 10 values; the music is level
    expect(musicStart(flatMusic, 150, 30, FPS)).toBe(0);
    // a real quiet start still loses to a louder part
    expect(musicStart([-Infinity, -Infinity, -Infinity, ...flat(10, -30), ...flat(20, -10)], 300, 30, FPS)).toBe(39);   // value 13 = frame 39
  });
});
