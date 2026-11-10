// Every rule of the edit document that needs no text fitting (design §6, §12). The issues are collected, at most 100:
// when there are more, the last entry says how many. A list longer than its limit (COUNTS) is refused before any rule runs.
// Each message says what is wrong with the numbers involved; each fix names the field to change and a value that works,
// for an agent that has nothing but that text.
import { endsGroup } from './groups.ts';
import { rectOf } from './geometry.ts';
import { musicPasses } from './music.ts';
import type { Pass } from './music.ts';
import {
  CANVASES, FPS, LIMITS, MOTION, MUSIC, WINDOW, buttonColumn, captionDefaults, cardMotion, lineHeightOf, meets, motionFrames, overlaps,
  maxWindowWidth, safeArea, stylesOf, tailOf, textMotion, transitionFrames, transitionOf, windowPictures,
} from './presets.ts';
import { MAX_FRAMES, PATTERNS, cut, parseEdit, issueList, tooLongIssue } from './schema.ts';
import type { Box, Captions, ComposeFacts, Edit, EditIssue, Enter, Exit, Motion, Shot, TextStyle } from './types.ts';

type Kind = 'video' | 'image' | 'audio';
interface Context {
  edit: Edit;
  facts: Record<string, ComposeFacts>;       // the well-formed entries of what was given (factsOf)
  noFacts: Set<string>;                      // media keys whose facts are an issue already
  passes: Pass[];                            // the passes of the music, once they could be laid out
  styles: Record<string, TextStyle>;
  add(code: string, path: string, message: string, fix: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A record's own entry: a key such as `constructor` is unknown, not a property every object has. */
function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}
/**
 * Facts as compose reads them: a whole frame count, whether there is sound, and for a picture (a video, an image) a size
 * that, when it is given, is a whole number of pixels above 0. A sound has no picture: a size given for it is not looked at.
 */
function wellFormed(facts: unknown, kind: Kind): facts is ComposeFacts {
  if (!isRecord(facts)) return false;
  const size = (value: unknown) => value === undefined || (kind === 'audio' ? typeof value === 'number' : Number.isInteger(value) && (value as number) > 0);
  return Number.isInteger(facts.frames) && (facts.frames as number) >= 0 && typeof facts.audio === 'boolean' && size(facts.width) && size(facts.height);
}
/**
 * The facts compose may rely on: the well-formed entry of every media key. Whatever else was passed (nothing at all, a
 * list, an entry that is null) is left out, so that no rule and no emitter reads something that is not facts.
 */
export function factsOf(edit: Edit, facts: unknown): Record<string, ComposeFacts> {
  const known: Record<string, ComposeFacts> = {};
  if (!isRecord(facts)) return known;
  for (const key of Object.keys(edit.media)) {
    const entry = Object.hasOwn(facts, key) ? facts[key] : undefined;
    if (wellFormed(entry, edit.media[key]!.kind)) known[key] = entry;
  }
  return known;
}
/** A value as an agent wrote it, short; never a throw (a value that JSON cannot write is named by its kind). */
function shown(value: unknown): string {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { text = undefined; }
  text ??= Object.prototype.toString.call(value);
  return cut(text);
}
/** Keys as a message lists them: the first 10, then how many more there are. */
const listed = (keys: string[]): string => cut(keys.length <= 10 ? keys.slice(0, 10).map((k) => cut(k)).join(', ') : `${keys.slice(0, 10).map((k) => cut(k)).join(', ')} and ${keys.length - 10} more`, 300);
const boxText = (box: Box): string => `{ left: ${box.left}, top: ${box.top}, right: ${box.right}, bottom: ${box.bottom} }`;
const a = (kind: Kind): string => (kind === 'video' ? 'a video' : kind === 'image' ? 'an image' : 'an audio file');
const secondsOf = (frames: number): string => `${Number((frames / FPS).toFixed(2))} s`;

// ── checks used in more than one place ──

/** A number inside its range, or an issue with a value that would do. True when it is inside. */
function within(ctx: Context, code: string, value: number, [min, max]: readonly [number, number], path: string, what: string): boolean {
  if (value >= min && value <= max) return true;
  const example = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  ctx.add(code, path, `${path} is ${value}; ${what} is a number from ${min} to ${max}`, `set ${path} to a value from ${min} to ${max}, for example ${example}`);
  return false;
}

/** A colour that matches its pattern, or an issue. True when it does. */
function colour(ctx: Context, value: string, path: string): boolean {
  if (PATTERNS.colour.test(value)) return true;
  ctx.add('style-value', path, `${path} is ${shown(value)}; a colour is written #rgb, #rrggbb or #rrggbbaa`, `write ${path} as a hex colour, for example "#ffffff"`);
  return false;
}

/** The media entry a field names, when it exists and is of an allowed kind. */
function mediaOf(ctx: Context, key: string, path: string, kinds: Kind[], need: string): Edit['media'][string] | undefined {
  const entry = own(ctx.edit.media, key);
  const keys = Object.keys(ctx.edit.media);
  if (!entry) {
    ctx.add('media-unknown', path, `${path} is "${cut(key)}", but "media" has no such key; it has: ${listed(keys) || '(nothing)'}`,
      `use one of those keys, or add "${cut(key)}" to "media" with its file and kind`);
    return undefined;
  }
  if (!kinds.includes(entry.kind)) {
    const other = keys.find((k) => kinds.includes(ctx.edit.media[k]!.kind));
    ctx.add('media-kind', path, `${path} is "${cut(key)}", ${a(entry.kind)} (${cut(entry.file)}); ${need}`,
      `point ${path} to ${kinds.map(a).join(' or ')} of "media"${other ? `, for example "${other}"` : ''}`);
    return undefined;
  }
  return entry;
}

function timeRange(ctx: Context, at: number, length: number, path: string): void {
  const frames = ctx.edit.frames;
  if (at + length <= frames) return;
  ctx.add('time-range', path, `${path} ends at frame ${at + length} (at ${at} + for ${length}), after the end of the video (frames: ${frames})`,
    at < frames ? `set ${path}.for to ${frames - at} or less, or move ${path}.at earlier` : `move ${path}.at before frame ${frames}`);
}

/**
 * The nearest box that lies inside the rectangle of the safe area and clear of the column of the buttons: the box is
 * moved, and cut only where the rectangle ends. Out of the column it goes the shorter way, to the left or up.
 */
function nearestSafe(box: Box, area: Box, column: Box): Box {
  const into = (low: number, high: number, min: number, max: number): [number, number] =>
    (high - low >= max - min ? [min, max] : low < min ? [min, min + (high - low)] : high > max ? [max - (high - low), max] : [low, high]);
  const [left, right] = into(box.left, box.right, area.left, area.right);
  const [top, bottom] = into(box.top, box.bottom, area.top, area.bottom);
  const inside = { left, top, right, bottom };
  if (!meets(inside, column)) return inside;
  const aside = { ...inside, left: Math.max(area.left, left - (right - column.left)), right: column.left };
  const above = { ...inside, top: Math.max(area.top, top - (bottom - column.top)), bottom: column.top };
  const moved = (to: Box) => Math.abs(to.left - left) + Math.abs(to.right - right) + Math.abs(to.top - top) + Math.abs(to.bottom - bottom);
  return moved(aside) <= moved(above) ? aside : above;
}

/**
 * A box inside the canvas, the right way round, at least 16 px, and (unless `free`) inside the safe area: the rectangle
 * minus the column of the buttons (§12.16). True when it is a box at all, whatever the safe area says.
 */
function boxCheck(ctx: Context, box: Box, path: string, owner: string, free: boolean): boolean {
  const { edit } = ctx;
  const text = boxText(box);
  if ([box.left, box.top, box.right, box.bottom].some((v) => !(v >= 0 && v <= 100))) {
    ctx.add('box-out-of-range', path, `${path} is ${text}; every value is a percentage of the canvas, from 0 to 100`, `keep left, top, right and bottom of ${path} between 0 and 100`);
    return false;
  }
  if (box.left >= box.right || box.top >= box.bottom) {
    ctx.add('box-out-of-range', path, `${path} is ${text}; right and bottom are edges, not sizes, so left < right and top < bottom`,
      `set right above left (${box.left}) and bottom above top (${box.top}), for example right ${Math.min(100, box.left + 40)} and bottom ${Math.min(100, box.top + 10)}`);
    return false;
  }
  const rect = rectOf(box, edit.canvas);
  if (rect.width < LIMITS.minBox || rect.height < LIMITS.minBox) {
    const share = (of: number) => Math.ceil((LIMITS.minBox / of) * 1000) / 10;
    ctx.add('box-out-of-range', path, `${path} is ${text}: ${rect.width} × ${rect.height} px on this canvas; a box is at least ${LIMITS.minBox} × ${LIMITS.minBox} px`,
      `make it larger: right − left ≥ ${share(edit.canvas.width)} and bottom − top ≥ ${share(edit.canvas.height)}`);
    return false;
  }
  if (free) return true;
  const area = safeArea(edit);
  const column = buttonColumn(edit);
  const leaves = [
    box.left < area.left ? `left ${box.left} < ${area.left}` : '', box.top < area.top ? `top ${box.top} < ${area.top}` : '',
    box.right > area.right ? `right ${box.right} > ${area.right}` : '', box.bottom > area.bottom ? `bottom ${box.bottom} > ${area.bottom}` : '',
  ].filter((part) => part !== '');
  const broken = [
    leaves.length > 0 ? `leaves the rectangle (${leaves.join(', ')})` : '',
    column && meets(box, column) ? `enters the column of the buttons (right ${box.right} > ${column.left} while bottom ${box.bottom} > ${column.top})` : '',
  ].filter((part) => part !== '');
  if (!column || broken.length === 0) return true;                // without a column there is no safe area: "safe": "none"
  const nearest = nearestSafe(box, area, column);
  const tidy = (value: number) => Number(value.toFixed(2));
  ctx.add('outside-safe-area', path,
    `${path} is ${text} and ${broken.join(' and ')}; the safe area of "safe": "${edit.safe ?? 'both'}" is the rectangle ${boxText(area)} without the column of the platform's buttons (x ${column.left} … ${column.right}, y ${column.top} … ${column.bottom}), in percent of the canvas`,
    `use ${boxText({ left: tidy(nearest.left), top: tidy(nearest.top), right: tidy(nearest.right), bottom: tidy(nearest.bottom) })}, the nearest box that fits, or add "safe": false to ${owner} if the platform's buttons may cover it`);
  return true;
}

function styleCheck(ctx: Context, name: string, path: string): void {
  if (own(ctx.styles, name)) return;
  ctx.add('style-unknown', path, `${path} is "${cut(name)}"; there is no such style. Available: ${listed(Object.keys(ctx.styles))}`,
    `use one of those names, or define "${cut(name)}" in "styles"`);
}

function placeholders(ctx: Context, text: string, path: string): void {
  for (const name of new Set([...text.matchAll(/\{([A-Za-z0-9_.:-]+)\}/g)].map((match) => match[1]!))) {
    ctx.add(`unfilled:${name}`, path, `${path} still contains the placeholder {${cut(name)}}`, `replace {${cut(name)}} in ${path} with the final words`);
  }
}

/** An element needs one frame on which it stands still between its enter and its exit. */
function restCheck(ctx: Context, enter: number, exit: number, length: number, path: string): void {
  if (enter + exit < length) return;
  ctx.add('animation-too-long', path, `${path} is on screen for ${length} frames, but its enter takes ${enter} and its exit ${exit}: no frame is left on which it stands still`,
    `lengthen ${path}.for to ${enter + exit + 1} or more, or shorten the animations (for example "enter": { "kind": "fade", "frames": 2 }), or switch one off with { "kind": "none" }`);
}

/** `inside`: the frames a punch-in may use; null where only push-in and pull-out are possible (cards, pictures behind a window). */
function motionCheck(ctx: Context, motion: Motion, path: string, inside: { at: number; end: number } | null): void {
  if (motion.kind === 'punch-in' && inside === null) {
    ctx.add('motion-range', `${path}.kind`, `${path} is a punch-in; only "push-in" and "pull-out" are possible here`, `use { "kind": "push-in" } or { "kind": "pull-out" } for ${path}`);
    return;
  }
  const [field, value] = motion.kind === 'pull-out' ? ['from', motion.from] as const : ['to', motion.to] as const;
  if (value !== undefined) within(ctx, 'motion-range', value, LIMITS.scale, `${path}.${field}`, 'the scale of a motion');
  if (motion.kind !== 'punch-in' || inside === null) return;
  const frames = motion.frames ?? MOTION.punchFrames;
  const last = inside.end - frames;
  if (motion.at >= inside.at && motion.at <= last) return;
  ctx.add('motion-range', `${path}.at`,
    `${path}.at is frame ${motion.at}; the punch-in takes ${frames} frames and must lie inside its shot (frames ${inside.at} … ${inside.end - 1}); "at" is a frame of the whole video, not of the shot`,
    last >= inside.at ? `set ${path}.at to a frame from ${inside.at} to ${last}` : `shorten ${path}.frames to ${inside.end - inside.at} or less`);
}

// ── the document, section by section ──

function documentCheck(ctx: Context): void {
  const { edit } = ctx;
  const { width, height, fps } = edit.canvas;
  if (!CANVASES.some((canvas) => canvas.width === width && canvas.height === height) || fps !== FPS) {
    ctx.add('canvas-unsupported', 'canvas', `canvas is ${width}×${height} at ${fps} fps; only 720×1280 and 1080×1920 at 30 fps are supported`,
      'set "canvas" to { "width": 1080, "height": 1920, "fps": 30 } or { "width": 720, "height": 1280, "fps": 30 }');
  }
  if (edit.frames > MAX_FRAMES) { const { code, path, message, fix } = tooLongIssue(edit.frames); ctx.add(code, path, message, fix); }
  if (edit.background !== undefined && colour(ctx, edit.background, 'background') && edit.background.length === 9) {
    ctx.add('style-value', 'background', `background is "${cut(edit.background)}", a colour with an alpha channel; the canvas must be opaque`,
      `write it without the alpha: "${edit.background.slice(0, 7)}"`);
  }
  try { Intl.getCanonicalLocales(edit.language); } catch {
    ctx.add('schema', 'language', `language is ${shown(edit.language)}; expected a language tag such as "en" or "tr"`, 'write the language as a BCP 47 tag, for example "en"');
  }
}

function mediaCheck(ctx: Context): void {
  for (const [key, entry] of Object.entries(ctx.edit.media)) {
    if (!PATTERNS.file.test(entry.file)) {
      const name = (entry.file.split(/[\\/]/).pop() ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'file';
      ctx.add('media-file', `media.${cut(key)}.file`,
        `media.${cut(key)}.file is ${shown(entry.file)}; a file lies directly in assets/, and its name starts with a letter, a digit, "_" or "-" and goes on with those or "." (^assets/[A-Za-z0-9_-][A-Za-z0-9._-]*$)`,
        `put the file into the composition's assets folder and write "assets/${cut(name)}"`);
    }
  }
}

/** The facts are checked like the document: what is missing or is not facts is an issue (§12.14), never a foreign throw. */
function factsCheck(ctx: Context, given: unknown): void {
  const all = isRecord(given) ? given : {};
  for (const [key, entry] of Object.entries(ctx.edit.media)) {
    if (own(ctx.facts, key) !== undefined) continue;
    const entryGiven = Object.hasOwn(all, key) ? all[key] : undefined;
    if (entryGiven === undefined && entry.kind === 'image') continue;       // a picture needs facts only where its size is asked for (media-size-unknown)
    ctx.noFacts.add(key);
    ctx.add('media-facts', `media.${cut(key)}`,
      entryGiven === undefined ? `no facts were given for media "${cut(key)}" (${cut(entry.file)}); compose needs the frame count of every video and audio file`
        : `the facts of media "${cut(key)}" (${cut(entry.file)}) are ${shown(entryGiven)}; expected { frames: a whole number from 0 on, audio: true or false } and, for a picture, its width and height, each a whole number of pixels above 0`,
      `probe ${cut(entry.file)} and pass { frames, audio, width, height } to compose under the key "${cut(key)}"`);
  }
}

function stylesCheck(ctx: Context): void {
  for (const [name, style] of Object.entries(ctx.edit.styles ?? {})) {
    const path = `styles.${cut(name)}`;
    within(ctx, 'style-value', style.weight, [100, 900], `${path}.weight`, 'a font weight');
    if (!Number.isInteger(style.size) || style.size < 8 || style.size > 400) {
      const example = Number.isFinite(style.size) ? Math.min(400, Math.max(8, Math.round(style.size))) : 48;
      ctx.add('style-value', `${path}.size`, `${path}.size is ${style.size}; a font size is a whole number of pixels from 8 to 400`, `set ${path}.size to ${example}`);
    }
    colour(ctx, style.fill, `${path}.fill`);
    style.shadows.forEach((shadow, i) => {
      if (PATTERNS.shadow.test(shadow)) return;
      ctx.add('style-value', `${path}.shadows[${i}]`, `${path}.shadows[${i}] is ${shown(shadow)}; a shadow is "<x>px <y>px <blur>px <#hex colour>"`,
        `write it like "0px 4px 14px #00000080"`);
    });
    if (style.tracking !== undefined) within(ctx, 'style-value', style.tracking, [-0.05, 0.3], `${path}.tracking`, 'letter spacing (in em)');
    if (style.leading !== undefined) within(ctx, 'style-value', style.leading, [1, 2], `${path}.leading`, 'a line height (a multiple of the size)');
    if (style.outline) {
      within(ctx, 'style-value', style.outline.width, [0.02, 0.12], `${path}.outline.width`, 'an outline width (in em)');
      colour(ctx, style.outline.colour, `${path}.outline.colour`);
    }
    if (style.plate) {
      colour(ctx, style.plate.colour, `${path}.plate.colour`);
      for (const field of ['radius', 'padX', 'padY'] as const) within(ctx, 'style-value', style.plate[field], [0, 1], `${path}.plate.${field}`, `a plate's ${field} (in em)`);
    }
  }
}

const RESERVED = /^(?:root|overlays|cap-\d+(?:-w\d+)?|music-\d+)$/;

/**
 * Ids become HTML ids, and compose derives further ids from them: no two elements of the composition may share one.
 * Every id an item has or makes is tested against the names compose keeps for itself and against every id an earlier
 * item has or makes; an item gets one issue.
 */
function idsCheck(ctx: Context): void {
  const { edit } = ctx;
  const items: { path: string; id: string; makes: string[] }[] = [
    ...edit.shots.map((shot, i) => ({
      path: `shots[${i}]`, id: shot.id,
      makes: [`${shot.id}-v`, `${shot.id}-fx`, `${shot.id}-sound`, ...(shot.windows ?? []).flatMap((window, k) => [
        `${shot.id}-b${k + 1}`, `${shot.id}-b${k + 1}-v`, ...(window.swaps ?? []).map((_, j) => `${shot.id}-b${k + 1}-s${j + 1}`),
      ])],
    })),
    ...(edit.texts ?? []).map((text, i) => ({ path: `texts[${i}]`, id: text.id, makes: [1, 2, 3, 4].map((line) => `${text.id}-${line}`) })),
    ...(edit.cards ?? []).map((card, i) => ({ path: `cards[${i}]`, id: card.id, makes: [`${card.id}-box`] })),
    ...(edit.audio?.sounds ?? []).map((sound, i) => ({ path: `audio.sounds[${i}]`, id: sound.id, makes: [] })),
  ];
  const makes = 'a shot makes <id>-v, <id>-fx, <id>-sound, <id>-b1 …, <id>-b1-s1 …; a text <id>-1 … <id>-4; a card <id>-box';
  const taken = new Map<string, { path: string; own: boolean }>();
  for (const item of items) {
    const path = `${item.path}.id`;
    const all = [item.id, ...item.makes];
    const clash = all.find((id) => RESERVED.test(id) || taken.has(id));
    if (clash !== undefined) {
      const mine = clash === item.id ? `${path} is "${cut(item.id)}"` : `${path} is "${cut(item.id)}", from which compose makes the element "${cut(clash)}"`;
      const other = taken.get(clash);
      if (clash === item.id && other?.own) {
        ctx.add('id-duplicate', path, `the id "${cut(item.id)}" is used by ${other.path} and by ${item.path}; every shot, text, card and sound needs its own id (ids become HTML ids)`,
          `rename one of them, for example ${path} to "${cut(item.id)}-2"`);
      } else if (RESERVED.test(clash)) {
        ctx.add('id-duplicate', path, `${mine}, a name compose gives to its own elements (root, overlays, cap-1 … for the caption groups, music-1 … for the music)`,
          `rename ${path}, for example to "my-${cut(item.id)}"`);
      } else {
        ctx.add('id-duplicate', path, `${mine}, which is also the id of ${other!.own ? other!.path : `an element compose makes for ${other!.path}`} (${makes})`,
          `rename ${path} to a name that is not another id plus such an ending, for example "${cut(item.id)}-x"`);
      }
    }
    for (const id of all) if (!taken.has(id)) taken.set(id, { path: item.path, own: id === item.id });
  }
}

function clipCheck(ctx: Context, shot: Shot, i: number): void {
  const { edit } = ctx;
  const clip = own(ctx.facts, shot.media);
  if (!clip) return;
  const path = `shots[${i}]`;
  const from = shot.from ?? 0;
  const tail = tailOf(edit.shots, i);
  const need = from + shot.for + tail;
  if (need <= clip.frames) return;
  const next = edit.shots[i + 1];
  const why = tail > 0 && next ? `; the tail of ${tail} frames is the ${transitionOf(next).kind} of shots[${i + 1}], during which this shot stays on screen` : '';
  const room = clip.frames - shot.for - tail;
  const first = room >= 0 ? `lower ${path}.from to ${room} or less` : `shorten ${path}.for to ${Math.max(1, clip.frames - tail)} or less and set ${path}.from to 0`;
  const other = tail > 0 ? `, or shorten shots[${i + 1}].in.frames, or use a transition without a tail there ("cut", "zoom", "flash", "dip")` : '';
  ctx.add('clip-short', path,
    `${path} needs ${need} frames of "${cut(shot.media)}" (from ${from} + for ${shot.for}${tail > 0 ? ` + tail ${tail}` : ''}), but the clip has ${clip.frames}${why}`,
    `${first}${other}, or use a longer clip`);
}

function windowsCheck(ctx: Context, shot: Shot, i: number): void {
  const { edit } = ctx;
  const windows = shot.windows ?? [];
  if (windows.length === 0) return;
  const path = `shots[${i}]`;
  const shotEnd = shot.at + shot.for;
  const incoming = transitionOf(shot);
  const lead = i > 0 && overlaps(incoming) ? transitionFrames(incoming) : 0;
  windows.forEach((window, k) => {
    const wp = `${path}.windows[${k}]`;
    const move = window.frames ?? WINDOW.frames;
    const end = window.at + window.for;
    const before = windows.slice(0, k).findIndex((other) => window.at < other.at + other.for && other.at < end);
    const later = windows.slice(0, k).findIndex((other) => other.at > window.at);
    if (window.at < shot.at || end > shotEnd) {
      ctx.add('window-range', wp, `${wp} covers frames ${window.at} … ${end - 1}, outside its shot (frames ${shot.at} … ${shotEnd - 1}); a window's "at" is a frame of the whole video`,
        `keep it inside the shot: "at" ≥ ${shot.at + lead} and "at" + "for" ≤ ${shotEnd}`);
    } else if (window.for < 2 * move + 1) {
      const shorter = Math.floor((window.for - 1) / 2);
      ctx.add('window-range', wp, `${wp} lasts ${window.for} frames, but shrinking and returning take ${move} frames each: it needs at least ${2 * move + 1}`,
        `set ${wp}.for to ${2 * move + 1} or more${shorter >= 1 ? `, or lower ${wp}.frames to ${shorter}` : ''}`);
    } else if (before >= 0) {
      const other = windows[before]!;
      ctx.add('window-range', wp, `${wp} (frames ${window.at} … ${end - 1}) overlaps ${path}.windows[${before}] (frames ${other.at} … ${other.at + other.for - 1})`,
        `start ${wp} at frame ${other.at + other.for} or later`);
    } else if (later >= 0) {
      // the animations of a shot are written in the order of its windows, and the later one of a list wins on every frame after it
      ctx.add('window-range', wp, `${wp} starts at frame ${window.at}, before ${path}.windows[${later}] (frame ${windows[later]!.at}); the windows of a shot are in ascending order of their frames`,
        `put the windows in the order of their frames: move ${wp} before ${path}.windows[${later}]`);
    } else if (window.at < shot.at + lead) {
      ctx.add('window-range', `${wp}.at`,
        `${wp} starts at frame ${window.at}, while the ${incoming.kind} that brings ${path} in is still running (frames ${shot.at} … ${shot.at + lead - 1}); the picture behind the window would hide the outgoing shot`,
        `set ${wp}.at to ${shot.at + lead} or later`);
    }
    const widest = maxWindowWidth(edit);
    if ((window.width ?? WINDOW.width) > widest) {
      ctx.add('window-range', `${wp}.width`,
        `${wp}.width is ${window.width}; a window keeps the canvas's ratio, so it is as high in percent of the height as it is wide, and the safe area ("${edit.safe ?? 'both'}") is ${safeArea(edit).bottom - safeArea(edit).top} % high: a window that wide leaves it, under the top bar or the caption and description of the platform`,
        `set ${wp}.width to ${widest} or less${widest < maxWindowWidth({ ...edit, safe: 'tiktok' }) ? `, or set "safe" to "tiktok" (a window up to ${maxWindowWidth({ ...edit, safe: 'tiktok' })} wide)` : ''}`);
    }
    const place = (w: typeof window) => `${w.corner} ${w.width ?? WINDOW.width} ${w.radius ?? WINDOW.radius}`;
    if (place(window) !== place(windows[0]!)) {
      ctx.add('window-range', wp, `${wp} rests at another place than ${path}.windows[0] (corner, width or radius differ); the windows of one shot share one place`,
        `give ${wp} the corner, width and radius of ${path}.windows[0], or split the shot in two with a cut and give each part its own window`);
    }
    // the picture behind changes only while the window rests: after the shrink has ended, before the return starts
    const [restAt, restEnd] = [window.at + move, end - move];
    (window.swaps ?? []).forEach((swap, j) => {
      const sp = `${wp}.swaps[${j}]`;
      const previous = window.swaps![j - 1];
      if (window.for >= 2 * move + 1 && (swap.at < restAt || swap.at >= restEnd)) {
        ctx.add('window-range', `${sp}.at`, `${sp}.at is frame ${swap.at}; the picture behind a window changes only while the window rests (frames ${restAt} … ${restEnd - 1}: after the shrink, before the return)`,
          `set ${sp}.at to a frame from ${restAt} to ${restEnd - 1}`);
      } else if (previous && swap.at <= previous.at) {
        ctx.add('window-range', `${sp}.at`, `${sp}.at is frame ${swap.at}, not after ${wp}.swaps[${j - 1}].at (frame ${previous.at}); swaps are in ascending order, each on a frame of its own`,
          `set ${sp}.at to ${previous.at + 1} or later, or put the swaps in the order of their frames`);
      }
    });
    windowPictures(window).forEach((picture, j) => {
      const pp = j === 0 ? wp : `${wp}.swaps[${j - 1}]`;
      const behind = mediaOf(ctx, picture.behind, `${pp}.behind`, ['image', 'video'], 'the picture behind a window is an image or a video');
      const clip = own(ctx.facts, picture.behind);
      if (behind?.kind === 'video' && clip && picture.for > clip.frames) {
        ctx.add('clip-short', pp, `the video behind ${wp} is shown for ${picture.for} frames from its first frame (frames ${picture.at} … ${picture.at + picture.for - 1} of the video), but "${cut(picture.behind)}" has ${clip.frames}`,
          `use a clip of at least ${picture.for} frames or an image there, or show it for ${clip.frames} frames or less (shorten the window or add a swap)`);
      }
    });
    if (window.behindMotion) motionCheck(ctx, window.behindMotion, `${wp}.behindMotion`, null);
  });
  // A zoom scales a wrapper around its centre, a window around its corner: one wrapper cannot do both (design §5.3).
  const zooms = [[i, 'comes in'], [i + 1, 'leaves']] as const;
  for (const [at, verb] of zooms) {
    const other = edit.shots[at];
    if (at === 0 || !other || transitionOf(other).kind !== 'zoom') continue;
    ctx.add('window-range', `shots[${at}].in.kind`,
      `${path} has windows and ${verb} by a zoom; a zoom scales a shot around its centre, a window around its corner, and one shot cannot do both`,
      `use another transition for shots[${at}].in ("cut", "crossfade", "push", "whip", "flash", "dip"), or move the window to another shot`);
  }
}

function shotsCheck(ctx: Context): void {
  const { edit } = ctx;
  let expected = 0;
  edit.shots.forEach((shot, i) => {
    const path = `shots[${i}]`;
    const previous = edit.shots[i - 1];
    if (shot.at !== expected) {
      ctx.add('shots-gap', `${path}.at`,
        previous ? `${path} starts at frame ${shot.at}, but shots[${i - 1}] ends at frame ${expected} (at ${previous.at} + for ${previous.for}); shots follow each other without a gap or an overlap`
          : `the first shot starts at frame ${shot.at}; the shots tile the video from frame 0`,
        `set ${path}.at to ${expected} (a transition never changes "at")`);
    }
    expected = shot.at + shot.for;
    const most = LIMITS.shotSeconds * FPS;
    if (shot.for > most) {
      ctx.add('shot-too-long', `${path}.for`, `${path}.for is ${shot.for} frames (${secondsOf(shot.for)}); a shot is at most ${most} frames (${LIMITS.shotSeconds} s)`,
        `split it into shots of at most ${most} frames each`);
    }
    const media = mediaOf(ctx, shot.media, `${path}.media`, ['video', 'image'], 'a shot shows a video or an image');
    if (media?.kind === 'image' && shot.from !== undefined) {
      ctx.add('schema', `${path}.from`, `${path}.from is ${shot.from}, but ${path} shows the image "${cut(shot.media)}"; only a video has source frames to start from`, `remove ${path}.from`);
    }

    const transition = transitionOf(shot);
    if (!previous) {
      if (transition.kind !== 'cut') ctx.add('transition-first', `${path}.in`, `the first shot has the transition "${transition.kind}", but no shot comes before it`, `remove ${path}.in`);
    } else if (transition.kind !== 'cut') {
      const frames = transitionFrames(transition);
      const most2 = Math.floor(Math.min(previous.for, shot.for) / 2);
      if (frames > most2) {
        ctx.add('transition-too-long', transition.frames === undefined ? `${path}.in` : `${path}.in.frames`,
          `the ${transition.kind} of ${path} takes ${frames} frames, more than half of the shorter shot it joins (shots[${i - 1}]: ${previous.for} frames, ${path}: ${shot.for} frames)`,
          most2 >= 1 ? `set ${path}.in.frames to ${most2} or less` : `use { "kind": "cut" } for ${path}.in: these shots are too short for a transition`);
      }
      if (transition.kind === 'zoom' && transition.scale !== undefined) within(ctx, 'motion-range', transition.scale, LIMITS.scale, `${path}.in.scale`, 'the scale of a zoom');
      if ((transition.kind === 'flash' || transition.kind === 'dip') && transition.colour !== undefined) colour(ctx, transition.colour, `${path}.in.colour`);
    }

    if (shot.motion) motionCheck(ctx, shot.motion, `${path}.motion`, { at: shot.at, end: shot.at + shot.for });
    if (shot.sound) {
      within(ctx, 'gain-range', shot.sound.gain, LIMITS.gain, `${path}.sound.gain`, 'a gain');
      const clip = own(ctx.facts, shot.media);
      if (media?.kind === 'image') {
        ctx.add('media-kind', `${path}.sound`, `${path} asks for its clip's own sound, but "${cut(shot.media)}" is an image`, `remove ${path}.sound`);
      } else if (media && clip && !clip.audio) {
        ctx.add('media-kind', `${path}.sound`, `${path} asks for its clip's own sound, but the clip "${cut(shot.media)}" (${cut(media.file)}) has no sound stream`,
          `remove ${path}.sound, or use a clip that has sound`);
      }
    }
    if (media?.kind === 'video') clipCheck(ctx, shot, i);
    windowsCheck(ctx, shot, i);
  });
  if (expected !== edit.frames) ctx.add('shots-gap', 'frames', `the last shot ends at frame ${expected}, but "frames" is ${edit.frames}`, `set "frames" to ${expected}`);
}

function textsCheck(ctx: Context): void {
  (ctx.edit.texts ?? []).forEach((text, i) => {
    const path = `texts[${i}]`;
    boxCheck(ctx, text.box, `${path}.box`, path, text.safe === false);
    timeRange(ctx, text.at, text.for, path);
    styleCheck(ctx, text.style, `${path}.style`);
    if (text.copy.trim() === '') ctx.add('text-empty', `${path}.copy`, `${path}.copy has no words`, `write the words to show into ${path}.copy, or remove ${path}`);
    else placeholders(ctx, text.copy, `${path}.copy`);
    const motion = textMotion(text, ctx.edit.styles);
    restCheck(ctx, motionFrames(motion.enter), motionFrames(motion.exit), text.for, path);
  });
}

function captionsCheck(ctx: Context): void {
  const captions = ctx.edit.captions;
  if (!captions) return;
  const { style, active } = captionDefaults(captions);
  const isBox = boxCheck(ctx, captions.box, 'captions.box', 'captions', captions.safe === false);
  styleCheck(ctx, style, 'captions.style');
  const known = own(ctx.styles, style);
  const height = rectOf(captions.box, ctx.edit.canvas).height;
  if (isBox && known && height < lineHeightOf(known)) {
    const share = Math.ceil((lineHeightOf(known) / ctx.edit.canvas.height) * 1000) / 10;
    ctx.add('box-out-of-range', 'captions.box', `captions.box is ${height} px high on this canvas, but one line of the style "${cut(style)}" (${known.size} px) is ${lineHeightOf(known)} px high`,
      `make captions.box taller: bottom − top ≥ ${share} for one line, ${Number((share * 2).toFixed(1))} for two`);
  }
  if (active.kind !== 'none') colour(ctx, active.colour, 'captions.active.colour');
  if (active.kind === 'pill' && active.text !== undefined) colour(ctx, active.text, 'captions.active.text');
  captions.words.forEach((word, i) => {
    const path = `captions.words[${i}]`;
    timeRange(ctx, word.at, word.for, path);
    placeholders(ctx, word.text, `${path}.text`);
    const previous = captions.words[i - 1];
    if (!previous || word.at >= previous.at + previous.for) return;
    const end = previous.at + previous.for;
    ctx.add('words-order', path,
      `${path} ("${cut(word.text)}", frames ${word.at} … ${word.at + word.for - 1}) starts before captions.words[${i - 1}] ("${cut(previous.text)}", frames ${previous.at} … ${end - 1}) has ended; caption words follow each other without overlapping`,
      `set ${path}.at to ${end} or later${word.at > previous.at ? `, or shorten captions.words[${i - 1}].for to ${word.at - previous.at}` : ''}`);
  });
}

function cardsCheck(ctx: Context): void {
  (ctx.edit.cards ?? []).forEach((card, i) => {
    const path = `cards[${i}]`;
    boxCheck(ctx, card.box, `${path}.box`, path, card.safe === false);
    timeRange(ctx, card.at, card.for, path);
    const media = mediaOf(ctx, card.media, `${path}.media`, ['image'], 'a card shows an image');
    const size = own(ctx.facts, card.media);
    if (media && !ctx.noFacts.has(card.media) && (card.fit ?? 'contain') === 'contain' && (size?.width === undefined || size.height === undefined)) {
      ctx.add('media-size-unknown', path, `${path} shows the whole picture "${cut(card.media)}" (fit "contain"), but the facts of ${cut(media.file)} give no width and height in pixels`,
        `pass the picture's width and height in the facts of "${cut(card.media)}" ({ frames: 0, audio: false, width, height }), or set "fit": "cover" on ${path} (fills the box and crops the picture)`);
    }
    const motion = cardMotion(card);
    restCheck(ctx, motionFrames(motion.enter), motionFrames(motion.exit), card.for, path);
    if (card.motion) motionCheck(ctx, card.motion, `${path}.motion`, null);
  });
}

function musicCheck(ctx: Context): void {
  const { edit } = ctx;
  const music = edit.audio?.music;
  if (!music) return;
  const path = 'audio.music';
  const entry = mediaOf(ctx, music.media, `${path}.media`, ['audio'], 'music is an audio file');
  const gainOk = within(ctx, 'gain-range', music.gain, LIMITS.gain, `${path}.gain`, 'a gain');
  const duck = music.duck;
  if (duck) {
    const top = gainOk ? music.gain : LIMITS.gain[1];
    if (!(duck.to >= 0 && duck.to <= top)) {
      ctx.add('gain-range', `${path}.duck.to`, `${path}.duck.to is ${duck.to}; the ducked gain lies between 0 and the music's own gain (${top})`,
        `set ${path}.duck.to to a value from 0 to ${top}, for example ${Number((top * 0.4).toFixed(2))}`);
    }
    if (Array.isArray(duck.under)) duck.under.forEach((range, i) => timeRange(ctx, range.at, range.for, `${path}.duck.under[${i}]`));
  }
  const fadeIn = music.fadeIn ?? MUSIC.fadeIn;
  const fadeOut = music.fadeOut ?? MUSIC.fadeOut;
  if (fadeIn + fadeOut > edit.frames) {
    ctx.add('time-range', `${path}.fadeOut`, `the fades of the music take ${fadeIn} + ${fadeOut} frames, the video has ${edit.frames}`,
      `shorten ${path}.fadeIn and ${path}.fadeOut so that together they take at most ${edit.frames} frames`);
  }
  const file = own(ctx.facts, music.media);
  if (!entry || !file) return;
  const from = music.from ?? 0;
  const have = Math.max(0, file.frames - from);
  const offset = from > 0 ? ` from frame ${from} on` : '';
  if (!music.loop && have < edit.frames) {
    ctx.add('music-short', path, `the music "${cut(music.media)}" has ${have} frames${offset} (${secondsOf(have)}), the video has ${edit.frames} (${secondsOf(edit.frames)})`,
      `use a music file of at least ${edit.frames + from} frames${from > 0 ? `, or lower ${path}.from` : ''}, or add "loop": true to ${path}`);
    return;
  }
  if (have < edit.frames && have < LIMITS.loopFrames) {
    ctx.add('music-short', path, `the music "${cut(music.media)}" is too short to loop: it has ${have} frames${offset}, and a file that is looped has at least ${LIMITS.loopFrames} (every pass is an element of its own)`,
      `use a music file of at least ${LIMITS.loopFrames + from} frames${from > 0 ? `, or lower ${path}.from` : ''}`);
    return;
  }
  if (edit.frames > MAX_FRAMES) return;                    // too-long: the passes of such a video are not laid out
  const passes = musicPasses(edit, file.frames);
  ctx.passes = passes;
  const dense = passes.findIndex((pass) => pass.points.length > LIMITS.lanePoints);
  if (dense >= 0) {
    ctx.add('duck-too-dense', `${path}.duck`, `pass ${dense + 1} of the music would carry ${passes[dense]!.points.length} volume points; a volume lane holds at most ${LIMITS.lanePoints}`,
      `use fewer ducking ranges (merge neighbouring ones, or lengthen ${path}.duck.ramp), or "under": "sound"`);
  }
}

/** The frames a sound plays: what it says, else the rest of its file; null when the file is not known. */
function soundLength(ctx: Context, sound: NonNullable<NonNullable<Edit['audio']>['sounds']>[number]): number | null {
  const file = own(ctx.facts, sound.media);
  return sound.for ?? (file ? file.frames - (sound.from ?? 0) : null);
}

function soundsCheck(ctx: Context): void {
  (ctx.edit.audio?.sounds ?? []).forEach((sound, i) => {
    const path = `audio.sounds[${i}]`;
    const entry = mediaOf(ctx, sound.media, `${path}.media`, ['audio'], 'a sound is an audio file');
    within(ctx, 'gain-range', sound.gain, LIMITS.gain, `${path}.gain`, 'a gain');
    const file = own(ctx.facts, sound.media);
    const from = sound.from ?? 0;
    const length = soundLength(ctx, sound);
    if (entry && file && (length === null || length < 1 || from + length > file.frames)) {
      ctx.add('clip-short', path, `${path} plays ${sound.for ?? 'the rest'} of "${sound.media}" from frame ${from}, but the file has ${file.frames} frames`,
        `lower ${path}.from${sound.for === undefined ? '' : ` or ${path}.for`} so that from + for is at most ${file.frames}`);
    } else if (length !== null) timeRange(ctx, sound.at, length, path);
  });
}

function audioCheck(ctx: Context): void {
  const master = ctx.edit.audio?.master;
  if (master) {
    within(ctx, 'gain-range', master.lufs, [-40, -5], 'audio.master.lufs', 'a loudness target (LUFS)');
    if (master.peak !== undefined) within(ctx, 'gain-range', master.peak, [-20, 0], 'audio.master.peak', 'a peak limit (dBTP)');
  }
  musicCheck(ctx);
  soundsCheck(ctx);
}

/** The lines a copy has at least: those it forces, whatever the fit does with them. */
const forcedLines = (copy: string): number => Math.max(1, copy.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '').length);

/**
 * The caption groups that carry a blur whatever the fit does. A group gets an enter only when it lasts two frames or
 * more, and a group that holds a word of two frames lasts that long however the fit cuts the groups (design §5.5).
 */
function blurredGroups(captions: Captions): number {
  const rule = captionDefaults(captions);
  let groups = 0;
  let open = 0;
  let long = false;
  captions.words.forEach((word, i) => {
    const last = captions.words[i - 1];
    if (last && endsGroup(open, { text: last.text, end: last.at + last.for }, word, rule)) { groups += long ? 1 : 0; open = 0; long = false; }
    open++;
    long ||= word.for >= 2;
  });
  return groups + (long ? 1 : 0);
}

/**
 * More than 24 elements that carry a blur (§12.14): shots that come or go by a whip, text lines and cards that blur in
 * or out, caption groups whose enter is a blur. `lines`: the lines of each text; `groups`: the caption groups that get an
 * enter (those of two frames or more). validate passes what a document has at least; compose asks again with what the
 * fit made. The path is the first element over the limit.
 */
export function blurIssue(edit: Edit, lines: number[], groups: number): EditIssue | null {
  const field = (enter: Enter, exit: Exit) => (enter.kind === 'blur' ? 'enter' : exit.kind === 'blur' ? 'exit' : null);
  const whip = (i: number) => i > 0 && edit.shots[i]?.in?.kind === 'whip';
  const blurred: { path: string; count: number; kind: 'shots' | 'overlays' | 'captions' }[] = [];
  edit.shots.forEach((_, i) => { if (whip(i) || whip(i + 1)) blurred.push({ path: `shots[${whip(i) ? i : i + 1}].in`, count: 1, kind: 'shots' }); });
  (edit.texts ?? []).forEach((text, i) => {
    const motion = textMotion(text, edit.styles);
    const which = field(motion.enter, motion.exit);
    if (which) blurred.push({ path: `texts[${i}].${which}`, count: lines[i] ?? 1, kind: 'overlays' });
  });
  if (edit.captions && groups > 0 && captionDefaults(edit.captions).enter.kind === 'blur') blurred.push({ path: 'captions.enter', count: groups, kind: 'captions' });
  (edit.cards ?? []).forEach((card, i) => {
    const motion = cardMotion(card);
    const which = field(motion.enter, motion.exit);
    if (which) blurred.push({ path: `cards[${i}].${which}`, count: 1, kind: 'overlays' });
  });
  const sum = (kind: string) => blurred.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.count, 0);
  let total = 0;
  const first = blurred.find((entry) => (total += entry.count) > LIMITS.blurred);
  if (!first) return null;
  return {
    code: 'blur-too-many', path: first.path,
    message: `${sum('shots') + sum('overlays') + sum('captions')} elements would carry a blur (${sum('shots')} shots with a whip, ${sum('overlays')} text lines and cards that blur in or out, ${sum('captions')} caption groups); the renderer captures black frames when there are too many, so at most ${LIMITS.blurred} are allowed, and ${first.path} is the first over that limit`,
    fix: first.kind === 'captions' ? 'use another enter for the captions, for example { "kind": "pop", "frames": 5, "from": 0.8 }'
      : first.kind === 'shots' ? 'replace some "whip" transitions by "push" (the same move without the blur)' : 'use "fade" or "slide" instead of "blur" for some texts and cards',
  };
}

