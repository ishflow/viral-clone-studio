import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { RunInput } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { beginOperation, endOperation, enqueue, operation } from '../db/runs.ts';
import { cli } from './commands.ts';
import { fakeContext } from './testing.ts';

const input: RunInput = { kind: 'produce', templateId: 't', quality: 'fast', variants: 1, language: 'en', products: [], sample: false };

function stuckRun() {
  const dir = mkdtempSync(join(tmpdir(), 'vc-cli-settle-'));
  const db = openDb(join(dir, 'db.sqlite'));
  const at = new Date('2026-10-06T10:00:00Z');
  const id = enqueue(db, input, 'job-1', null, at);
  db.prepare("UPDATE runs SET state = 'stopped', reason = 'submission-unknown' WHERE id = ?").run(id);
  beginOperation(db, id, 'v1:image:s2', 'image', at);
  endOperation(db, id, 'v1:image:s2', { state: 'unknown', error: 'POST answered HTTP 503 without a task [units:1]' }, at);
  return { dir, db, id };
}

it('settle-unknown: the unknown row of a stuck run becomes failed, with the name given, and the answer says which', async () => {
  const { dir, db, id } = stuckRun();
  const { context, calls } = fakeContext();
  const ran = await cli(['settle-unknown', id, '--by', 'Owner', '--data-dir', dir, '--json'], context);
  expect(ran.exit).toBe(0);
  expect(JSON.parse(ran.stdout).result).toMatchObject({ runId: id, settled: ['v1:image:s2'] });
  expect(operation(db, id, 'v1:image:s2')).toMatchObject({ state: 'failed' });
  expect(operation(db, id, 'v1:image:s2')!.error).toContain('Owner');
  expect(calls).toEqual([]);
  const again = await cli(['settle-unknown', id, '--by', 'Owner', '--data-dir', dir, '--json'], context);   // nothing unknown any more
  expect(again.exit).toBe(2);
  db.close();
});

it('settle-unknown: no name, no change; a run that is not stuck on submission-unknown is refused', async () => {
  const { dir, db, id } = stuckRun();
  const { context } = fakeContext();
  expect((await cli(['settle-unknown', id, '--data-dir', dir, '--json'], context)).exit).toBe(2);
  expect(operation(db, id, 'v1:image:s2')).toMatchObject({ state: 'unknown' });
  db.prepare("UPDATE runs SET reason = 'engine-error' WHERE id = ?").run(id);
  expect((await cli(['settle-unknown', id, '--by', 'Owner', '--data-dir', dir, '--json'], context)).exit).toBe(2);
  expect(operation(db, id, 'v1:image:s2')).toMatchObject({ state: 'unknown' });
  db.close();
});
