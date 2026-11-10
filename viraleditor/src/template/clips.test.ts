import { describe, expect, it } from 'vitest';
import { clipShots, partsOf, partStarts } from './clips.ts';
import { beatsTemplate, continuingTemplate } from './fixture.ts';
import { Template } from './schema.ts';
import type { TemplateJson } from './schema.ts';

const parsed = (t: unknown): TemplateJson => Template.parse(t);

describe('partStarts: where each part of a clip starts', () => {
  it('one part starts on frame 0, whatever the clip', () => {
    expect(partStarts(120, [90])).toEqual([0]);
    expect(partStarts(120, [120])).toEqual([0]);
    expect(partStarts(90, [120])).toEqual([0]);
  });
  it('two parts: the first from frame 0, the second ends on the clip\'s last frame', () => {
    expect(partStarts(120, [30, 40])).toEqual([0, 80]);           // 80 + 40 = 120
  });
  it('three parts: the unused frames are split evenly into the two gaps', () => {
    expect(partStarts(120, [30, 30, 30])).toEqual([0, 45, 90]);   // gaps of 15 and 15; the last ends on 120
  });
  it('an odd remainder: the earlier gap takes the frame left over', () => {
    expect(partStarts(125, [30, 30, 30])).toEqual([0, 48, 95]);   // 35 unused: gaps of 18 and 17
    expect(partStarts(150, [39, 48, 38])).toEqual([0, 52, 112]);  // 25 unused: 13 and 12; 112 + 38 = 150
    expect(partStarts(122, [30, 30, 30, 30])).toEqual([0, 31, 62, 92]);   // 2 unused, 3 gaps: 1, 1, 0
  });
  it('no gap: parts that fill the clip follow each other', () => {
    expect(partStarts(90, [30, 30, 30])).toEqual([0, 30, 60]);
  });
  it('parts longer than the clip get no gaps (the edit\'s check says the clip is short)', () => {
    expect(partStarts(80, [30, 30, 30])).toEqual([0, 30, 60]);
  });
  it('every part fits, the first starts on 0 and the last ends on the clip\'s last frame, gaps differ by at most one frame', () => {
    for (let k = 2; k <= 6; k++) for (let clip = 10 * k; clip <= 10 * k + 40; clip++) {
      const lengths = Array.from({ length: k }, (_, i) => 5 + ((i * 7) % 6));
      if (lengths.reduce((a, b) => a + b, 0) > clip) continue;
      const starts = partStarts(clip, lengths);
      expect(starts[0]).toBe(0);
      expect(starts.at(-1)! + lengths.at(-1)!).toBe(clip);
      const gaps = starts.slice(1).map((start, i) => start - starts[i]! - lengths[i]!);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
      expect([...gaps].sort((a, b) => b - a)).toEqual(gaps);         // the larger gaps come first
    }
  });
});

describe('clipShots and partsOf', () => {
  it('the shots that own a clip are those without continues; a template without continues has all its shots', () => {
    expect(clipShots(parsed(continuingTemplate())).map((shot) => shot.id)).toEqual(['s1', 's4', 's5']);
    expect(clipShots(parsed(beatsTemplate())).map((shot) => shot.id)).toEqual(['s1']);
  });
  it('a shot that owns a clip without clip_seconds or motion_prompt is a fault of the pipeline', () => {
    const t = parsed(continuingTemplate());
    delete t.shots[3]!.clip_seconds;
    expect(() => clipShots(t)).toThrow(/"s4" owns a clip and has no clip_seconds/);
  });
  it('the parts of a clip: the owner, then the shots that continue it; the last counts the next shot\'s transition', () => {
    const t = continuingTemplate();
    (t.shots[3] as Record<string, unknown>).in = { kind: 'crossfade', frames: 8 };
    const template = parsed(t);
    expect(partsOf(template, 's1').map((part) => [part.shot.id, part.index, part.frames])).toEqual([['s1', 0, 30], ['s2', 1, 30], ['s3', 2, 38]]);
    expect(partsOf(template, 's4').map((part) => [part.shot.id, part.frames])).toEqual([['s4', 30]]);
    expect(partsOf(template, 's2')).toEqual([]);                   // a part owns no clip
  });
});
