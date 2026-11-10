// Explicit, offline upgrade for old ready templates. The operator runs this after pausing the worker;
// it never downloads, calls a model, deletes a file, or publishes a template.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import * as templates from '../db/templates.ts';
import type { Clock, Media } from '../ports.ts';
import { minutesFor } from '../template/estimate.ts';
import { Template } from '../template/schema.ts';
import { takeFrames, withFrames } from './frames.ts';
import { transaction } from './transaction.ts';

function insideRoot(root: string, file: string): string {
  const actual = realpathSync(file);
  if (actual !== resolve(file) || !actual.startsWith(root + sep) || relative(root, actual).split(sep).includes('retired')) throw new Error('reference-outside-data');
  return actual;
}

export async function backfillReferences(deps: { db: DatabaseSync; dataDir: string; media: Media; clock: Clock }): Promise<{ updated: string[]; unavailable: string[]; failed: string[] }> {
  const report = { updated: [] as string[], unavailable: [] as string[], failed: [] as string[] };
  const root = realpathSync(deps.dataDir);
  const inside = (file: string): string => insideRoot(root, file);
  for (const row of templates.list(deps.db)) {
    if (!['ready', 'published', 'hidden'].includes(row.state) || !/^[A-Za-z0-9_-]+$/.test(row.id)) continue;
    if (row.state === 'ready' && (!(row.card.seconds > 0) || !row.card.shots.length || !row.estimate)) {
      transaction(deps.db, () => templates.setState(deps.db, row.id, 'failed', 'check-failed', deps.clock.now()));
      report.failed.push(row.id);
      continue;
    }
    if (row.card.referenceImage && row.card.referenceVideo) {
      try { inside(resolve(root, row.card.referenceImage)); inside(resolve(root, row.card.referenceVideo)); } catch { report.unavailable.push(row.id); }
      continue;
    }
    try {
      const raw = deps.db.prepare("SELECT input FROM runs WHERE kind = 'prepare' AND ref = ? ORDER BY created_at DESC LIMIT 1").get(row.id) as { input: string } | undefined;
      const from = raw ? JSON.parse(raw.input)?.from : null;
      const sourceId = from?.kind === 'candidate' ? from.candidateId : row.id;
      if (typeof sourceId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sourceId)) throw new Error('reference-source-invalid');
      const sourceDir = join(root, 'sources', sourceId);
      const meta = JSON.parse(readFileSync(inside(join(sourceDir, 'meta.json')), 'utf8'));
      if (typeof meta.file !== 'string') throw new Error('reference-file-invalid');
      const source = inside(resolve(sourceDir, meta.file));
      const dir = join(root, 'templates', row.id);
      // Validate existing parents before creating or copying any artifact.
      inside(join(root, 'templates'));
      if (existsSync(dir)) inside(dir);
      mkdirSync(dir, { recursive: true });
      const poster = join(dir, 'reference.jpg'), video = join(dir, 'reference.mp4');
      if (existsSync(poster)) inside(poster);
      else await deps.media.still(source, 0.5, poster);
      if (existsSync(video)) inside(video);
      else copyFileSync(source, video);
      transaction(deps.db, () => {
        const current = templates.get(deps.db, row.id);
        if (!current || current.state !== row.state || current.owner !== row.owner) throw new Error('reference-template-changed');
        templates.setCard(deps.db, row.id, { ...current, card: { ...current.card, referenceImage: relative(root, poster), referenceVideo: relative(root, video) } }, deps.clock.now());
      });
      report.updated.push(row.id);
    } catch { report.unavailable.push(row.id); }
  }
  return report;
}

/**
 * Writes the minutes of the estimate again (`minutesFor`) for the ready, published and hidden templates, from the template.json
 * each keeps: the stored value is the one of an older formula (the old "2 + shots + 1"; later the one that counted a single render
 * of a delivered video). A template with no readable template.json inside the data folder is
 * `unavailable` and keeps its minutes. Offline, idempotent: a row whose minutes are right is not written. The minutes are the one
 * thing written: the update date of the row is kept (the gallery order and the "added" date come from it). A dry run
 * (`apply: false`, what the script does unless told) reads and reports only; `say` gets one line per template that changes
 * (or would): its old and its new minutes.
 */
