// The edit document as zod strict objects (design §3): the shape, the whole numbers, the names and the simple bounds.
// What needs the whole document (frames that must line up, media, safe areas, styles) is in validate.ts.
import { z } from 'zod';
import { COUNTS, FPS, LIMITS, STRINGS } from './presets.ts';
import type { Edit, EditIssue } from './types.ts';

/** The patterns a text must match before it may reach the composition (design §5.9). */
export const PATTERNS = {
  id: /^[a-z][a-z0-9-]{0,31}$/,
  colour: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
  file: /^assets\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/,     // a name never starts with a dot: not the folder, not its parent, no hidden file
  shadow: /^-?\d+(\.\d+)?px -?\d+(\.\d+)?px \d+(\.\d+)?px #(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
  language: /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/,
  word: /^\S+$/u,
};
/** A list of issues has at most this many entries; when there are more, its last entry says how many are not listed. */
export const MAX_ISSUES = 100;
/** The code of that last entry. */
export const MORE_ISSUES = 'more-issues';
/** The most frames a video has: 60 s at the canvas rate. Nothing walks the frames of a longer one. */
export const MAX_FRAMES = LIMITS.seconds * FPS;

const frame = z.number().int().min(0);
const frames = z.number().int().min(1);
const id = z.string().max(STRINGS.id).regex(PATTERNS.id);
const colour = z.string().max(STRINGS.colour);                              // the pattern is checked in validate (`style-value`)
const side = z.enum(['left', 'right', 'top', 'bottom']);
const ease = z.enum(['linear', 'out', 'in', 'in-out', 'back', 'whip']);
const percent = z.number().min(0).max(100);
const box = z.strictObject({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });   // the range is `box-out-of-range`

const motion = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('push-in'), to: z.number().optional(), ease: ease.optional() }),
  z.strictObject({ kind: z.literal('pull-out'), from: z.number().optional(), ease: ease.optional() }),
  z.strictObject({ kind: z.literal('punch-in'), at: frame, to: z.number().optional(), frames: frames.optional() }),
]);
const transition = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cut') }),
  z.strictObject({ kind: z.literal('crossfade'), frames: frames.optional() }),
  z.strictObject({ kind: z.literal('push'), to: side, frames: frames.optional() }),
  z.strictObject({ kind: z.literal('whip'), to: side, frames: frames.optional() }),
  z.strictObject({ kind: z.literal('zoom'), frames: frames.optional(), scale: z.number().optional() }),
  z.strictObject({ kind: z.literal('flash'), frames: frames.optional(), colour: colour.optional() }),
  z.strictObject({ kind: z.literal('dip'), frames: frames.optional(), colour: colour.optional() }),
]);
const window = z.strictObject({
  at: frame, for: frames,
  corner: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
  width: z.number().min(20).max(60).optional(),
  radius: z.number().min(0).max(8).optional(),
  frames: frames.optional(),
  behind: id,
  swaps: z.array(z.strictObject({ at: frame, behind: id })).optional(),
  behindMotion: motion.optional(),
});
const shot = z.strictObject({
  id, at: frame, for: frames, media: id,
  from: frame.optional(),
  focus: z.tuple([percent, percent]).optional(),
  motion: motion.optional(),
  in: transition.optional(),
  sound: z.strictObject({ gain: z.number() }).optional(),
  windows: z.array(window).optional(),
});

