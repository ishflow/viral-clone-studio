// Is this fill a complete adaptation of this template? Free and pure, and it never throws: the pipeline runs it right after
// the adaptation, before the first paid request, and resolve runs it again before it builds anything.
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { imageOf, placeholdersIn } from '../template/values.ts';
import { own, ResolveError } from './error.ts';
import { pictureGiven } from './pictures.ts';
import { parseSegments, sharingWords } from './script.ts';
import type { Segments } from './script.ts';

/** Something wrong with the fill: the run must not start. Codes: `product-count`, `fill-missing`, `fill-unknown`, `unfilled:<placeholder>`, `copy-is-source`, `mark-lost`, `window-overlap`, and what parseScript throws. */
export interface FillIssue { code: string; message: string }
/** Something this customer will not get, to say before payment: a card or a window whose product or photograph the customer did not give is left out. `element`: the card's id, or the window's mark. */
export interface FillNote { code: 'left-out'; kind: 'card' | 'window'; element: string; picture: string; message: string }
export interface FillCheck { errors: FillIssue[]; notes: FillNote[] }

type Add = (code: string, message: string) => void;

export function checkFill(template: TemplateJson, fill: FillJson): FillCheck {
  const errors: FillIssue[] = [];
  const add: Add = (code, message) => { errors.push({ code, message }); };
  const speech = template.mode === 'speech';

  const products = fill.products.length;
  if (products < template.products.min || products > template.products.max) {
    add('product-count', `the fill has ${products} product(s); this template takes ${template.products.min} to ${template.products.max}`);
  }
  for (const text of template.texts) {
    const copy = entry(fill.texts, text.id, `texts.${text.id}`, add);
    if (copy === undefined) continue;
    filled(copy, `texts.${text.id}`, add);
    const source = folded(text.source_copy);
    if (source !== '' && folded(copy) === source) {
      add('copy-is-source', `texts.${text.id} repeats the text of the reference video ("${text.source_copy.trim()}"): write the copy in your own words`);
    }
  }
  known(fill.texts, template.texts.map((text) => text.id), 'texts', add);
  for (const shot of template.shots) {
    if (shot.continues !== undefined) {
      // a part of the clip of an earlier shot: nothing is made from its prompts, so it has none
      if (own(fill.shots, shot.id) !== undefined) add('fill-unknown', `shots.${shot.id}: the shot continues the clip of "${shot.continues}" and has no prompts of its own`);
      continue;
    }
    const prompts = entry(fill.shots, shot.id, `shots.${shot.id}`, add);
    if (prompts === undefined) continue;
    filled(prompts.motion_prompt, `shots.${shot.id}.motion_prompt`, add);
    if (speech && prompts.still_prompt !== undefined) add('fill-unknown', `shots.${shot.id}.still_prompt belongs to a beats fill: a talking clip starts from the presenter still`);
    else if (!speech && prompts.still_prompt === undefined) add('fill-missing', `the fill has no shots.${shot.id}.still_prompt`);
    else if (prompts.still_prompt !== undefined) filled(prompts.still_prompt, `shots.${shot.id}.still_prompt`, add);
  }
  known(fill.shots, template.shots.map((shot) => shot.id), 'shots', add);
  filled(fill.music.prompt, 'music.prompt', add);

  if (speech) {
    speechFill(template, fill, add);
  } else {
    stillsFill(template, fill, add);
    for (const key of ['script', 'presenter'] as const) {
      if (fill[key] !== undefined) add('fill-unknown', `"${key}" belongs to a speech fill; this template is not a speech template`);
    }
  }
  return { errors, notes: leftOut(template, fill) };
}

