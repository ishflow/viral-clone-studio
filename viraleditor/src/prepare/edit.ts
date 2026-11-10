// The worker's handler for `edit` runs: an admin changed a template's card on the site; the change goes into template.json
// and the template is checked again. The edited template waits under its own name (`edit.json`) and takes the place of
// `template.json` only when it passed; when it did not, the row gets back the card of the template that is still there,
// the note `check-failed`, and `check.json` says what was wrong. Only the card's columns of the row are written (`setCard`),
// inside one transaction that reads the row first: its state, its owner and its counters are the site's.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { RunInput } from '../contracts.ts';
import { finish, holds } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import type { Clock, Renderer } from '../ports.ts';
import { cardOf } from '../template/card.ts';
import { minutesFor, paidFor } from '../template/estimate.ts';
import { Template } from '../template/schema.ts';
import type { TemplateJson } from '../template/schema.ts';
import { checkTemplate, writeVerdict } from './check.ts';
import type { TemplateIssue } from './check.ts';
import { keepFrames } from './frames.ts';
import type { Placeholders } from './placeholders.ts';
import { transaction } from './transaction.ts';

export interface EditDeps { db: DatabaseSync; dataDir: string; renderer: Renderer; placeholders: Placeholders; clock: Clock }
type EditInput = Extract<RunInput, { kind: 'edit' }>;

/** The card cannot be applied to this template. `edit-shots`: it does not name every shot once · `edit-text`: a text for a shot that shows none. */
export class EditRefused extends Error {
  code: 'edit-shots' | 'edit-text';
  constructor(code: EditRefused['code'], message: string) { super(message); this.name = 'EditRefused'; this.code = code; }
}

const differs = (a: number, b: number): boolean => Math.abs(a - b) > 1e-6;
const milli = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/**
 * The template with the card's changes: title, category, description, tags, the number of products, and per shot its
 * action, its text and its times. Only what differs from the template's own card is touched. Pure; the result is not checked here.
 * Times: a beats shot gets its frames from the card's seconds, and the texts and the punch-in of a moved shot move with it;
 * a talking shot has no place in time, so only a new length counts: it becomes the seconds of its segment and of its clip.
 */