const textStyle = z.strictObject({
  font: z.enum(['Inter', 'Montserrat']),
  weight: z.number(), size: z.number(),
  align: z.enum(['left', 'center', 'right']),
  fill: colour,
  shadows: z.array(z.string().max(STRINGS.shadow)),
  upper: z.boolean().optional(),
  tracking: z.number().optional(),
  leading: z.number().optional(),
  outline: z.strictObject({ width: z.number(), colour }).optional(),
  plate: z.strictObject({ colour, radius: z.number(), padX: z.number(), padY: z.number() }).optional(),
});
const scale = z.number().min(0).max(2);
const enter = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('fade'), frames: frames.optional() }),
  z.strictObject({ kind: z.literal('pop'), frames: frames.optional(), from: scale.optional() }),
  z.strictObject({ kind: z.literal('slide'), from: side, frames: frames.optional(), distance: percent.optional() }),
  z.strictObject({ kind: z.literal('blur'), frames: frames.optional(), radius: z.number().min(0).max(10).optional() }),
]);
const exit = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('fade'), frames: frames.optional() }),
  z.strictObject({ kind: z.literal('pop'), frames: frames.optional(), to: scale.optional() }),
  z.strictObject({ kind: z.literal('slide'), to: side, frames: frames.optional(), distance: percent.optional() }),
  z.strictObject({ kind: z.literal('blur'), frames: frames.optional(), radius: z.number().min(0).max(10).optional() }),
]);
const text = z.strictObject({
  id, at: frame, for: frames, box,
  style: z.string().max(STRINGS.id),
  copy: z.string().max(STRINGS.copy),                            // an empty copy is `text-empty`
  lines: z.number().int().min(1).max(4).optional(),
  shrink: z.number().min(0.5).max(1).optional(),
  valign: z.enum(['top', 'middle', 'bottom']).optional(),
  enter: enter.optional(), exit: exit.optional(),
  stagger: z.number().int().min(0).max(6).optional(),
  safe: z.literal(false).optional(),
});
const captions = z.strictObject({
  box,
  style: z.string().max(STRINGS.id).optional(),
  words: z.array(z.strictObject({ text: z.string().max(STRINGS.word).regex(PATTERNS.word), at: frame, for: frames })),
  group: z.strictObject({
    words: z.number().int().min(1).max(4).optional(),
    lines: z.literal([1, 2]).optional(),
    hold: z.number().int().min(0).optional(),
    pause: frames.optional(),
  }).optional(),
  active: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('none') }),
    z.strictObject({ kind: z.literal('colour'), colour, scale: z.number().min(1).max(1.5).optional() }),
    z.strictObject({ kind: z.literal('pill'), colour, text: colour.optional() }),
  ]).optional(),
  enter: enter.optional(),
  safe: z.literal(false).optional(),
});
const card = z.strictObject({
  id, at: frame, for: frames, media: id, box,
  fit: z.enum(['contain', 'cover']).optional(),
  radius: z.number().min(0).max(50).optional(),
  enter: enter.optional(), exit: exit.optional(),
  motion: motion.optional(),
  safe: z.literal(false).optional(),
});
const audio = z.strictObject({
  music: z.strictObject({
    media: id, gain: z.number(),
    from: frame.optional(),
    loop: z.boolean().optional(),
    fadeIn: z.number().int().min(0).optional(), fadeOut: z.number().int().min(0).optional(),
    duck: z.strictObject({
      to: z.number(),
      ramp: frames.optional(),
      under: z.union([z.literal('sound'), z.literal('captions'), z.array(z.strictObject({ at: frame, for: frames }))]),
    }).optional(),
  }).optional(),
  sounds: z.array(z.strictObject({ id, media: id, at: frame, for: frames.optional(), from: frame.optional(), gain: z.number() })).optional(),
  master: z.union([z.strictObject({ lufs: z.number(), peak: z.number().optional() }), z.literal(false)]).optional(),
});

export const EditSchema = z.strictObject({
  version: z.literal(1),
  language: z.string().max(STRINGS.language).regex(PATTERNS.language),
  canvas: z.strictObject({ width: z.literal([720, 1080]), height: z.literal([1280, 1920]), fps: z.literal(30) }),
  frames: frames.max(MAX_FRAMES),
  background: colour.optional(),
  safe: z.enum(['tiktok', 'reels', 'both', 'none']).optional(),
  media: z.record(id, z.strictObject({ file: z.string().max(STRINGS.file), kind: z.enum(['video', 'image', 'audio']) })),
  styles: z.record(id, textStyle).optional(),
  shots: z.array(shot).min(1),
  texts: z.array(text).optional(),
  captions: captions.optional(),
  cards: z.array(card).optional(),
  audio: audio.optional(),
});

