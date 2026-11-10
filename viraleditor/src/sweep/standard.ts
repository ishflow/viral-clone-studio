// The one set of assertions every sweep document gets; a wrong frame that was confirmed by hand is moved to an `it.fails`
// named FINDING <n> by the test file (see findings below each file's call).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Timeline } from '../edit/timeline.ts';
import type { Edit } from '../edit/types.ts';
import { promiseErrors } from './promise.ts';
import type { SweepMedia } from './media.ts';
import { SLOW, available } from './run.ts';
import { describeWrong, runCase, wrongOf } from './suite.ts';
import type { Case } from './suite.ts';

export interface Options {
  windows?: boolean;                                 // compared by decoded positions, not checksums (design §12.9)
  /** wrong-frame kinds that are known findings: name of the finding → the kinds it is about; those assertions run as it.fails */
  findings?: Record<string, string[]>;
  /** assertion groups (by wrong-frame kind) not judged: the harness could not read them yet; the reason is the value */
  skip?: Record<string, string>;
}

const GROUPS: Record<string, string[]> = {
  'shows on every frame what the frame table says (colour samples)': ['shot'],
  'shows the source frame of the frame bar on every frame it can be read': ['shot-bar'],
  'shows every text on its frames, at its place, with its edge, unchanged at rest': ['text', 'text-move', 'text-blur', 'text-rest'],
  'times every faded text edge to half a frame of the promise': ['text-edge'],
  'shows every caption group and active word on its frames': ['caption', 'caption-word'],
  'lights the active word and only it, with the letters of the group': ['caption-lit', 'caption-letters'],
  'shows every card on its frames and in its box': ['card', 'card-box'],
  'times every faded card edge to half a frame of the promise': ['card-edge'],
  'shows every window at its edges on every frame': ['window'],
};

export function standard(name: string, build: () => Edit, media: () => SweepMedia, options: Options = {}): void {
  describe.skipIf(!available)(`sweep ${name}`, () => {
    let c: Case;
    beforeAll(async () => { c = await runCase(name, build(), media(), { windows: options.windows }); }, SLOW);
    it('timeline.json says in frames what edit.json says (worked out from the edit alone)', () => {
      const written = JSON.parse(readFileSync(join(c.rendered.dir, 'timeline.json'), 'utf8')) as Timeline;
      expect(written, 'the timeline the judges used is the one written').toEqual(c.rendered.timeline);
      expect(promiseErrors(c.rendered.edit, written)).toEqual([]);
    });
    it('passes check and has every frame', () => {
      expect(c.rendered.checkIssues).toEqual([]);
      expect(c.analysis.frames).toBe(c.rendered.timeline.frames);
      expect(c.analysis.unreadable, 'frames that could not be judged at all').toBe(0);
    });
    for (const [title, kinds] of Object.entries(GROUPS)) {
      const finding = Object.entries(options.findings ?? {}).find(([, k]) => k.some((x) => kinds.includes(x)));
      const body = () => { const w = wrongOf(c, ...kinds); expect(w.length, describeWrong(w)).toBe(0); };
      const skipped = Object.entries(options.skip ?? {}).find(([k]) => kinds.includes(k));
      if (skipped) it.skip(`NOT JUDGED (${skipped[1]}): ${title}`, body); else if (finding) it.fails(`FINDING ${finding[0]}: ${title}`, body); else it(title, body);
    }
    it(options.windows ? 'two renders show the same decoded positions' : 'is identical when rendered twice (framemd5)', () => {
      if (options.windows) { expect(c.positionsDiffering).toBe(0); return; }
      expect(c.framesDiffering, 'render differences are failures, never runtime skips').toBe(0);
    });
  });
}
