// The worker's handler for `prepare` runs: one reference video (a scan's candidate, or a link) becomes a template.
// fetch or reuse the source → look at it → the model scores it → the day's cap → the model writes template.json → the check
// (and one more try with the check's findings). The cuts of the reference are measured, not judged: a beats template has its
// shots, frame for frame. Nothing here is paid. Every ending is a result `{ kind: 'prepare', state, note }` with a bare code as
// its note; the handler never queues a run.
//
// A run may be handed to the handler again at any point (a takeover after a crash) and ends as one clean run would:
// - a template row that is `ready`, `published`, `hidden` or `failed` already says how the run ended: nothing more is done;
// - what was fetched, seen and scored is kept in `sources/<id>/` and used again;
// - the usage unit is taken in the transaction that writes UNIT_TAKEN into the note of the `preparing` row, so once per row;
// - `above_threshold` is counted in the transaction that writes the candidate's score (only while it has none), `prepared`
//   in the one that makes the row `ready` (only while it is `preparing`);
// - a `template.json` in the folder of a `preparing` row passed its check before the worker died: it is taken as it is.
// Every write of a row re-reads it inside one BEGIN IMMEDIATE transaction: what the site did meanwhile is never written over.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Card, PrepareNote, RunInput } from '../contracts.ts';
import * as candidates from '../db/candidates.ts';
import type { CandidateRow } from '../db/candidates.ts';
import { finish, holds } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import * as scans from '../db/scans.ts';
import { readSettings, takeUsage } from '../db/settings.ts';
import * as templates from '../db/templates.ts';
import type { TemplateRow } from '../db/templates.ts';
import { LlmInvalid } from '../ports.ts';
import type { Clock, Downloader, Llm, Media, Renderer, Transcriber } from '../ports.ts';
import { cardOf } from '../template/card.ts';
import { minutesFor, paidFor } from '../template/estimate.ts';
import { VIDEO_SECONDS_MAX } from '../template/limits.ts';
import { Template, TemplateShape } from '../template/schema.ts';
import type { TemplateJson } from '../template/schema.ts';
import { checkTemplate, writeVerdict } from './check.ts';
import { offPlan, SHOTS_MAX } from './cuts.ts';
import { takeFrames, withFrames } from './frames.ts';
import type { Placeholders } from './placeholders.ts';
import type { Again } from './prompts.ts';
import { uploadSource } from './upload.ts';
import { fetchSource, lookAt, RangeRefused, rangeProblem, shotPages, SourceTooLong, SourceUnavailable, storedSeconds } from './read.ts';
import type { Look } from './read.ts';
import { score, ScoreAnswer } from './score.ts';
import type { Scored } from './score.ts';
import { transaction } from './transaction.ts';
import { templateWriter } from './write.ts';

export { checkTemplate } from './check.ts';
export type { CheckDeps, TemplateCheck, TemplateIssue } from './check.ts';
export { editHandler } from './edit.ts';
export type { EditDeps } from './edit.ts';
export { localPlaceholders } from './placeholders.ts';
export type { Placeholders } from './placeholders.ts';
export { score } from './score.ts';
export type { Scored } from './score.ts';

export interface PrepareDeps {
  db: DatabaseSync;
  dataDir: string;                        // the data directory: `sources/<id>/` and `templates/<id>/` are made in it
  llm: Llm;
  downloader: Downloader;
  transcriber: Transcriber;
  media: Media;
  renderer: Renderer;                     // only its `check`
  placeholders: Placeholders;             // the stand-in media of the check; never a Generator
  clock: Clock;
  checkOwnership?: () => void;
  writeOwned?: <T>(body: () => T) => T;
}

/**
 * The note of a `preparing` row from the moment the day's unit is taken for it (written in the same transaction). It is not
 * a reason: a note is one only on a `failed` row.
 */
export const UNIT_TAKEN = 'unit-taken';
/** The template requests of a run after a failed check: the first answer, and one more with the check's findings. */
const CHECKED_ANSWERS = 2;

type PrepareInput = Extract<RunInput, { kind: 'prepare' }>;
interface Outcome { state: 'ready' | 'failed'; note: string | null; detail?: string }   // detail: why a model's answer was refused (LlmInvalid.code), stored on the run

