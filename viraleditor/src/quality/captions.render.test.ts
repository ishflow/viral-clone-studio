// Real HyperFrames (`VE_RENDER=1 pnpm vitest run src/quality/captions.render.test.ts`): caption groups that hardly show their fill colour, because
// the active word is the only word of the group or the only long one. The rows `lit` and `pill` of the labelled set, judged group by group, with the
// sources and without them. VE_QUALITY_SET and VE_QUALITY_JOBS as in labelled.render.test.ts.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { available } from '../compose/golden-helpers.ts';
import { CANVASES, CASES, buildSet, judge } from './labelled.ts';
import type { Built, Row } from './labelled.ts';

const SET_TIMEOUT = 20 * 60_000;
const GROUPS = ['cap-1', 'cap-2', 'cap-3', 'cap-4'];
const RENDERS = ['lit', 'pill'].flatMap((doc) => CANVASES.map((canvas) => [doc, canvas.width] as const));

describe.skipIf(!available)('caption groups of one and two words', () => {
  const kept = process.env.VE_QUALITY_SET;
  const root = kept ?? mkdtempSync(join(tmpdir(), 've-captions-'));
  const built: Built[] = [];
  const rows = new Map<string, Row>();                 // by `${name}-${size}`; the same name with ' alone': judged without the sources
  beforeAll(async () => {
    built.push(...await buildSet(root, Number(process.env.VE_QUALITY_JOBS ?? 2), CASES.filter((c) => c.doc === 'lit' || c.doc === 'pill')));
    for (const render of built) {
      rows.set(`${render.name}-${render.size}`, await judge(render));
      rows.set(`${render.name}-${render.size} alone`, await judge(render, false));
    }
  }, SET_TIMEOUT);
  afterAll(() => { if (!kept) rmSync(root, { recursive: true, force: true }); });
  /** What is said about the captions of one render, in order. */
  const said = (key: string) => rows.get(key)!.issues.filter((i) => i.target?.startsWith('cap-')).map((i) => `${i.code} ${i.target}`);

  it('the documents are what the cases mean: groups of one, two, two and one word, and the frame that is judged has the last word of its group active', () => {
    expect(built).toHaveLength(4 * CANVASES.length);
    for (const render of built) {
      expect(render.timeline.captions.map((c) => c.lines)).toEqual([['Wait.'], ['I understand'], ['a difference.'], ['Yes.']]);
      for (const c of render.timeline.captions) {
        const middle = c.rest.at + Math.floor(c.rest.for / 2);
        expect(c.words.find((w) => w.at <= middle && middle < w.at + w.for)).toBe(c.words.at(-1));
      }
    }
  });
  it.each(RENDERS)('%s at %d: every group is on screen, and nothing is said about one', (doc, size) => {
    expect(said(`good-${doc}-${size}`)).toEqual([]);
  });
  it.each(RENDERS)('%s at %d with the captions removed: every group is text-missing', (doc, size) => {
    expect(said(`removed-${doc}-${size}`)).toEqual(GROUPS.map((group) => `text-missing ${group}`));
  });
  it.each(RENDERS)('%s at %d without the sources: the mark\'s colour is not in the timeline, so every group is a warning that it could not be verified, rendered or not (never an error, never silence)', (doc, size) => {
    const unverified = GROUPS.map((group) => `text-unverified ${group}`);
    expect(said(`good-${doc}-${size} alone`)).toEqual(unverified);
    expect(said(`removed-${doc}-${size} alone`)).toEqual(unverified);
  });
});