// The schema and the frozen types say the same thing: this line stops compiling when they drift apart.
// (Identity, not mutual assignability: an optional field missing on one side is a difference too.)
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const sameAsTypes: Same<z.infer<typeof EditSchema>, Edit> = true;
void sameAsTypes;

// ── a zod failure as issues an agent can act on ──

type ZodIssue = z.core.$ZodIssue;

/** A value of the document quoted into a message or a fix: at most `max` characters, then "…". The one place that cuts. */
export function cut(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** `shots[2].in.frames`; a key that is not a plain name is written `media["a b"]`. */
export function pathOf(parts: readonly PropertyKey[]): string {
  let text = '';
  for (const part of parts) {
    const name = typeof part === 'number' ? '' : cut(String(part));      // a key of the document is cut: the key of a record has no limit until it is checked
    if (typeof part === 'number') text += `[${part}]`;
    else if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) text += text === '' ? name : `.${name}`;
    else text += `[${JSON.stringify(name)}]`;
  }
  return text === '' ? '(the document)' : text;
}

function valueAt(json: unknown, path: readonly PropertyKey[]): unknown {
  let value = json;
  for (const part of path) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<PropertyKey, unknown>)[part];
  }
  return value;
}

function show(value: unknown): string {
  if (value === undefined) return 'missing';
  if (typeof value === 'number') return String(value);                       // NaN and Infinity have no JSON form
  const text = Array.isArray(value) ? `a list of ${value.length}` : typeof value === 'object' && value !== null ? 'an object' : JSON.stringify(typeof value === 'string' ? cut(value) : value);
  return cut(text ?? String(value));
}

/** A name that matches the id pattern and resembles what was written. */
function nameLike(value: unknown): string {
  const slug = cut(String(value), 200).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 32);
  return slug === '' ? 'item-1' : slug;
}

/** The schema that checks the value at `path`, without its optional wrapper; a union gives the option the value picks. */
function schemaAt(json: unknown, path: readonly PropertyKey[]): z.ZodType | null {
  let schema: z.ZodType | null = EditSchema;
  for (let i = 0; i <= path.length && schema; i++) {
    const value = valueAt(json, path.slice(0, i));
    while (schema instanceof z.ZodOptional) schema = schema.unwrap() as z.ZodType;
    if (schema instanceof z.ZodUnion) {
      const options = schema.options as z.ZodType[];
      const kind = typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
      schema = options.find((o) => o instanceof z.ZodObject && (o.shape.kind instanceof z.ZodLiteral ? o.shape.kind.values.has(kind as never) : !Array.isArray(value)))
        ?? options.find((o) => o instanceof z.ZodArray && Array.isArray(value)) ?? null;
    }
    if (i === path.length || !schema) break;
    const part = path[i]!;
    if (schema instanceof z.ZodObject) schema = (schema.shape[String(part)] as z.ZodType | undefined) ?? null;
    else if (schema instanceof z.ZodArray) schema = schema.element as z.ZodType;
    else if (schema instanceof z.ZodRecord) schema = schema.valueType as z.ZodType;
    else if (schema instanceof z.ZodTuple) schema = (schema.def.items[Number(part)] as z.ZodType | undefined) ?? null;
    else schema = null;
  }
  return schema;
}

const EXPECTED: Record<string, string> = {
  int: 'a whole number', number: 'a number', string: 'a string', boolean: 'true or false', object: 'an object { … }', array: 'a list [ … ]',
};
const PATTERN_HELP: [RegExp, string, (value: unknown) => string][] = [
  [PATTERNS.id, 'a name of 1 to 32 characters: a lower-case letter, then lower-case letters, digits or "-"', (v) => `rename it, for example to "${nameLike(v)}", here and wherever it is referred to`],
  [PATTERNS.language, 'a language tag such as "en" or "tr"', () => 'write the language as a BCP 47 tag, for example "en"'],
  [PATTERNS.word, 'one word without spaces, at most 60 characters', () => 'give every caption word its own entry in "words", with its own "at" and "for"'],
];
const UNION_HELP: Record<string, string> = {
  under: '"sound", "captions" or a list of { "at": frame, "for": frames }',
  master: '{ "lufs": -14, "peak": -1 } or false',
};

