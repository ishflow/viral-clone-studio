// The machine check on what the model wrote: nothing of the reference may stand in a template outside `source_copy`, and a
// {placeholder} stands only where a fill replaces it. Pure; it never throws.
//
// The limit that stays: a name is known only when the score step listed it (a `#tag` counts when it matches a listed name),
// when the title or the speech carries it as an `@handle`, or when it is the creator in the reference's address. A brand that
// none of these names can pass; a template of the catalog is published by a person, who is the last check.
import type { Word } from '../ports.ts';
import { cardOf } from '../template/card.ts';
import type { TemplateJson } from '../template/schema.ts';
import { placeholdersIn } from '../template/values.ts';

/** This many words in a row, the same as in the reference, are a copy. */
export const COPIED_RUN_WORDS = 6;
/** A name whose folded form has this many characters is refused wherever it stands, also inside a longer word; a shorter one only as a word of its own. */
export const NAME_SUBSTRING_MIN = 5;
/** A copy may not contain its own source_copy when that has this many folded characters (a shorter one must not be the whole copy). */
export const COPY_CONTAINS_MIN = 12;
/** `sample_text` may not hold this many folded characters in a row of what is said in the reference. */
export const SAMPLE_RUN_CHARS = 20;

/** What is known of the reference: the names to keep out, what is said in it, its title. */
export interface ReferenceText { names: string[]; spoken: string; title: string }
/**
 * `name`: the field holds a name of the reference · `copied`: it repeats the reference's words · `copy-is-source`: a copy is,
 * or contains, its own source_copy · `placeholder`: a {placeholder} in a field that is shown or sent as it is.
 */
export interface Finding { path: string; kind: 'name' | 'copied' | 'copy-is-source' | 'placeholder' }

const unaccented = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFKC').toLowerCase();
/** A text as it is compared: NFKC, lower case, accents off, letters and digits only. */
export const fold = (text: string): string => unaccented(text).replace(/[^\p{L}\p{N}]/gu, '');
const wordsOf = (text: string): string[] => unaccented(text).match(/[\p{L}\p{N}]+/gu) ?? [];
const runsOf = (words: string[]): string[] =>
  Array.from({ length: Math.max(0, words.length - COPIED_RUN_WORDS + 1) }, (_, i) => words.slice(i, i + COPIED_RUN_WORDS).join(' '));
/** A pattern without its placeholders: `{benefit}` is not the word "benefit". */
const bare = (text: string): string => placeholdersIn(text).reduce((rest, name) => rest.replaceAll(`{${name}}`, ' '), text);

/** The `#tags` and `@handles` of a text, without their sign. */
export function namesIn(text: string, sign = '#@'): string[] {
  return [...text.matchAll(new RegExp(`[${sign}]([\\p{L}\\p{N}_.]+)`, 'gu'))].map((match) => match[1]!.replace(/\.+$/, '')).filter((name) => name !== '');
}

const tagsIn = (text: string): string[] => namesIn(text, '#');

/**
 * The names to keep out of a template: the ones the score step found, every `@handle` of the title and of the speech, the creator of the address,
 * and a `#tag` only when it equals, contains or is contained in a name the score step found (most titles carry generic tags: `#skincare`, `#fyp`).
 */
