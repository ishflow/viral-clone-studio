// A sample run's first variant becomes the template's own video and poster.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../adapters/fakes.ts';
import { enqueue, getRun } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { cardOf } from '../template/card.ts';
import { paidFor } from '../template/estimate.ts';
import { writeSample } from './sample.ts';
import { golden, inputOf, put, seed, startRun, workspace } from './testing.ts';

function world(row: Partial<templates.TemplateRow> | null = {}) {
  const { dir, db } = workspace();
  const { template, fill } = golden('layering-01');
  seed(template, fill);
  const clock = new FakeClock('2026-10-04T10:00:00.000Z');
  if (row !== null) {
    templates.upsert(db, {
      id: template.id, state: 'published', owner: 'user-1', sourceKind: 'link', sourceUrl: 'https://example.com/v', note: 'kept',
      card: cardOf(template, { image: null, video: null }), estimate: paidFor(template, 1), minutes: 4, timesGenerated: 7, ...row,
    }, clock.now());
  }
  const run = startRun(db, clock, template, inputOf(template, fill, 1, { sample: true }));
  const variant = { video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg` };
  put(variant.video, 'the video of variant 1');
  put(variant.image, 'the poster of variant 1');
  const folder = join(dir, 'templates', template.id);
  return { dir, db, clock, template, run, variant, folder };
}

describe('writeSample', () => {
  it('copies variant 1 to the template folder and leaves the variant as it is', () => {
    const w = world();
    writeSample(w, w.run, w.variant);
    expect(readFileSync(join(w.folder, 'sample.mp4'), 'utf8')).toBe('the video of variant 1');
    expect(readFileSync(join(w.folder, 'poster.jpg'), 'utf8')).toBe('the poster of variant 1');
    expect(readFileSync(join(w.dir, w.variant.video), 'utf8')).toBe('the video of variant 1');
    expect(readdirSync(w.folder).sort()).toEqual(['poster.jpg', 'sample.mp4', 'template.json']);   // no half file is left
  });

  it('updates the two media fields of the card and nothing else of the row', () => {
    const w = world();
    const before = templates.get(w.db, w.template.id)!;
    w.clock.advance(60_000);
    writeSample(w, w.run, w.variant);
    const after = templates.get(w.db, w.template.id)!;
    expect(after.card).toEqual({ ...before.card, video: `templates/${w.template.id}/sample.mp4`, image: `templates/${w.template.id}/poster.jpg` });
    expect(after).toMatchObject({ state: 'published', owner: 'user-1', note: 'kept', timesGenerated: 7, minutes: 4, sourceKind: 'link', estimate: before.estimate, createdAt: before.createdAt });
    expect(after.updatedAt).toBe('2026-10-04T10:01:00.000Z');
  });

  it('loses nothing another process changes between its read and its write: state, owner, note and counter survive', () => {
    const w = world({ state: 'ready', owner: null, note: null });
    // the site, as another connection: it publishes the template for another owner and counts a generation
    const site = new DatabaseSync(join(w.dir, 'db.sqlite'));
    site.exec('PRAGMA busy_timeout = 0');
    const publish = () => site.prepare(`UPDATE templates SET state = 'published', owner = 'user-2', note = 'reviewed', times_generated = times_generated + 1 WHERE id = ?`).run(w.template.id);
    // it tries at the worst moment: writeSample has read the row and is about to write it
    const original = w.db.prepare.bind(w.db);
    let tried = 0, refused = 0;
    w.db.prepare = ((sql: string) => {
      if (/^\s*INSERT INTO templates/.test(sql)) {
        tried++;
        try { publish(); } catch { refused++; }
      }
      return original(sql);
    }) as typeof w.db.prepare;
    writeSample(w, w.run, w.variant);
    w.db.prepare = original;
    expect(tried).toBe(1);
    if (refused > 0) publish();                                 // the database made it wait: it writes when writeSample is through
    site.close();
    const after = templates.get(w.db, w.template.id)!;
    expect(after).toMatchObject({ state: 'published', owner: 'user-2', note: 'reviewed', timesGenerated: 8 });
    expect(after.card).toMatchObject({ video: `templates/${w.template.id}/sample.mp4`, image: `templates/${w.template.id}/poster.jpg` });
  });

  it('a card that cannot be written leaves the database as it was, and no transaction open', () => {
    const w = world();
    const before = templates.get(w.db, w.template.id)!;
    const original = w.db.prepare.bind(w.db);
    w.db.prepare = ((sql: string) => {
      if (/^\s*INSERT INTO templates/.test(sql)) throw new Error('the disk is full');
      return original(sql);
    }) as typeof w.db.prepare;
    expect(() => writeSample(w, w.run, w.variant)).toThrow('the disk is full');
    w.db.prepare = original;
    expect(templates.get(w.db, w.template.id)).toEqual(before);
    expect(() => w.db.exec('BEGIN IMMEDIATE; ROLLBACK')).not.toThrow();     // a transaction left open would refuse this
  });

  it('a later sample replaces the earlier one', () => {
    const w = world();
    writeSample(w, w.run, w.variant);
    put(w.variant.video, 'a better video');
    writeSample(w, w.run, w.variant);
    expect(readFileSync(join(w.folder, 'sample.mp4'), 'utf8')).toBe('a better video');
    expect(readdirSync(w.folder).sort()).toEqual(['poster.jpg', 'sample.mp4', 'template.json']);
  });

  it('a file of the variant that is missing: nothing in the template folder or the card changes', () => {
    const w = world();
    const before = templates.get(w.db, w.template.id)!;
    expect(() => writeSample(w, w.run, { ...w.variant, image: `jobs/${w.run.id}/v1/no-poster.jpg` })).toThrow();
    expect(readdirSync(w.folder)).toEqual(['template.json']);   // dot files included: the copy of the video that was begun is gone
    expect(() => writeSample(w, w.run, { ...w.variant, video: `jobs/${w.run.id}/v1/no-video.mp4` })).toThrow();
    expect(readdirSync(w.folder)).toEqual(['template.json']);
    expect(templates.get(w.db, w.template.id)).toEqual(before);
  });

  it('a template without a row still gets its files', () => {
    const w = world(null);
    writeSample(w, w.run, w.variant);
    expect(existsSync(join(w.folder, 'sample.mp4'))).toBe(true);
    expect(templates.get(w.db, w.template.id)).toBeNull();
  });

  it('refuses a run that is not a produce run', () => {
    const w = world();
    const id = enqueue(w.db, { kind: 'scan', source: 'topads', trigger: 'manual' }, 'scan-1', null, w.clock.now());
    expect(() => writeSample(w, getRun(w.db, id)!, w.variant)).toThrow(/produce/);
  });
});
