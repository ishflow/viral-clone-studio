// `sample: true`: the first variant of the run becomes the template's own video and poster, and the card shows them.
import { copyFileSync, renameSync, rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { RunRow } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { abs, rel } from '../paths.ts';
import type { Clock } from '../ports.ts';

/**
 * Copies the variant's video and poster (paths under data/) to `templates/<templateId>/sample.mp4` and `poster.jpg`.
 * Both are copied to a temp name first and renamed when both are whole: a crash never leaves a half file that looks
 * finished, and a copy that fails leaves nothing. Then the card's two media fields follow, in one transaction with the
 * read of the row: what another process changes meanwhile (state, owner, note, counters) is never written back old.
 * Throws when a file cannot be copied or the database refuses; the variant itself is not touched.
 */
export function writeSample(deps: { db: DatabaseSync; clock: Clock }, run: RunRow, variant: { video: string; image: string }): void {
  if (run.input.kind !== 'produce') throw new Error(`writeSample: run ${run.id} is a ${run.input.kind} run, not a produce run`);
  const id = run.input.templateId;
  const video = rel('templates', id, 'sample.mp4'), image = rel('templates', id, 'poster.jpg');
  const copies = [{ from: variant.video, to: video }, { from: variant.image, to: image }].map(({ from, to }) => (
    { from: abs(from), part: abs(rel('templates', id, `.${to.split('/').pop()}.part`)), to: abs(to) }
  ));
  try {
    for (const { from, part } of copies) copyFileSync(from, part);
  } catch (error) {
    for (const { part } of copies) rmSync(part, { force: true });
    throw error;
  }
  for (const { part, to } of copies) renameSync(part, to);

  // the write lock is taken before the row is read: no other connection can change the row between the read and the write
  deps.db.exec('BEGIN IMMEDIATE');
  try {
    const row = templates.get(deps.db, id);
    if (row !== null) templates.upsert(deps.db, { ...row, card: { ...row.card, video, image } }, deps.clock.now());
    deps.db.prepare(`UPDATE templates SET sample_changed_at = NULL WHERE id = ? AND sample_changed_at <= ?
      AND NOT EXISTS (SELECT 1 FROM runs WHERE kind = 'edit' AND ref = ? AND state IN ('held','queued','running') AND json_valid(input) AND json_extract(input, '$.shotsChanged') = 1)`).run(id, run.createdAt, id);
    deps.db.exec('COMMIT');
  } catch (error) {
    deps.db.exec('ROLLBACK');
    throw error;
  }
}