function blurCheck(ctx: Context): void {
  const { edit } = ctx;
  const issue = blurIssue(edit, (edit.texts ?? []).map((text) => forcedLines(text.copy)), edit.captions ? blurredGroups(edit.captions) : 0);
  if (issue) ctx.add(issue.code, issue.path, issue.message, issue.fix);
}

/**
 * The renderer and the linter take two media elements with the same tag, file, start and length for one. Every <video>,
 * <img> and <audio> a document makes is compared: shots, the pictures behind windows, cards; the music, a clip's own
 * sound, the effects. The later one of a pair gets the issue: `card-duplicate` for a picture, `sound-duplicate` for a sound.
 */
const PICTURE: Kind[] = ['video', 'image'];
function duplicatesCheck(ctx: Context): void {
  const { edit } = ctx;
  const seen = new Map<string, string>();
  const first = new Map<string, string>();       // the first media key of each file: files are compared once, here, and never again per element
  for (const [key, entry] of Object.entries(edit.media)) if (!first.has(entry.file)) first.set(entry.file, key);
  const element = (sound: boolean, kinds: Kind[], key: string, at: number, length: number | null, path: string, what: string): void => {
    const entry = own(edit.media, key);
    if (!entry || length === null || !kinds.includes(entry.kind)) return;             // media of the wrong kind has its issue (media-kind)
    const print = `${sound ? 'audio' : entry.kind} ${first.get(entry.file)} ${at} ${length}`;
    const earlier = seen.get(print);
    if (earlier === undefined) { seen.set(print, what); return; }
    ctx.add(sound ? 'sound-duplicate' : 'card-duplicate', path,
      `${what} and ${earlier} ${sound ? 'play' : 'show'} the same file (${cut(entry.file)}) on the same frames (at ${at}, for ${length}); the renderer takes two such elements for one`,
      sound ? 'move one of them by a frame, or keep one and raise its gain' : 'change "at" or "for" of one of them by a frame, or remove one of them');
  };
  edit.shots.forEach((shot, i) => {
    const path = `shots[${i}]`;
    element(false, PICTURE, shot.media, shot.at, shot.for + tailOf(edit.shots, i), path, `${path} ("${shot.id}")`);
    (shot.windows ?? []).forEach((window, k) => windowPictures(window).forEach((picture, j) => {
      const pp = j === 0 ? `${path}.windows[${k}]` : `${path}.windows[${k}].swaps[${j - 1}]`;
      element(false, PICTURE, picture.behind, picture.at, picture.for, pp, `the picture behind ${pp}`);
    }));
  });
  (edit.cards ?? []).forEach((card, i) => element(false, ['image'], card.media, card.at, card.for, `cards[${i}]`, `cards[${i}] ("${cut(card.id)}")`));
  const music = edit.audio?.music;
  if (music) for (const pass of ctx.passes) element(true, ['audio'], music.media, pass.at, pass.for, 'audio.music', 'audio.music');
  edit.shots.forEach((shot, i) => { if (shot.sound) element(true, ['video'], shot.media, shot.at, shot.for + tailOf(edit.shots, i), `shots[${i}].sound`, `shots[${i}].sound`); });
  (edit.audio?.sounds ?? []).forEach((sound, i) => element(true, ['audio'], sound.media, sound.at, soundLength(ctx, sound), `audio.sounds[${i}]`, `audio.sounds[${i}] ("${cut(sound.id)}")`));
}

