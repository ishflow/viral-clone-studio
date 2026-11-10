// The worker's handler for an `edit` run that carries `swap`: an admin set the people of a person-swap video on the site (the box
// of each on its still, and the words the model finds each by). The site wrote none of it: what it queued is read like any
// outside input, checked with the rules of swap.json, and written here, the only place that writes a template's swap.json after
// its preparation. The words become part of a paid request, so nothing unchecked reaches the file.
//
// Taken: the new swap.json waits under its own name (`swap.edit.json`) and takes the place of `swap.json` in the transaction
// that writes the same people into the card of the row. Refused: swap.json and the card stay as they are, the row gets the note
// `check-failed` and `check.json` says what was wrong. The parts and the sound are the video's own: no edit changes them.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { CardSwap } from '../contracts.ts';
import { finish } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import type { Clock } from '../ports.ts';
import { writeVerdict } from '../prepare/check.ts';
import type { TemplateIssue } from '../prepare/check.ts';
import { transaction } from '../prepare/transaction.ts';
import { SwapTemplate } from '../template/swap-schema.ts';

export interface SwapEditDeps { db: DatabaseSync; dataDir: string; clock: Clock }
interface Outcome { ok: boolean; note: string | null }

/** What an edit may carry: the people, and nothing beside them. Each person is checked with the template (`SwapTemplate`). */
const SwapEdit = z.strictObject({ persons: z.array(z.unknown()) });

/** The swap.json at `file`, or null when it is not there or is not one. */
function read(file: string): CardSwap | null {
  try {
    if (!existsSync(file)) return null;
    const parsed = SwapTemplate.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** The template with the people of the edit, or what is wrong with them. Pure. */
export function applyPeople(stored: CardSwap, edit: unknown): { swap: CardSwap } | { issues: TemplateIssue[] } {
  const issues = (error: z.ZodError): { issues: TemplateIssue[] } => ({
    issues: error.issues.map((issue) => ({ code: 'edit-swap', path: issue.path.join('.'), message: `the people of the edit are not the people of a person-swap video: ${issue.message}`, fix: '' })),
  });
  const given = SwapEdit.safeParse(edit);
  if (!given.success) return issues(given.error);
  const next = SwapTemplate.safeParse({ ...stored, people: given.data.persons.length, persons: given.data.persons });
  return next.success ? { swap: next.data } : issues(next.error);
}

function edit({ db, dataDir, clock }: SwapEditDeps, templateId: string, people: unknown): Outcome {
  const MISSING: Outcome = { ok: false, note: 'template-missing' };
  const dir = join(dataDir, 'templates', templateId);
  const file = join(dir, 'swap.json');
  const stored = read(file);
  if (templates.get(db, templateId) === null || stored === null) return MISSING;

  const applied = applyPeople(stored, people);
  if ('issues' in applied) {
    writeVerdict(dir, applied.issues, clock.now());
    const noted = transaction(db, () => {
      const row = templates.get(db, templateId);
      return row !== null && templates.setCard(db, templateId, { card: row.card, estimate: row.estimate, minutes: row.minutes, note: 'check-failed' }, clock.now());
    });
    return noted ? { ok: false, note: 'check-failed' } : MISSING;
  }

  const waiting = join(dir, 'swap.edit.json');
  writeFileSync(waiting, `${JSON.stringify(applied.swap, null, 2)}\n`);
  const written = transaction(db, () => {
    const row = templates.get(db, templateId);
    if (row === null) return false;
    // The record first, the file last: a record that does not take the people throws before the file is touched, and a file that
    // cannot take its place throws inside the transaction, which takes the card back. (Left: a commit that fails after the file is in
    // its place; the card is then the one before until the people are written again.)
    if (!templates.setCard(db, templateId, { card: { ...row.card, swap: applied.swap }, estimate: row.estimate, minutes: row.minutes, note: null }, clock.now())) return false;
    renameSync(waiting, file);
    return true;
  });
  if (!written) { rmSync(waiting, { force: true }); return MISSING; }
  writeVerdict(dir, [], clock.now());
  return { ok: true, note: null };
}

export function swapEditHandler(deps: SwapEditDeps): (run: RunRow) => Promise<void> {
  return async (run) => {
    const input = run.input;
    if (input.kind !== 'edit') throw new Error(`the person-swap edit got a ${input.kind} run`);
    const outcome = edit(deps, input.templateId, input.swap);
    finish(deps.db, run.id, { kind: 'edit', ok: outcome.ok, note: outcome.note }, deps.clock.now());
  };
}
