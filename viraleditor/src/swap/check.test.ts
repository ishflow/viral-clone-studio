import { describe, expect, it } from 'vitest';
import { labelBox } from '../adapters/splice.ts';
import type { Measure, MediaFacts, Picture } from '../ports.ts';
import { finishedFault, labelShown } from './check.ts';

/** A label: dark, with a light bar across its middle. A frame: one grey all over, with `draw` painted into the place of the label. */
const LABEL: Picture = { width: 90, height: 20, rgb: Uint8Array.from({ length: 90 * 20 * 3 }, (_, at) => (Math.floor(at / 3 / 90) >= 8 && Math.floor(at / 3 / 90) < 12 ? 255 : 17)) };
function frame(draw: 'label' | 'nothing' | 'elsewhere'): Picture {
  const width = 180, height = 320, rgb = new Uint8Array(width * height * 3).fill(200);
  const box = labelBox({ width, height }, LABEL), shift = draw === 'elsewhere' ? 100 : 0;
  if (draw !== 'nothing') {
    for (let y = 0; y < box.height; y += 1) for (let x = 0; x < box.width; x += 1) {
      const value = LABEL.rgb[(Math.floor(y * LABEL.height / box.height) * LABEL.width + Math.floor(x * LABEL.width / box.width)) * 3]!;
      rgb.fill(value, ((box.top + y + shift) * width + box.left + x) * 3, ((box.top + y + shift) * width + box.left + x) * 3 + 3);
    }
  }
  return { width, height, rgb };
}

describe('labelShown', () => {
  it('finds the label where the splicer draws it', () => { expect(labelShown(frame('label'), LABEL)).toBe(true); });
  it('misses it on a frame without one, and when it is drawn somewhere else', () => {
    expect(labelShown(frame('nothing'), LABEL)).toBe(false);
    expect(labelShown(frame('elsewhere'), LABEL)).toBe(false);
  });
});

describe('finishedFault', () => {
  const FACTS: MediaFacts = { width: 180, height: 320, fps: 30, frames: 90, seconds: 3, audio: true };
  const SOURCE = { frames: 90, sound: true, label: 'label.png' };
  /** A measure that knows one video: the label is on every frame of it but those of `bare`. */
  const measure = (bare: number[] = []) => ({ picture: async (file: string, n: number) => (file === 'label.png' ? LABEL : frame(bare.includes(n) ? 'nothing' : 'label')) }) as unknown as Measure;

  it('lets through a video with every frame of its source, its sound and the label', async () => {
    expect(await finishedFault(measure(), 'joined.mp4', FACTS, SOURCE)).toBeNull();
    expect(await finishedFault(measure(), 'joined.mp4', { ...FACTS, audio: false }, { ...SOURCE, sound: false })).toBeNull();
  });
  it('names a video with one frame less or more than its source', async () => {
    expect(await finishedFault(measure(), 'joined.mp4', { ...FACTS, frames: 89 }, SOURCE)).toBe('it has 89 frames, its source 90');
    expect(await finishedFault(measure(), 'joined.mp4', { ...FACTS, frames: 91 }, SOURCE)).toBe('it has 91 frames, its source 90');
  });
  it('names a video without the sound of its source, and one with a sound its source does not have', async () => {
    expect(await finishedFault(measure(), 'joined.mp4', { ...FACTS, audio: false }, SOURCE)).toBe('it has no sound, its source has');
    expect(await finishedFault(measure(), 'joined.mp4', FACTS, { ...SOURCE, sound: false })).toBe('it has sound, its source has none');
  });
  it.each([0, 45, 89])('names a video whose frame %i (first, middle, last) does not show the label', async (bare) => {
    expect(await finishedFault(measure([bare]), 'joined.mp4', FACTS, SOURCE)).toBe(`frame ${bare} does not show the AI label`);
  });
});