/** YYYY-MM-DD in local time: the key of `usage` (the scan counts its own kind by the same day). */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const SourceUrl = TemplateShape.shape.source.shape.url;

/** A JSON file as its schema reads it, or null when it is not there or not what was written. */
function stored<T>(file: string, schema: { parse(value: unknown): T }): T | null {
  if (!existsSync(file)) return null;
  try { return schema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { return null; }
}

/**
 * The answer a worker left on disk after it passed its check, when that worker stopped before the row was ready: answer.json is
 * what the template schema reads, check.json says no issue, and the check is not older than the answer (an answer written after
 * the check was never checked). Anything less and the model is asked again.
 */
function vouched(dir: string): ReturnType<typeof Template.parse> | null {
  const answerFile = join(dir, 'answer.json');
  const checkFile = join(dir, 'check.json');
  const answer = stored(answerFile, Template);
  if (answer === null || !existsSync(checkFile)) return null;
  try {
    const { issues } = JSON.parse(readFileSync(checkFile, 'utf8')) as { issues?: unknown };
    if (!Array.isArray(issues) || issues.length > 0) return null;
    return statSync(checkFile).mtimeMs >= statSync(answerFile).mtimeMs ? answer : null;
  } catch { return null; }
}

/** How the run of a row ended, when the row is no longer being prepared. */
function ended(row: TemplateRow): Outcome | null {
  if (row.state === 'preparing') return null;
  if (row.state === 'ready' && (!(row.card.seconds > 0) || row.card.shots.length === 0 || row.estimate === null)) return { state: 'failed', note: 'check-failed' };
  return row.state === 'failed' ? { state: 'failed', note: row.note ?? 'check-failed' } : { state: 'ready', note: null };
}
/**
 * Why a candidate in this state is not prepared, or null when it may be. The site rejects candidates; an unsupported or an
 * already prepared one is never written over either. No note says "rejected" or "prepared already": `unsupported` stands in.
 */
function closed(candidate: CandidateRow, sourceDir: string): PrepareNote | null {
  if (candidate.state === 'rejected' || candidate.state === 'prepared') return 'unsupported';
  if (candidate.state !== 'unsupported') return null;
  const seconds = storedSeconds(sourceDir);
  return stored(join(sourceDir, 'score.json'), ScoreAnswer)?.unsupported ?? (seconds !== null && seconds > VIDEO_SECONDS_MAX ? 'too-long' : 'unsupported');
}

/** What the site shows while the template is being written. */
function waitingCard(title: string, look: Look, scored: Scored): Card {
  return {
    title: title.replace(/\s+/g, ' ').trim() || look.url, category: '', format: scored.mode === 'speech' ? 'talking' : 'no-talking', seconds: look.seconds,
    referenceViews: '', image: null, video: null, products: 1, shots: [], description: '', tags: [],
  };
}

async function prepare(deps: PrepareDeps, input: PrepareInput, run: RunRow): Promise<Outcome> {
  const { db, clock, dataDir } = deps;
  const guard = deps.checkOwnership ?? (() => {});
  const owned = <T>(body: () => T): T => transaction(db, () => { guard(); return body(); });
  guard();
  const { templateId, ownerId, from } = input;
  const settings = readSettings(db);
  const dir = join(dataDir, 'templates', templateId);
  const GONE: Outcome = { state: 'failed', note: 'unsupported' };          // the row was deleted: no note says so, and nobody is left to read one

  /** An ending without a template. A row that is still being prepared says why; any other row stays as the site has it. */
  const failed = (note: PrepareNote, detail = ''): Outcome => {
    owned(() => { if (templates.get(db, templateId)?.state === 'preparing') templates.setState(db, templateId, 'failed', note, clock.now()); });
    return detail === '' ? { state: 'failed', note } : { state: 'failed', note, detail };
  };

  /** A reference over the limit, by its length or by the downloader's refusal: the candidate is closed, never tried again. */
  const tooLong = (): Outcome => {
    if (candidateId !== null) {
      owned(() => {
        const now = candidates.get(db, candidateId);
        if (now !== null && closed(now, sourceDir) === null) candidates.setState(db, candidateId, 'unsupported', clock.now());
      });
    }
    return failed('too-long');
  };

  // 0. handled before, or not to be handled at all
  const before = templates.get(db, templateId);
  if (before !== null) { const end = ended(before); if (end !== null) {
    if (end.state === 'failed' && before.state !== 'failed') owned(() => templates.setState(db, templateId, 'failed', 'check-failed', clock.now()));
    return end;
  } }
  else if (from.kind !== 'candidate') return GONE;                              // the site makes the row of a link together with its run
  const first = from.kind === 'candidate' ? candidates.get(db, from.candidateId) : null;
  if (from.kind === 'candidate' && first === null) return failed('source-unavailable');
  const candidateId = first?.id ?? null;
  const url = from.kind === 'link' ? from.url : first?.url ?? '';
  const sourceDir = join(dataDir, 'sources', candidateId ?? templateId);
  const shut = first === null ? null : closed(first, sourceDir);
  if (shut !== null) return failed(shut);

  // 1. the reference: fetched and looked at once. A range that is no range is refused before anything is fetched
  const range = from.kind === 'candidate' ? undefined : from.range;
  if (range !== undefined && rangeProblem(range) !== null) return failed('bad-range');
  let look: Look;
  try {
    // a Top Ads card downloads its own video file (its page URL is not a video yt-dlp knows); the page stays the source everywhere else
    const fetched = from.kind === 'upload'
      ? await uploadSource(deps, sourceDir, ownerId, from, { runId: run.id, workerId: run.claimedBy, takeovers: run.takeovers }, range)
      : await fetchSource(deps, sourceDir, first?.video ?? url, first?.seconds ?? 0, range);
    guard();
    const source = { ...fetched, url };
    if (source.seconds > VIDEO_SECONDS_MAX) return tooLong();
    look = await lookAt(deps, sourceDir, source);
    guard();
    // the title the scan saw belongs to the reference too: the model reads both as data, and neither may be copied
    if (first !== null && first.title !== look.title) look = { ...look, title: `${first.title}\n${look.title}`.trim() };
  } catch (error) {
    if (error instanceof SourceTooLong) return tooLong();
    if (error instanceof RangeRefused) return failed('bad-range');
    if (!(error instanceof SourceUnavailable)) throw error;
    return failed('source-unavailable');
  }

  // 2. the score: asked once, kept with the source; written to the candidate while it has none
  const scoreFile = join(sourceDir, 'score.json');
  let scored = stored(scoreFile, ScoreAnswer);
  if (scored === null) {
    try { scored = await score(deps.llm, look); } catch (error) {
      if (!(error instanceof LlmInvalid)) throw error;
      return failed('llm-invalid', error.code);
    }
    guard();
    owned(() => writeFileSync(scoreFile, json(scored)));
  }
  const judged = scored;
  // a beats template has a shot for every cut: a reference that cuts more often than a template has shots is one the engine
  // cannot build, and no shot is merged to make it fit. A speech template has its own shots, whatever the picture does
  const unbuildable: PrepareNote | null = judged.unsupported ?? (judged.mode === 'beats' && look.shots.length > SHOTS_MAX ? 'unsupported' : null);
  const passes = judged.score >= settings.threshold;
  if (candidateId !== null) {
    const refused = owned((): PrepareNote | null => {
      const now = candidates.get(db, candidateId);
      if (now === null) return 'source-unavailable';
      const note = closed(now, sourceDir);
      if (note !== null) return note;                                      // rejected meanwhile: its state and its score stay as they are
      if (now.score === null) {
        candidates.upsert(db, { ...now, state: unbuildable === null ? 'scored' : 'unsupported', score: judged.score, scoreNotes: judged.notes.join('\n') }, clock.now());
        if (passes && unbuildable === null && now.scanId !== null) scans.addAboveThreshold(db, now.scanId);
      }
      return null;
    });
    if (refused !== null) return failed(refused);
  }
  if (unbuildable !== null) return failed(unbuildable);
  // a link is prepared whatever its score; so is a candidate an admin asked for
  if (from.kind === 'candidate' && !from.force && !passes) return failed('below-threshold');

  // 3. the day's cap and the row, together: one unit per template that is about to be written. A customer's own link counts
  //    and is never refused. The row of a candidate is made here; the row of a link is the site's.
  const cap = ownerId === null ? settings.dailyTemplates : Number.MAX_SAFE_INTEGER;
  const started = owned((): Outcome | TemplateRow => {
    const now = clock.now();
    const row = templates.get(db, templateId);
    if (row === null) {
      if (from.kind !== 'candidate') return GONE;
      if (!takeUsage(db, 'prepare', localDay(now), cap)) return { state: 'failed', note: 'daily-cap' };
      templates.upsert(db, {
        id: templateId, state: 'preparing', owner: ownerId, sourceKind: first === null || first.source === 'manual' ? 'link' : first.source, sourceUrl: url,
        note: UNIT_TAKEN, card: waitingCard(first?.title ?? look.title, look, judged), estimate: null, minutes: null,
      }, now);
      return templates.get(db, templateId)!;
    }
    const end = ended(row);
    if (end !== null) return end;
    if (row.note === UNIT_TAKEN) return row;                               // a run taken over: the unit is taken already
    if (!takeUsage(db, 'prepare', localDay(now), cap)) {
      templates.setState(db, templateId, 'failed', 'daily-cap', now);
      return { state: 'failed', note: 'daily-cap' };
    }
    templates.setState(db, templateId, 'preparing', UNIT_TAKEN, now);
    return row;
  });
  if (!('id' in started)) return started;

  // 4. the template: the one on disk when the worker died after it had passed; else the model writes it, and once more with
  //    the findings when its first answer fails the check. A beats answer is held to the shot plan first: one that retimes the
  //    reference is not checked any further. The answer waits as answer.json: template.json is only ever one that passed.
  const file = join(dir, 'template.json');
  let passed = stored(file, Template) ?? vouched(dir);
  if (passed === null) {
    const source: TemplateJson['source'] = {
      kind: started.sourceKind, url: SourceUrl.safeParse(url).success ? url : '',
      metrics: { views: first?.views ?? look.views ?? 0, likes: first?.likes ?? look.likes ?? 0, ctr_band: '' },
    };
    // what the model is given of the reference: for a beats template the shot sheets, drawn here and nowhere before
    let pictures = [look.sheet];
    if (judged.mode === 'beats') {
      try { pictures = await shotPages(deps, sourceDir, look); } catch (error) {
        if (!(error instanceof SourceUnavailable)) throw error;
        return failed('source-unavailable');
      }
    }
    const writer = templateWriter(deps.llm, look, pictures, judged, { id: templateId, source });
    guard();
    owned(() => mkdirSync(dir, { recursive: true }));
    let again: Again | null = null;
    for (let attempt = 0; attempt < CHECKED_ANSWERS && passed === null; attempt++) {
      let answer: TemplateJson;
      try { answer = await writer.write(again); } catch (error) {
        if (!(error instanceof LlmInvalid)) throw error;
        return failed('llm-invalid', error.code);
      }
      guard();
      owned(() => writeFileSync(join(dir, 'answer.json'), json(answer)));
      const retimed = judged.mode === 'beats' ? offPlan(answer.shots, look.shots) : [];
      const check = retimed.length > 0 ? null : await checkTemplate(deps, answer, join(dir, 'check'));
      const issues = check === null ? retimed : check.ok ? [] : check.issues;
      guard();
      owned(() => writeVerdict(dir, issues, clock.now()));
      if (check?.ok) passed = check.template;
      else again = { answer, issues };
    }
    if (passed === null) return failed('check-failed');
  }
  const template = passed;

  const referencePoster = join(dir, 'reference.jpg');
  if (!existsSync(referencePoster)) await deps.media.still(look.video, Math.min(0.5, look.seconds / 2), referencePoster);
  guard();
  const referenceVideo = join(dir, 'reference.mp4');
  owned(() => { if (!existsSync(referenceVideo)) cpSync(look.video, referenceVideo); });
  const frames = await takeFrames(deps, templateId, cardOf(template, { image: null, video: null }), look.video, look.seconds, started.owner !== null);
  guard();

  // 5. the end, in one transaction: the file in place, the row ready, the candidate prepared, the scan's count
  return owned((): Outcome => {
    const now = clock.now();
    const row = templates.get(db, templateId);
    if (row === null) return GONE;                                         // deleted meanwhile: not brought back
    const end = ended(row);
    if (end !== null) return end;                                          // hidden, published, failed meanwhile: left as it is
    const candidate = candidateId === null ? null : candidates.get(db, candidateId);
    const note = candidate === null ? null : closed(candidate, sourceDir);
    if (note !== null) {                                                   // rejected meanwhile: no template of a rejected candidate
      templates.setState(db, templateId, 'failed', note, now);
      return { state: 'failed', note };
    }
    guard();
    if (!existsSync(file)) renameSync(join(dir, 'answer.json'), file);
    templates.setState(db, templateId, 'ready', null, now);
    const card = withFrames(cardOf(template, { image: null, video: null }), frames);
    card.referenceImage = relative(dataDir, referencePoster);
    card.referenceVideo = relative(dataDir, referenceVideo);
    const kind = template.source.kind === 'topads' ? 'likes' : 'views';
    card.referenceMetric = { kind, count: template.source.metrics[kind] };
    // File uploads keep the customer's filename instead of a model-written title in another language.
    if (from.kind === 'upload') card.title = row.card.title;
    templates.setCard(db, templateId, { card, estimate: paidFor(template, 1), minutes: minutesFor(template), note: null }, now);
    if (candidate !== null) {
      candidates.setState(db, candidate.id, 'prepared', now);
      if (candidate.scanId !== null) scans.addPrepared(db, candidate.scanId);
    }
    return { state: 'ready', note: null };
  });
}

export function prepareHandler(deps: PrepareDeps): (run: RunRow) => Promise<void> {
  return async (run) => {
    const input = run.input;
    if (input.kind !== 'prepare') throw new Error(`prepare handler got a ${input.kind} run`);
    const guard = (): void => {
      if (!holds(deps.db, run.id, run.claimedBy)) throw new Error('prepare-owner-lost');
    };
    // In-flight adapters can finish after hand-back. They only write this attempt's private files.
    // Shared artifacts are published synchronously inside the ownership transaction.
    const attemptDir = join(deps.dataDir, 'prepare-attempts', run.id, crypto.randomUUID());
    const guarded = <T extends object>(port: T, output?: { method: string; index: number; directory: boolean; returnFile?: boolean }): T => new Proxy(port, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          guard();
          const destination = output && key === output.method ? String(args[output.index]) : null;
          const temporary = destination === null ? null : join(attemptDir, crypto.randomUUID(), relative(deps.dataDir, destination));
          if (temporary !== null && output) {
            mkdirSync(output.directory ? temporary : dirname(temporary), { recursive: true });
            if (existsSync(destination!)) cpSync(destination!, temporary, { recursive: true });
            args[output.index] = temporary;
          }
          const answer: unknown = await value.apply(target, args);
          guard();
          if (temporary !== null && destination !== null) transaction(deps.db, () => {
            guard(); mkdirSync(dirname(destination), { recursive: true });
            cpSync(temporary, destination, { recursive: true });
          });
          if (output?.returnFile && temporary !== null && destination !== null && typeof answer === 'object' && answer !== null) {
            const file = (answer as { file: string }).file;
            return { ...answer, file: file.startsWith(temporary) ? destination + file.slice(temporary.length) : file };
          }
          return answer;
        };
      },
    });
    let outcome: Outcome;
    try {
      guard();
      mkdirSync(attemptDir, { recursive: true });
      outcome = await prepare({ ...deps, checkOwnership: guard, writeOwned: body => transaction(deps.db, () => { guard(); return body(); }),
        downloader: guarded(deps.downloader, { method: 'video', index: 1, directory: true, returnFile: true }),
        media: guarded(guarded(guarded(deps.media, { method: 'still', index: 2, directory: false }), { method: 'sheet', index: 1, directory: false }), { method: 'trim', index: 3, directory: false }), transcriber: guarded(deps.transcriber),
        llm: guarded(deps.llm), renderer: guarded(deps.renderer, { method: 'check', index: 0, directory: true }),
        placeholders: guarded(deps.placeholders, { method: 'make', index: 1, directory: true }),
      }, input, run);
      guard();
    } catch (error) {
      if (!holds(deps.db, run.id, run.claimedBy)) return;
      transaction(deps.db, () => {
        guard();
        if (templates.get(deps.db, input.templateId)?.state === 'preparing') templates.setState(deps.db, input.templateId, 'failed', 'engine-error', deps.clock.now());
      });
      throw error;
    }
    transaction(deps.db, () => { guard(); finish(deps.db, run.id, { kind: 'prepare', state: outcome.state, note: outcome.note }, deps.clock.now(), outcome.detail ?? null); });
  };
}
