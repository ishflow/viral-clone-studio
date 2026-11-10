// The automatic check of a written template: does it really compose? Nothing here is paid and nothing leaves the machine.
// schema → no misplaced placeholder → a sample fill → checkFill → resolve → the edit document's schema → compose → the
// composition folder with stand-in media → the renderer's check. The first step that finds something ends the chain, with
// every issue of that step; it never throws for a bad template.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compose, ComposeError } from '../compose/index.ts';
import type { Composition } from '../compose/index.ts';
import { writeComposition } from '../compose/write.ts';
import { parseEdit } from '../edit/schema.ts';
import type { Edit } from '../edit/types.ts';
import type { Renderer } from '../ports.ts';
import { checkFill, placeholderFacts, resolve } from '../resolve/index.ts';
import type { FillNote } from '../resolve/index.ts';
import { placeholderMedia } from '../resolve/placeholder.ts';
import { Fill, Template } from '../template/schema.ts';
import type { TemplateJson } from '../template/schema.ts';
import { misplacedPlaceholders } from './brand.ts';
import { needsOf } from './placeholders.ts';
import type { Placeholders } from './placeholders.ts';
import { sampleFill } from './sample.ts';

export interface CheckDeps { renderer: Renderer; placeholders: Placeholders; writeOwned?: <T>(body: () => T) => T; checkOwnership?: () => void }
export type CheckStep = 'schema' | 'placeholders' | 'fill' | 'resolve' | 'edit' | 'compose' | 'write' | 'renderer';
/**
 * One thing wrong with a template. `path`: where (`shots.1.at` in the template; an issue of the editor names its place in
 * the composed document, `texts[0].box`, whose shots and texts stand in the template's order; an issue of the renderer names
 * an element). `fix`: what to change, when the step says it; else ''.
 */
export interface TemplateIssue { code: string; path: string; message: string; fix: string }
/** `notes`: what the sample customer would not see (nothing, unless the sample fill could not give a picture). */
export type TemplateCheck =
  | { ok: true; template: TemplateJson; notes: FillNote[] }
  | { ok: false; step: CheckStep; issues: TemplateIssue[] };

/** A step names at most this many issues: enough for a person and for a model to act on. */
export const MAX_CHECK_ISSUES = 20;

const failed = (step: CheckStep, issues: TemplateIssue[]): TemplateCheck => ({ ok: false, step, issues: issues.slice(0, MAX_CHECK_ISSUES) });
const one = (code: string, path: string, message: string, fix = ''): TemplateIssue => ({ code, path, message, fix });

/** What a step threw. ResolveError and WriteError carry a code; ComposeError carries every issue of the editor. */
function thrown(step: CheckStep, error: unknown, fallback: string): TemplateCheck {
  if (error instanceof ComposeError && error.issues.length > 0) return failed(step, error.issues.map((issue) => one(issue.code, issue.path, issue.message, issue.fix)));
  const code = (error as { code?: unknown } | null)?.code, file = (error as { file?: unknown } | null)?.file;
  return failed(step, [one(typeof code === 'string' ? code : fallback, typeof file === 'string' ? file : '', error instanceof Error ? error.message : String(error))]);
}

/**
 * What a template can change for a finding of the renderer that says nothing of the kind itself (the renderer's own hint is
 * written for HTML). Without one the model's second answer is a guess. The lines of one plated text never cover each other
 * (the composer keeps a line height plus the plate's padding between them), so a covered text is another text, window or card.
 */
function rendererFix(code: string): string {
  if (code !== 'text_occluded') return '';
  return 'a text is covered at this moment: move its box off the other text, window or card that covers it, or change when one of them is on screen';
}

/**
 * `json`: a template as it was written (by the model, or by an edit). `dir`: the folder the composition is written into
 * (`index.html`, `timeline.json`, `assets/`, and `media/` with the stand-in files); an older check there is overwritten.
 */
export async function checkTemplate(deps: CheckDeps, json: unknown, dir: string): Promise<TemplateCheck> {
  const parsed = Template.safeParse(json);
  if (!parsed.success) return failed('schema', parsed.error.issues.map((issue) => one('schema', issue.path.join('.'), issue.message)));
  const template = parsed.data;

  const misplaced = misplacedPlaceholders(template);
  if (misplaced.length > 0) {
    return failed('placeholders', misplaced.map((finding) => one(
      'placeholder', finding.path, 'the field holds a {placeholder}, and no fill replaces it there: it is shown on the site or sent to a provider as it is written',
      'write plain words: a placeholder stands only in a copy, a prompt of a shot, of a still, of the presenter or of the music, and the lines of the script',
    )));
  }

  const sample = Fill.safeParse(sampleFill(template));
  if (!sample.success) return failed('fill', sample.error.issues.map((issue) => one('sample-fill', issue.path.join('.'), `no sample fill can be made of this template: ${issue.message}`)));
  const fill = sample.data;
  const { errors, notes } = checkFill(template, fill);
  if (errors.length > 0) return failed('fill', errors.map((error) => one(error.code, '', error.message)));

  const media = placeholderMedia(template, fill);
  let edit: Edit;
  try { edit = resolve(template, fill, media); } catch (error) { return thrown('resolve', error, 'resolve-failed'); }
  const document = parseEdit(JSON.parse(JSON.stringify(edit)));
  if (!document.ok) return failed('edit', document.issues.length > 0 ? document.issues.map((issue) => one(issue.code, issue.path, issue.message, issue.fix)) : [one('schema', '', 'the edit document is not valid')]);

  let composition: Composition;
  try { composition = compose(document.edit, placeholderFacts(document.edit, media)); } catch (error) { return thrown('compose', error, 'compose-failed'); }

  try {
    const made = join(dir, 'media');
    await deps.placeholders.make(needsOf(template, media, composition.files), made, template.canvas);
    const write = () => writeComposition(dir, composition, Object.fromEntries(composition.files.map((file) => [file, join(made, basename(file))])));
    if (deps.writeOwned) deps.writeOwned(write); else write();
  } catch (error) { return thrown('write', error, 'media-not-made'); }

  let verdict: Awaited<ReturnType<Renderer['check']>>;
  try { verdict = await deps.renderer.check(dir); } catch (error) { return thrown('renderer', error, 'check-not-run'); }
  if (!verdict.ok) {
    if (verdict.issues.length === 0) return failed('renderer', [one('check-failed', '', 'the renderer refused the composition without naming an issue')]);
    return failed('renderer', verdict.issues.map((issue) => one(issue.code, issue.target ?? '', issue.second === null ? issue.message : `${issue.message} (at ${issue.second} s)`, rendererFix(issue.code))));
  }
  return { ok: true, template, notes };
}

/**
 * `check.json` in a template's folder: `{ at, issues }`, what the last check found, for the admin. A check that passed
 * writes it with no issue, so the findings of an older one do not stay.
 */
export function writeVerdict(dir: string, check: TemplateCheck | TemplateIssue[], at: Date): void {
  const issues = Array.isArray(check) ? check : check.ok ? [] : check.issues;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'check.json'), `${JSON.stringify({ at: at.toISOString(), issues }, null, 2)}\n`);
}