/**
 * Every issue of a document whose shape is right (parseEdit), in the order of the document. At most 100 entries: beyond
 * that the issues are counted, not kept, and the last entry says how many are not listed. A list of the document that
 * is longer than its limit is the only thing reported (`too-many`): no rule walks such a document. Whatever `facts` is,
 * it never throws.
 */
export function validate(edit: Edit, facts: Record<string, ComposeFacts>): EditIssue[] {
  const shape = parseEdit(edit);       // the shape every rule below relies on: a document that was not parsed first gets issues, not a foreign throw
  if (!shape.ok && !shape.issues.every((issue) => issue.code === 'too-long')) return shape.issues;       // a video that is too long has its rules below: they say more than `too-long`
  return validateParsed(edit, facts);
}

/** The rules of `validate` for a document that `parseEdit` has accepted: compose has parsed it already and does not parse it again. Never throws. */
export function validateParsed(edit: Edit, facts: Record<string, ComposeFacts>): EditIssue[] {
  const issues = issueList();
  const ctx: Context = {
    edit, facts: factsOf(edit, facts), noFacts: new Set(), passes: [], styles: stylesOf(edit),
    add: (code, path, message, fix) => { issues.add({ code, path, message, fix }); },
  };
  const factsGiven = (c: Context) => factsCheck(c, facts);
  for (const check of [documentCheck, mediaCheck, factsGiven, stylesCheck, idsCheck, shotsCheck, textsCheck, captionsCheck, cardsCheck, blurCheck, audioCheck, duplicatesCheck]) check(ctx);
  return issues.list();
}