/** `message` continues the path: 'is 7.5; expected a whole number'. */
function schemaIssue(path: readonly PropertyKey[], message: string, fix: string): EditIssue {
  return { code: 'schema', path: pathOf(path), message: `${pathOf(path)} ${message}`, fix };
}

/** One fault zod found, as issues. Exported for its test only. */
export function issuesOf(issue: ZodIssue, json: unknown, base: readonly PropertyKey[]): EditIssue[] {
  const path = [...base, ...issue.path];
  const value = valueAt(json, path);
  const last = path.at(-1);
  const name = typeof last === 'number' || last === undefined ? 'this value' : `"${cut(String(last))}"`;
  switch (issue.code) {
    case 'unrecognized_keys': {
      const here = schemaAt(json, path);
      const known = here instanceof z.ZodObject ? Object.keys(here.shape).join(', ') : '';
      // an object can have any number of unknown keys: as many as a list holds are written out, parseEdit counts the others
      return issue.keys.slice(0, MAX_ISSUES).map((key) => schemaIssue([...path, key], 'is an unknown field (unknown fields are errors, not ignored)',
        `remove "${cut(key)}"${known ? `; the fields allowed here are: ${known}` : ''}`));
    }
    case 'invalid_type': {
      const expected = EXPECTED[issue.expected] ?? issue.expected;
      if (value === undefined) return [schemaIssue(path, `is missing; expected ${expected}`, `add ${name} with ${expected}`)];
      const whole = issue.expected === 'int' && typeof value === 'number' && Number.isFinite(value);
      return [schemaIssue(path, `is ${show(value)}; expected ${expected}`, whole ? `frames and counts are whole numbers: use ${Math.round(value)}` : `write ${name} as ${expected}`)];
    }
    case 'too_small': case 'too_big': {
      const small = issue.code === 'too_small';
      const limit = small ? issue.minimum : issue.maximum;
      const unit = issue.origin === 'array' ? ' entries' : issue.origin === 'string' ? ' characters' : '';
      const got = issue.origin === 'array' && Array.isArray(value) ? `has ${value.length} entries` : issue.origin === 'string' && typeof value === 'string' ? `has ${value.length > 10_000 ? value.length : [...value].length} characters` : `is ${show(value)}`;
      return [schemaIssue(path, `${got}; expected at ${small ? 'least' : 'most'} ${String(limit)}${unit}`, `change ${name} to ${small ? `${String(limit)} or more` : `${String(limit)} or less`}${unit}`)];
    }
    case 'invalid_value': {
      const options = issue.values.map((v) => JSON.stringify(v)).join(', ');
      return [schemaIssue(path, `is ${show(value)}; expected ${issue.values.length > 1 ? 'one of ' : ''}${options}`, `set ${name} to ${issue.values.length > 1 ? 'one of ' : ''}${options}`)];
    }
    case 'invalid_format': {
      const help = PATTERN_HELP.find(([pattern]) => 'pattern' in issue && issue.pattern === String(pattern));
      return [schemaIssue(path, `is ${show(value)}; expected ${help ? help[1] : issue.message}`, help ? help[2](value) : `change ${name} so that it matches`)];
    }
    case 'invalid_key':
      return [schemaIssue(path, `is not a valid key; expected ${PATTERN_HELP[0]![1]}`, PATTERN_HELP[0]![2](last))];
    case 'invalid_union': {
      if ('discriminator' in issue && issue.discriminator !== undefined) {
        const options = ('options' in issue && Array.isArray(issue.options) ? issue.options : []).map((o) => JSON.stringify(o)).join(', ');
        return [schemaIssue(path, `is ${show(value)}; expected one of ${options}`, `set ${name} to one of ${options}`)];
      }
      const inside = issue.errors.filter((group) => group.some((sub) => sub.path.length > 0));     // the form the value has, wrong further in
      if (inside.length === 1) return inside[0]!.flatMap((sub) => issuesOf(sub, json, path));
      const forms = UNION_HELP[String(last)] ?? 'one of the forms the field allows';
      return [schemaIssue(path, `is ${show(value)}; expected ${forms}`, `write ${name} as ${forms}`)];
    }
    default:      // a check without a text of its own here: what zod expected is the only thing known about it
      return [schemaIssue(path, `is ${show(value)}; expected: ${issue.message}`, `change ${name} so that this holds: ${issue.message}`)];
  }
}