export function backfillMinutes(deps: { db: DatabaseSync; dataDir: string }, options: { apply: boolean } = { apply: true }, say: (line: string) => void = () => {}): { updated: string[]; unavailable: string[] } {
  const report = { updated: [] as string[], unavailable: [] as string[] };
  const root = realpathSync(deps.dataDir);
  for (const row of templates.list(deps.db)) {
    if (!['ready', 'published', 'hidden'].includes(row.state) || !/^[A-Za-z0-9_-]+$/.test(row.id)) continue;
    try {
      const minutes = minutesFor(Template.parse(JSON.parse(readFileSync(insideRoot(root, join(root, 'templates', row.id, 'template.json')), 'utf8'))));
      if (minutes === row.minutes) continue;
      say(`${row.id}: ${row.minutes} -> ${minutes} min`);
      if (options.apply) transaction(deps.db, () => {
        const current = templates.get(deps.db, row.id);
        if (!current || current.state !== row.state || current.owner !== row.owner) throw new Error('minutes-template-changed');
        templates.setCard(deps.db, row.id, { ...current, minutes }, new Date(current.updatedAt));
      });
      report.updated.push(row.id);
    } catch { report.unavailable.push(row.id); }
  }
  return report;
}

/**
 * Gives the ready, published and hidden templates the pictures of their reference video that preparation now makes (`takeFrames`): a
 * frame for every shot, and for a customer's own template that has no image the first one as its card image. The frames are taken
 * from the `reference.mp4` each keeps. Writes only the image fields of the card and the files under templates/<id>; offline (no
 * download, no model, no paid call), nothing is deleted, an image or a frame that is there is kept. A dry run (`apply: false`, what
 * the script does unless told) reads and reports only. `updated`: the templates written (or that would be); `unavailable`: no
 * readable reference.mp4 inside the data folder, or no frame could be taken; `covers`, `shots`: the pictures added (or to be).
 * The update date of a template it writes is kept (the gallery order and the "added" date come from it). `say` gets one line per
 * template: what it adds (or would add). A poster or shots folder that is not a plain path inside the data folder makes the
 * template `unavailable` before anything is written; a file left on disk for a shot that has no frame on its card is taken again.
 */
export async function backfillFrames(deps: { db: DatabaseSync; dataDir: string; media: Media; clock: Clock }, options: { apply: boolean }, say: (line: string) => void = () => {}): Promise<{ updated: string[]; unavailable: string[]; covers: number; shots: number }> {
  const report = { updated: [] as string[], unavailable: [] as string[], covers: 0, shots: 0 };
  const root = realpathSync(deps.dataDir);
  for (const row of templates.list(deps.db)) {
    if (!['ready', 'published', 'hidden'].includes(row.state) || !/^[A-Za-z0-9_-]+$/.test(row.id)) continue;
    const card = row.card;
    const cover = row.owner !== null && !card.image;
    const missing = card.shots.filter((shot) => !shot.image && shot.to > shot.from).length;
    if (!cover && missing === 0) continue;
    try {
      const dir = join(root, 'templates', row.id);
      const source = insideRoot(root, join(dir, 'reference.mp4'));
      for (const path of [join(dir, 'poster.jpg'), join(dir, 'shots'), ...card.shots.map((shot) => join(dir, 'shots', `${shot.n}.jpg`))]) {
        if (lstatSync(path, { throwIfNoEntry: false })) insideRoot(root, path);
      }
      const describe = (covers: number, shots: number): string => `${row.id}: ${[covers ? 'cover' : '', shots ? `${shots} frames` : ''].filter(Boolean).join(' + ')}`;
      if (!options.apply) {
        report.updated.push(row.id); report.covers += cover ? 1 : 0; report.shots += missing;
        say(describe(cover ? 1 : 0, missing));
        continue;
      }
      const frames = await takeFrames(deps, row.id, card, source, (await deps.media.probe(source)).seconds, cover, true);
      const added = withFrames(card, frames);
      const shots = added.shots.filter((shot, i) => shot.image !== card.shots[i]!.image).length;
      if (added.image === card.image && shots === 0) throw new Error('no-frame');
      transaction(deps.db, () => {
        const current = templates.get(deps.db, row.id);
        if (!current || current.state !== row.state || current.owner !== row.owner) throw new Error('frames-template-changed');
        templates.setCard(deps.db, row.id, { ...current, card: withFrames(current.card, frames) }, new Date(current.updatedAt));
      });
      report.updated.push(row.id); report.covers += added.image === card.image ? 0 : 1; report.shots += shots;
      say(describe(added.image === card.image ? 0 : 1, shots));
    } catch { report.unavailable.push(row.id); }
  }
  return report;
}