export function referenceOf(look: { title: string; words: Word[]; url: string }, brands: string[]): ReferenceText {
  const spoken = look.words.map((word) => word.text).join(' ');
  const creator = /\/@([^/?#]+)/.exec(look.url)?.[1];
  const listed = brands.map(fold).filter((brand) => brand.length >= 2);
  const tags = [...tagsIn(look.title), ...tagsIn(spoken)].filter((tag) => { const folded = fold(tag); return folded.length >= 2 && listed.some((brand) => folded.includes(brand) || brand.includes(folded)); });
  return { names: [...new Set([...brands, ...tags, ...namesIn(look.title, '@'), ...namesIn(spoken, '@'), ...(creator === undefined ? [] : [creator])])], spoken, title: look.title };
}

/**
 * The fields a fill replaces placeholders in (docs/reference/template-format.md §1 and §4): a text's `copy`, a shot's
 * `still_prompt` and `motion_prompt`, the music prompt, the lines of a script segment, the presenter's `still_prompt`, a
 * still's `prompt`. Everything else is shown on the site or sent to a provider as it is written.
 */
const PATTERNS = [/^texts\.\d+\.copy$/, /^shots\.\d+\.(?:still_prompt|motion_prompt)$/, /^audio\.music\.prompt$/, /^script\.segments\.\d+\.lines$/, /^presenter\.still_prompt$/, /^stills\.\d+\.prompt$/];
export const takesPlaceholders = (path: string): boolean => PATTERNS.some((pattern) => pattern.test(path));

interface Field { path: string; text: string }
/**
 * Keys whose values the format fixes (a word of a closed list, a colour, a picture reference, the voice the prompt names, what the card computes):
 * nothing of a reference can be written there, and a tag of the reference that happens to be such a word (`#face`, `#pop`)
 * must not make the field a finding the model cannot repair.
 */
const FIXED = new Set(['mode', 'people', 'kind', 'to', 'from', 'corner', 'font', 'align', 'ease', 'under', 'safe', 'fill', 'colour', 'shadows', 'image', 'behind', 'references', 'products', 'voice_id', 'format', 'referenceViews']);
/** Every text of a value with its path (`shots.1.still_prompt`), except what stands under `source_copy`. The names of the styles are texts of the template too (`styles`). */
function textsOf(value: unknown, path: string, found: Field[]): void {
  if (typeof value === 'string') found.push({ path, text: value });
  else if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'source_copy' || FIXED.has(key)) continue;
      if (path === '' && key === 'styles') for (const name of Object.keys(inner as object)) found.push({ path: 'styles', text: name });
      textsOf(inner, path === '' ? key : `${path}.${key}`, found);
    }
  }
}
/**
 * The fields that are checked: every text the model is free to write, and whatever the card shows beyond them. Not checked:
 * `source_copy` (the reference's own words belong there), `source` and the template's `id` (the handler writes both: the
 * reference's address and our own id), and the FIXED keys.
 */
function fieldsOf(template: TemplateJson): Field[] {
  const { source: _source, id: _id, ...checked } = template;
  const fields: Field[] = [];
  textsOf(checked, '', fields);
  const seen = new Set(fields.map((field) => field.text));
  const card: Field[] = [];
  textsOf(cardOf(template, { image: null, video: null }), 'card', card);
  return [...fields, ...card.filter((field) => !seen.has(field.text))];
}

/** The fields that hold a {placeholder} no fill will ever replace. */
export function misplacedPlaceholders(template: TemplateJson): Finding[] {
  return fieldsOf(template).filter((field) => !takesPlaceholders(field.path) && placeholdersIn(field.text).length > 0).map((field): Finding => ({ path: field.path, kind: 'placeholder' }));
}

/** What a template may not be published with; empty when it is clean. One finding per field, in the template's order. */
export function refusalsOf(template: TemplateJson, reference: ReferenceText): Finding[] {
  const names = [...new Set(reference.names.map(fold))].filter((name) => name.length >= 2);
  const named = (text: string): boolean => {
    const folded = fold(text);
    const tokens = unaccented(text).split(/\s+/).map(fold);
    return names.some((name) => (name.length >= NAME_SUBSTRING_MIN ? folded.includes(name) : tokens.some((token) => token === name || token === `${name}s`)));
  };
  const copied = new Set([reference.spoken, reference.title, ...template.texts.map((text) => text.source_copy)].flatMap((text) => runsOf(wordsOf(text))));
  const same = new Set(template.texts.flatMap((text, i) => {
    const source = fold(text.source_copy), copy = fold(bare(text.copy));
    return source !== '' && (copy === source || (source.length >= COPY_CONTAINS_MIN && copy.includes(source))) ? [`texts.${i}.copy`] : [];
  }));
  const spoken = fold(reference.spoken);
  const sampled = (text: string): boolean => {
    const sample = fold(text);
    for (let i = 0; i + SAMPLE_RUN_CHARS <= sample.length; i++) if (spoken.includes(sample.slice(i, i + SAMPLE_RUN_CHARS))) return true;
    return false;
  };

  return fieldsOf(template).flatMap(({ path, text }): Finding[] => {
    const written = bare(text);
    if (named(written)) return [{ path, kind: 'name' }];
    if (!takesPlaceholders(path) && placeholdersIn(text).length > 0) return [{ path, kind: 'placeholder' }];
    if (same.has(path)) return [{ path, kind: 'copy-is-source' }];
    if (path === 'presenter.voice.sample_text' && sampled(text)) return [{ path, kind: 'copied' }];
    return runsOf(wordsOf(written)).some((run) => copied.has(run)) ? [{ path, kind: 'copied' }] : [];
  });
}