/** A video longer than 60 s has its own code, from the schema and from validate alike. */
export function tooLongIssue(frames: number): EditIssue {
  return {
    code: 'too-long', path: 'frames',
    message: `frames is ${frames} (${Number((frames / FPS).toFixed(2))} s); a video is at most ${MAX_FRAMES} frames (${LIMITS.seconds} s)`,
    fix: `remove or shorten shots until the last one ends at frame ${MAX_FRAMES} or earlier, and set "frames" to that end`,
  };
}

/** An unsupported number in `canvas` is its own code; a wrong type or an unknown key there stays `schema`. */
function canvasIssue(json: unknown): EditIssue {
  const canvas = valueAt(json, ['canvas']) as { width?: unknown; height?: unknown; fps?: unknown };
  return {
    code: 'canvas-unsupported', path: 'canvas',
    message: `canvas is ${show(canvas.width)}×${show(canvas.height)} at ${show(canvas.fps)} fps; only 720×1280 and 1080×1920 at 30 fps are supported`,
    fix: 'set "canvas" to { "width": 1080, "height": 1920, "fps": 30 } or { "width": 720, "height": 1280, "fps": 30 }',
  };
}

/** A list that is no longer than MAX_ISSUES: the first 99 and, in the last place, the count of the others (`uncounted`: issues that were never written out). */
export function capped(issues: EditIssue[], uncounted = 0): EditIssue[] {
  if (uncounted === 0 && issues.length <= MAX_ISSUES) return issues;
  const more = issues.length - (MAX_ISSUES - 1) + uncounted;
  return [...issues.slice(0, MAX_ISSUES - 1), {
    code: MORE_ISSUES, path: pathOf([]),
    message: `${more} more issues were found and are not listed: a list holds at most ${MAX_ISSUES} entries`,
    fix: 'correct the issues listed above and check the document again: the others are listed then',
  }];
}

