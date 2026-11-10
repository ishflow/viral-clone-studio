import { describe, expect, it } from 'vitest';
import { FakeClock } from '../adapters/fakes.ts';
import type { Paid } from '../contracts.ts';
import { beginOperation, endOperation } from '../db/runs.ts';
import { missingOf, unsentOf } from './missing.ts';
import { needsOf } from './plan.ts';
import { golden, inputOf, put, startRun, workspace } from './testing.ts';

const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };

describe('missingOf: what a resume has to approve on top of what is approved and not yet used', () => {
  const scene = () => {
    const { db } = workspace();
    const clock = new FakeClock();
    const { template, fill } = golden('layering-01');
    const runId = startRun(db, clock, template, inputOf(template, fill, 3)).id;
    const needs = needsOf(template, runId, 2);
    const row = (key: string, patch: Parameters<typeof endOperation>[3]) => {
      beginOperation(db, runId, key, key.includes(':clip:') ? 'clip' : key.includes(':image:') ? 'image' : 'music', clock.now());
      endOperation(db, runId, key, patch, clock.now());
    };
    const done = (key: string, as = key) => {
      const file = needs.find((need) => need.key === key)!.file;
      row(as, { state: 'done', externalId: 't', output: file });
      put(file, 'a file');
    };
    return { db, runId, needs, row, done };
  };
  const one: Paid = { images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 };            // what one variant needs

  it('nothing sent yet: only what the approval does not cover', () => {
    const { db, runId, needs } = scene();
    expect(unsentOf(db, runId, needs)).toHaveLength(11);
    expect(missingOf(db, runId, needs, one, ZERO)).toEqual(ZERO);                              // approved and never sent is not asked for again
    expect(missingOf(db, runId, needs, { ...one, clips: 3, clipSeconds: 19 }, ZERO)).toEqual({ ...ZERO, clips: 2, clipSeconds: 1 });
    expect(missingOf(db, runId, needs, null, ZERO)).toEqual(one);
  });

  it('a retry of a failed request counts (the failed one is in sent); done and pending with a ticket are not sent again', () => {
    const { db, runId, needs, row, done } = scene();
    for (const id of ['s1', 's2', 's3', 's4']) done(`v2:image:${id}`);
    row('v2:image:s5', { state: 'failed', externalId: 't' }); done('v2:image:s5', 'v2:image:s5#2');   // failed, sent again, done
    done('v2:clip:s1');
    row('v2:clip:s2', { externalId: 'ticket' });                                             // still at the provider: a resume asks for it, free
    row('v2:clip:s3', { state: 'failed', externalId: 't' });                                 // accepted, then the task failed
    expect(unsentOf(db, runId, needs).map((need) => need.key)).toEqual(['v2:clip:s3', 'v2:clip:s4', 'v2:clip:s5', 'v2:music']);
    // accepted so far: 6 images, 3 clips. Approved: one variant and the retried image.
    const sent: Paid = { images: 6, clips: 3, clipSeconds: 12, music: 0, voice: 0 };
    const approved: Paid = { ...one, images: 6 };
    expect(missingOf(db, runId, needs, approved, sent)).toEqual({ ...ZERO, clips: 1, clipSeconds: 4 });   // 3 to send, room for 2; the music was approved and never sent
    expect(missingOf(db, runId, needs, { ...approved, clips: 6, clipSeconds: 24 }, sent)).toEqual(ZERO);  // after the resume approved it
  });

  it('a done row is not sent again, also when its file is gone', () => {
    const { db, runId, needs, row } = scene();
    row('v2:clip:s5', { state: 'done', externalId: 't', output: 'jobs/gone.mp4' });
    expect(unsentOf(db, runId, needs).map((need) => need.key)).not.toContain('v2:clip:s5');
  });

  it('a run with an unknown row cannot be continued by approving anything: all zero', () => {
    const { db, runId, needs, row } = scene();
    row('v2:image:s1', { state: 'unknown' });
    expect(missingOf(db, runId, needs, null, ZERO)).toEqual(ZERO);
    expect(missingOf(db, runId, needs, { ...one, clips: 1 }, ZERO)).toEqual(ZERO);
  });
});