function speechFill(template: TemplateJson, fill: FillJson, add: Add): void {
  const prompt = fill.presenter?.still_prompt;
  if (prompt === undefined) add('fill-missing', 'the fill has no presenter.still_prompt');
  else filled(prompt, 'presenter.still_prompt', add);
  stillsFill(template, fill, add);

  const segments = template.script?.segments ?? [];
  known(fill.script, segments.map((segment) => segment.id), 'script', add);
  const spoken: { id: string; lines: string }[] = [];
  for (const { id } of segments) {
    const lines = entry(fill.script, id, `script.${id}`, add);
    if (lines === undefined) continue;
    filled(lines, `script.${id}`, add);
    spoken.push({ id, lines });
  }
  if (spoken.length < segments.length) return;              // marks are counted by segment position: without every segment there is nothing to compare
  const fillScript = parsed(spoken, add), templateScript = parsed(segments, add);
  if (fillScript === null || templateScript === null) return;
  for (const [name, place] of templateScript.marks) {
    if (fillScript.marks.get(name)?.segment !== place.segment) {
      add('mark-lost', `the script of segment "${segments[place.segment]!.id}" lost the mark [${name}]…[/${name}]: put it around the words that take the place of the template's`);
    }
  }
  const open = sharingWords(fillScript.marks, (template.windows ?? []).map((window) => window.mark));
  if (open) add('window-overlap', `the marks [${open[0]}] and [${open[1]}] share words, and each carries a window: only one window is open at a time`);
}

/** A prompt for every still of the template, in beats as in speech, and for no other. */
function stillsFill(template: TemplateJson, fill: FillJson, add: Add): void {
  for (const still of template.stills ?? []) {
    const made = entry(fill.stills, still.id, `stills.${still.id}`, add);
    if (made !== undefined) filled(made.prompt, `stills.${still.id}.prompt`, add);
  }
  known(fill.stills, (template.stills ?? []).map((still) => still.id), 'stills', add);
}

/** The cards and windows this customer will not see: their product, or that photograph of it, was not given. */
function leftOut(template: TemplateJson, fill: FillJson): FillNote[] {
  const note = (kind: FillNote['kind'], element: string, picture: string): FillNote => {
    const image = imageOf(picture);
    const what = image.kind === 'still' ? picture : image.photograph > 1 ? `photograph ${image.photograph} of product ${image.product}` : `product ${image.product}`;
    return { code: 'left-out', kind, element, picture, message: `the ${kind} ${kind === 'card' ? `"${element}"` : `on [${element}]`} shows ${what}, which was not given: it is left out of the video` };
  };
  return [
    ...(template.cards ?? []).filter((card) => !pictureGiven(card.image, fill)).map((card) => note('card', card.id, card.image)),
    ...(template.windows ?? []).filter((window) => !pictureGiven(window.behind, fill)).map((window) => note('window', window.mark, window.behind)),
  ];
}

/** The fill's entry for an id of the template; says so when there is none. */
function entry<T>(record: Record<string, T> | undefined, id: string, path: string, add: Add): T | undefined {
  const value = own(record, id);
  if (value === undefined) add('fill-missing', `the fill has no ${path}`);
  return value;
}

/** An entry for an id the template does not have is a mistake, most often a misspelt id. */
function known(record: Record<string, unknown> | undefined, ids: string[], path: string, add: Add): void {
  for (const id of Object.keys(record ?? {})) {
    if (!ids.includes(id)) add('fill-unknown', `${path}.${id}: the template has no "${id}"${ids.length > 0 ? ` (it has: ${ids.join(', ')})` : ''}`);
  }
}

function filled(text: string, path: string, add: Add): void {
  for (const name of placeholdersIn(text)) add(`unfilled:${name}`, `${path} still holds the placeholder {${name}}: write the final text`);
}

/** A text as it is compared with the reference's: NFKC, lower case, only letters and digits (so punctuation, emoji, quote marks, zero-width characters and spacing cannot dodge the check). */
const folded = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function parsed(segments: { id: string; lines: string }[], add: Add): Segments | null {
  try { return parseSegments(segments); } catch (error) {
    if (!(error instanceof ResolveError)) throw error;
    add(error.code, error.message);
    return null;
  }
}