/** Collects issues without ever holding more than MAX_ISSUES of them: beyond that it only counts. */
export function issueList(): { add(issue: EditIssue): void; skip(count: number): void; list(): EditIssue[] } {
  const kept: EditIssue[] = [];
  let uncounted = 0;
  return {
    add(issue) { if (kept.length < MAX_ISSUES) kept.push(issue); else uncounted++; },
    skip(count) { uncounted += count; },
    list: () => capped(kept, uncounted),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `too-many` for every list of a document that is longer than its limit (COUNTS). Only lengths are read, and the entries
 * of a list that is too long are not looked at: whoever gets an issue from here walks nothing of the document.
 */
export function countIssues(json: unknown): EditIssue[] {
  const issues = issueList();
  const at = (value: unknown, key: string): unknown => (isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined);
  const each = (value: unknown, visit: (entry: unknown, i: number) => void): void => { if (Array.isArray(value)) value.forEach(visit); };
  /** True when the list is short enough to be walked. `most`: 'a document has at most 120 shots'. */
  const fits = (value: unknown, path: string, limit: number, most: string, otherwise: string): boolean => {
    const count = Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : 0;
    if (count <= limit) return true;
    issues.add({ code: 'too-many', path, message: `${path} has ${count} entries; ${most}`, fix: `remove ${count - limit} of them${otherwise}` });
    return false;
  };
  const split = ', or split the video into several documents';
  fits(at(json, 'media'), 'media', COUNTS.media, `a document has at most ${COUNTS.media} media keys`, ' (the keys nothing uses first)');
  const styles = at(json, 'styles');
  if (fits(styles, 'styles', COUNTS.styles, `a document has at most ${COUNTS.styles} styles of its own`, ' (the styles no text uses first)') && isRecord(styles)) {
    for (const [name, style] of Object.entries(styles)) fits(at(style, 'shadows'), pathOf(['styles', name, 'shadows']), COUNTS['styles.<name>.shadows'], `a style has at most ${COUNTS['styles.<name>.shadows']} shadows`, '');
  }
  const shots = at(json, 'shots');
  if (fits(shots, 'shots', COUNTS.shots, `a document has at most ${COUNTS.shots} shots`, split)) {
    each(shots, (shot, i) => {
      const windows = at(shot, 'windows');
      if (!fits(windows, `shots[${i}].windows`, COUNTS['shots[].windows'], `a shot has at most ${COUNTS['shots[].windows']} windows`, ', or split the shot in two with a cut')) return;
      each(windows, (window, k) => fits(at(window, 'swaps'), `shots[${i}].windows[${k}].swaps`, COUNTS['shots[].windows[].swaps'], `a window has at most ${COUNTS['shots[].windows[].swaps']} swaps`, ', or go on in a second window'));
    });
  }
  fits(at(json, 'texts'), 'texts', COUNTS.texts, `a document has at most ${COUNTS.texts} texts`, split);
  fits(at(at(json, 'captions'), 'words'), 'captions.words', COUNTS['captions.words'], `a document has at most ${COUNTS['captions.words']} caption words`, split);
  fits(at(json, 'cards'), 'cards', COUNTS.cards, `a document has at most ${COUNTS.cards} cards`, split);
  const audio = at(json, 'audio');
  fits(at(audio, 'sounds'), 'audio.sounds', COUNTS['audio.sounds'], `a document has at most ${COUNTS['audio.sounds']} sounds`, split);
  fits(at(at(at(audio, 'music'), 'duck'), 'under'), 'audio.music.duck.under', COUNTS['audio.music.duck.under'], `the music has at most ${COUNTS['audio.music.duck.under']} ducking ranges`,
    ', merge ranges that lie close together, or write "under": "captions" or "sound"');
  return issues.list();
}

/**
 * Checks the shape of a document. Never throws: whatever is given, the answer is an edit or a list of issues.
 * A list that is too long is refused first, and nothing else is looked at then.
 */
export function parseEdit(json: unknown): { ok: true; edit: Edit } | { ok: false; issues: EditIssue[] } {
  const counts = countIssues(json);
  if (counts.length > 0) return { ok: false, issues: counts };
  const parsed = EditSchema.safeParse(json);
  if (parsed.success) return { ok: true, edit: parsed.data };
  const issues = issueList();
  let canvas = false;
  let tooLong = false;
  const tooBig = new Set<string>();       // a string over its length is one issue: its pattern is not said as well
  for (const issue of parsed.error.issues) {
    if (issue.code === 'too_big' && issue.origin === 'string') tooBig.add(pathOf(issue.path));
    else if (issue.code === 'invalid_format' && tooBig.has(pathOf(issue.path))) continue;
    const wrongNumber = issue.path[0] === 'canvas' && issue.code === 'invalid_value' && typeof valueAt(json, issue.path) === 'number';
    if (issue.code === 'too_big' && issue.path.length === 1 && issue.path[0] === 'frames') {
      if (!tooLong) issues.add(tooLongIssue(valueAt(json, issue.path) as number));         // a number that is no safe integer breaks two bounds
      tooLong = true;
    } else if (wrongNumber) {
      if (!canvas) issues.add(canvasIssue(json));
      canvas = true;
    } else {
      const found = issuesOf(issue, json, []);
      for (const one of found) issues.add(one);
      if (issue.code === 'unrecognized_keys') issues.skip(issue.keys.length - found.length);
    }
  }
  return { ok: false, issues: issues.list() };
}