export function applyCard(template: TemplateJson, card: EditInput['card']): TemplateJson {
  const before = cardOf(template, { image: null, video: null });
  const next = structuredClone(template);
  next.title = card.title;
  next.category = card.category;
  next.description = card.description;
  next.tags = [...card.tags];
  next.products = { min: card.products, max: Math.max(template.products.max, card.products) };

  const edits = new Map(card.shots.map((shot) => [shot.n, shot]));
  if (card.shots.length !== template.shots.length || template.shots.some((_, i) => !edits.has(i + 1))) {
    throw new EditRefused('edit-shots', `the card names ${card.shots.length} shot(s) (${card.shots.map((shot) => shot.n).join(', ')}); the template has the shots 1 … ${template.shots.length}, each once`);
  }
  const fps = template.canvas.fps;
  const beats = template.mode === 'beats';
  template.shots.forEach((old, i) => {
    const edited = edits.get(i + 1)!, was = before.shots[i]!, shot = next.shots[i]!;
    shot.action = edited.action;
    if (edited.text !== was.text) {
      // the text the card shows for a shot: the first one on screen while the shot is (cardOf)
      const at = old.at ?? 0, end = at + (old.for ?? 0);
      const shown = template.texts.findIndex((text) => text.at !== undefined && text.for !== undefined && text.at < end && text.at + text.for > at);
      if (shown < 0) throw new EditRefused('edit-text', `shot ${i + 1} has no text on screen: there is nothing "${edited.text}" could replace`);
      next.texts[shown]!.copy = edited.text;
    }
    if (beats && (differs(edited.from, was.from) || differs(edited.to, was.to))) {
      shot.at = Math.round(edited.from * fps);
      shot.for = Math.round(edited.to * fps) - shot.at;
      if (shot.motion?.kind === 'punch-in') shot.motion.at += shot.at - (old.at ?? 0);
    } else if (!beats && differs(edited.to - edited.from, was.to - was.from)) {
      shot.clip_seconds = milli(edited.to - edited.from);
      const segment = next.script?.segments.find((candidate) => candidate.id === shot.segment);
      if (segment !== undefined) segment.seconds = shot.clip_seconds;
    }
  });

  // a text belongs to the shot it starts in: it keeps its distance to the shot's start, and to its end when it ends inside it
  template.texts.forEach((was, t) => {
    if (was.at === undefined || was.for === undefined) return;
    const start = was.at, length = was.for;
    const i = template.shots.findIndex((shot) => shot.at !== undefined && shot.for !== undefined && shot.at <= start && start < shot.at + shot.for);
    const old = template.shots[i], now = next.shots[i], text = next.texts[t]!;
    if (old?.at === undefined || old.for === undefined || now?.at === undefined || now.for === undefined || (old.at === now.at && old.for === now.for)) return;
    const lead = start - old.at, tail = old.at + old.for - (start + length);
    text.at = now.at + lead;
    if (tail >= 0) text.for = now.for - lead - tail;
  });
  return next;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The card of an edit run as the contract has it. The site is another process: what it queued is read like any outside input. */
const EditCard = z.object({
  title: z.string(), category: z.string(), products: z.number().int(), description: z.string(), tags: z.array(z.string()),
  shots: z.array(z.object({ n: z.number().int(), from: z.number(), to: z.number(), action: z.string(), text: z.string(), product: z.number().nullable() })),
});

async function edit(deps: EditDeps, input: EditInput): Promise<{ ok: boolean; note: string | null }> {
  const { db, clock } = deps;
  const id = input.templateId;
  const dir = join(deps.dataDir, 'templates', id);
  const file = join(dir, 'template.json');
  let stored: TemplateJson | null = null;
  if (existsSync(file)) { try { stored = Template.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { stored = null; } }
  if (templates.get(db, id) === null || stored === null) return { ok: false, note: 'template-missing' };
  const old = stored;

  /** Writes what the row says of `template`, and the note; false when the row is gone. `inPlace`: runs first, in the same transaction, when the row is there. */
  const write = (template: TemplateJson, note: string | null, inPlace: () => void = () => {}): boolean => transaction(db, () => {
    const row = templates.get(db, id);
    if (row === null) return false;
    inPlace();
    return templates.setCard(db, id, {
      card: { ...keepFrames(cardOf(template, { image: row.card.image, video: row.card.video }), row.card.shots), referenceImage: row.card.referenceImage, referenceVideo: row.card.referenceVideo, referenceMetric: row.card.referenceMetric }, estimate: paidFor(template, 1), minutes: minutesFor(template), note,
    }, clock.now());
  });
  /** The site wrote the edited card at once: the row goes back to the card of the template that is still on disk. */
  const refused = (issues: TemplateIssue[]): { ok: boolean; note: string } => {
    writeVerdict(dir, issues, clock.now());
    return write(old, 'check-failed') ? { ok: false, note: 'check-failed' } : { ok: false, note: 'template-missing' };
  };

  const card = EditCard.safeParse(input.card);
  if (!card.success) {
    return refused(card.error.issues.map((issue) => ({ code: 'edit-card', path: issue.path.join('.'), message: `the card of the edit is not a card: ${issue.message}`, fix: '' })));
  }
  let edited: TemplateJson;
  try { edited = applyCard(old, card.data); } catch (error) {
    if (!(error instanceof EditRefused)) throw error;
    return refused([{ code: error.code, path: error.code === 'edit-shots' ? 'shots' : 'texts', message: error.message, fix: '' }]);
  }
  const waiting = join(dir, 'edit.json');
  writeFileSync(waiting, json(edited));
  const check = await checkTemplate(deps, edited, join(dir, 'check'));
  if (!check.ok) return refused(check.issues);
  writeVerdict(dir, check, clock.now());
  return write(check.template, null, () => renameSync(waiting, file)) ? { ok: true, note: null } : { ok: false, note: 'template-missing' };
}

export function editHandler(deps: EditDeps): (run: RunRow) => Promise<void> {
  return async (run) => {
    const input = run.input;
    if (input.kind !== 'edit') throw new Error(`edit handler got a ${input.kind} run`);
    const outcome = await edit(deps, input);
    if (!outcome.ok && input.shotsChanged && input.sampleChangedBefore !== undefined) transaction(deps.db, () => {
      if (!holds(deps.db, run.id, run.claimedBy)) return;
      deps.db.prepare('UPDATE templates SET sample_changed_at = ? WHERE id = ? AND sample_changed_at = ?')
        .run(input.sampleChangedBefore ?? null, input.templateId, run.createdAt);
    });
    finish(deps.db, run.id, { kind: 'edit', ok: outcome.ok, note: outcome.note }, deps.clock.now());
  };
}
