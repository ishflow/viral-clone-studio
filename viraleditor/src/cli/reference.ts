// The field reference of the edit document, generated: the fields with their types and ranges come from the schema the
// editor checks with (edit/schema.ts, read through its JSON Schema), the limits of the lists and most defaults from
// edit/presets.ts, and one line per field from notes.ts. `viraleditor schema` prints it; docs/reference/edit-format.md
// holds its markdown form, and a test fails when that file is stale or a field has no line.
import { z } from 'zod';
import { CANVASES, COUNTS, EASINGS, FPS, LIMITS, buttonColumn, cssEase, safeArea, stylesOf, textMotion } from '../edit/presets.ts';
import { EditSchema, PATTERNS } from '../edit/schema.ts';
import type { Edit, EditText, Enter, Exit } from '../edit/types.ts';
import { DEFAULTS, NOTES, SHAPE_NOTES } from './notes.ts';

/** The part of a JSON Schema the edit schema uses. */
interface Node {
  type?: string; const?: unknown; enum?: unknown[];
  properties?: Record<string, Node>; required?: string[]; additionalProperties?: Node | false;
  items?: Node; prefixItems?: Node[]; minItems?: number;
  oneOf?: Node[]; anyOf?: Node[];
  minimum?: number; maximum?: number; maxLength?: number; pattern?: string;
}

export interface Field {
  path: string;          // 'shots[].from' · a form of a union: 'Motion{push-in}' · a field of that form: 'Motion{push-in}.to'
  type: string;
  default: string;       // 'required' · the value used when the field is absent · 'none': absent means not there · '': a form, which has none
  note: string;
}
export interface Section { title: string; about: string; fields: Field[] }
export interface Reference {
  version: 1;
  reading: string[];                 // how to read a path, a frame, a percentage, a name, a colour
  sections: Section[];               // the document, then each of its parts, then the shapes used in several places
  styles: { name: string; font: string; weight: number; size1080: number; size720: number; fill: string; outline: string; plate: string; other: string; enter: string; exit: string }[];
  safeAreas: { safe: string; area: string; buttons: string }[];
  easings: { name: string; css: string }[];
  limits: { what: string; limit: string }[];
}

/** The shapes several fields share, each named after its type in edit/types.ts and found at the first field that has it. */
const SHAPES = { Box: 'texts[].box', Motion: 'shots[].motion', Transition: 'shots[].in', Enter: 'texts[].enter', Exit: 'texts[].exit' } as const;
/** How the key of a record is written in a path. */
const KEY: Record<string, string> = { media: '<key>', styles: '<name>' };
/** What a string holds, where the schema knows only its length (its pattern is a rule of validate.ts). First match. */
const STRINGS: [RegExp, string][] = [
  [/(colour|fill|background|\{pill\}\.text)$/, 'colour'],
  [/\.file$/, 'file name'],
  [/shadows\[\]$/, 'shadow'],
  [/style$/, 'style name'],
  [/copy$/, 'text'],
];
const NO_MAXIMUM = Number.MAX_SAFE_INTEGER;

const root = z.toJSONSchema(EditSchema) as Node;

/** The node at a path of the kind SHAPES gives ('texts[].box'). */
function nodeAt(path: string): Node {
  let node = root;
  for (const part of path.split('.')) {
    const list = part.endsWith('[]');
    const next = node.properties?.[list ? part.slice(0, -2) : part];
    if (!next) throw new Error(`the edit schema has no field ${path}`);
    node = list ? next.items! : next;
  }
  return node;
}
const shapeNames = new Map(Object.entries(SHAPES).map(([name, path]) => [JSON.stringify(nodeAt(path)), name]));

const quoted = (values: unknown[]): string => values.map((value) => JSON.stringify(value)).join(', ');
function numberType(node: Node): string {
  const word = node.type === 'integer' ? 'whole number' : 'number';
  const top = node.maximum !== undefined && node.maximum < NO_MAXIMUM ? node.maximum : undefined;
  if (node.minimum !== undefined && top !== undefined) return `${word} ${node.minimum} … ${top}`;
  if (node.minimum !== undefined) return `${word} ≥ ${node.minimum}`;
  return top !== undefined ? `${word} ≤ ${top}` : word;
}
function stringType(node: Node, path: string): string {
  if (node.pattern === PATTERNS.id.source) return 'name';
  if (node.pattern === PATTERNS.language.source) return 'language tag';
  if (node.pattern === PATTERNS.word.source) return `word (≤ ${node.maxLength} characters)`;
  const kind = STRINGS.find(([pattern]) => pattern.test(path))?.[1];
  if (kind === undefined) throw new Error(`the reference does not know what the string ${path} holds: add it to STRINGS`);
  return kind === 'text' ? `text (≤ ${node.maxLength} characters)` : kind;
}
/** How many entries a list or a record at this path may have. */
function countOf(path: string, least: number | undefined): string {
  const most = (COUNTS as Record<string, number>)[path];
  const parts = [least === undefined ? '' : `at least ${least}`, most === undefined ? '' : `at most ${most}`].filter((part) => part !== '');
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}
const isForms = (node: Node): boolean => node.oneOf !== undefined && node.oneOf.every((form) => form.properties?.kind?.const !== undefined);

/** The type of a node in words. A shape used in several places is named, not spelled out. */
function typeOf(node: Node, path: string, inShape: boolean): string {
  const shape = inShape ? undefined : shapeNames.get(JSON.stringify(node));
  if (shape !== undefined) return shape;
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) return `one of ${quoted(node.enum)}`;
  if (isForms(node)) return `one of the forms ${quoted(node.oneOf!.map((form) => form.properties!.kind!.const))}`;
  if (node.anyOf) return node.anyOf.map((option) => typeOf(option, path, false)).join(', or ');
  if (node.type === 'integer' || node.type === 'number') return numberType(node);
  if (node.type === 'string') return stringType(node, path);
  if (node.type === 'boolean') return 'true or false';
  if (node.type === 'array' && node.prefixItems) return `[${node.prefixItems.map((item) => typeOf(item, path, false)).join(', ')}]`;
  if (node.type === 'array') {
    const item = typeOf(node.items!, `${path}[]`, false);
    return `list of ${item === 'object' ? 'objects' : item}${countOf(path, node.minItems)}`;
  }
  if (node.type === 'object' && node.additionalProperties) return `one ${typeOf(node.additionalProperties, path, false)} per key${countOf(path, undefined)}`;
  if (node.type === 'object') return 'object';
  throw new Error(`the reference cannot name the type of ${path}`);
}

/** The rows of a node's own fields, in the order of the schema. `inShape`: the node is the shape itself, so it is spelled out. */
function fieldsOf(node: Node, path: string, inShape = false): Field[] {
  if (!inShape && shapeNames.has(JSON.stringify(node))) return [];
  const row = (at: string, type: string, standIn: string): Field => {
    const note = NOTES[at];
    if (note === undefined) throw new Error(`the field ${at} has no line in notes.ts`);
    return { path: at, type, default: standIn, note };
  };
  if (isForms(node)) {
    return node.oneOf!.flatMap((form) => {
      const at = `${path}{${String(form.properties!.kind!.const)}}`;
      const { kind: _kind, ...rest } = form.properties!;
      const names = Object.keys(rest).map((name) => (form.required?.includes(name) ? name : `${name}?`));
      return [row(at, `{ "kind": ${JSON.stringify(form.properties!.kind!.const)}${names.map((name) => `, ${name}`).join('')} }`, ''),
        ...fieldsOf({ ...form, properties: rest }, at)];
    });
  }
  if (node.anyOf) return node.anyOf.flatMap((option) => fieldsOf(option, path));
  if (node.type === 'array' && !node.prefixItems) return fieldsOf(node.items!, `${path}[]`);
  if (node.type === 'object' && node.additionalProperties) return fieldsOf(node.additionalProperties, `${path}.${KEY[path] ?? '<name>'}`);
  if (node.type !== 'object') return [];
  return Object.entries(node.properties ?? {}).flatMap(([name, child]) => {
    const at = path === '' ? name : `${path}.${name}`;
    return [row(at, typeOf(child, at, false), node.required?.includes(name) ? 'required' : DEFAULTS[at] ?? 'none'), ...fieldsOf(child, at)];
  });
}

const READING = [
  'A path names a field: `shots[].from` is the field "from" of every entry of the list "shots"; `media.<key>` is the entry of "media" under a key you choose. A form of a field that has several is written `{kind}`: `Motion{push-in}.to` is the field "to" of a motion whose "kind" is "push-in".',
  `A frame is a whole number on the timeline of the whole video, never relative to a shot: frame 0 is the first, and ${FPS} frames are one second. "at" is the first frame of a thing, "for" the number of frames it lasts.`,
  'A box is written as its four edges in percent of the canvas: left and right of its width, top and bottom of its height. Right and bottom are edges, not sizes.',
  'A name is 1 to 32 characters: a lower-case letter, then lower-case letters, digits or "-". A colour is "#rgb", "#rrggbb" or "#rrggbbaa". A file name is "assets/" and a name of letters, digits, ".", "_" and "-".',
  'A field that is not listed is an error, not ignored. "required" in the Default column: the field must be there. "none": the field may be left out, and nothing takes its place.',
];

const motionText = (motion: Enter | Exit): string => (motion.kind === 'none' ? 'none' : `${motion.kind} ${'frames' in motion ? motion.frames : ''}`.trim());

export function reference(): Reference {
  const all = fieldsOf(root, '');
  const top = Object.keys(root.properties ?? {});
  const within = (name: string) => all.filter((field) => field.path !== name && new RegExp(`^${name}[.\\[]`).test(field.path));
  const sections: Section[] = [
    { title: 'The document', about: 'The fields of edit.json itself. Each part has its own table below.', fields: all.filter((field) => top.includes(field.path)) },
    ...top.filter((name) => within(name).length > 0).map((name) => ({ title: name, about: NOTES[name]!, fields: within(name) })),
    ...Object.entries(SHAPES).map(([name, path]) => ({ title: name, about: SHAPE_NOTES[name as keyof typeof SHAPES], fields: fieldsOf(nodeAt(path), name, true) })),
  ];

  const on = (width: 720 | 1080): Edit => ({ canvas: { width, height: width === 720 ? 1280 : 1920, fps: FPS } } as Edit);
  const [large, small] = [stylesOf(on(1080)), stylesOf(on(720))];
  const styles = Object.entries(large).map(([name, style]) => {
    const motion = textMotion({ style: name } as EditText);
    return {
      name, font: style.font, weight: style.weight, size1080: style.size, size720: small[name]!.size, fill: style.fill,
      outline: style.outline ? `${style.outline.width} em ${style.outline.colour}` : 'none',
      plate: style.plate ? `${style.plate.colour}, radius ${style.plate.radius} em, padding ${style.plate.padX} / ${style.plate.padY} em` : 'none',
      other: [style.upper ? 'upper case' : '', style.leading ? `leading ${style.leading}` : '', style.shadows.length > 0 ? `shadow ${style.shadows.join(', ')}` : '', style.align].filter((part) => part !== '').join(', '),
      enter: motionText(motion.enter), exit: motionText(motion.exit),
    };
  });
  const edges = (box: { left: number; top: number; right: number; bottom: number }): string => `left ${box.left}, top ${box.top}, right ${box.right}, bottom ${box.bottom}`;
  const safeAreas = (['both', 'reels', 'tiktok', 'none'] as const).map((safe) => {
    const column = buttonColumn({ safe } as Edit);
    return { safe, area: edges(safeArea({ safe } as Edit)), buttons: column ? edges(column) : 'none' };
  });
  const limits = [
    { what: 'canvas', limit: `${CANVASES.map((canvas) => `${canvas.width}×${canvas.height}`).join(' or ')}, at ${FPS} frames a second` },
    { what: 'the video', limit: `at most ${LIMITS.seconds} s (${LIMITS.seconds * FPS} frames)` },
    { what: 'a shot', limit: `at most ${LIMITS.shotSeconds} s (${LIMITS.shotSeconds * FPS} frames)` },
    { what: 'a box', limit: `at least ${LIMITS.minBox} × ${LIMITS.minBox} px` },
    { what: 'the scale of a motion or a zoom', limit: `${LIMITS.scale[0]} … ${LIMITS.scale[1]}` },
    { what: 'a gain', limit: `${LIMITS.gain[0]} … ${LIMITS.gain[1]}` },
    { what: 'elements that carry a blur (whip transitions, blur enters and exits)', limit: `at most ${LIMITS.blurred}` },
    { what: 'music that is looped', limit: `at least ${LIMITS.loopFrames} frames long` },
    ...Object.entries(COUNTS).map(([path, most]) => ({ what: `entries of \`${path}\``, limit: `at most ${most}` })),
  ];
  const easings = (Object.keys(EASINGS) as (keyof typeof EASINGS)[]).map((name) => ({ name, css: cssEase(name) }));
  return { version: 1, reading: READING, sections, styles, safeAreas, easings, limits };
}

// ── as markdown ──
const cell = (text: string): string => text.replaceAll('|', '\\|');
function table(head: string[], rows: string[][]): string[] {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)];
}

/** What docs/reference/edit-format.md holds. */
export function markdownOf(ref: Reference): string {
  const out = [
    '# The edit document (`edit.json`): every field',
    '',
    '<!-- Generated by `viraleditor schema --markdown` from viraleditor/src/edit/schema.ts, presets.ts and src/cli/notes.ts. Do not edit: a test fails when this file differs from what the command prints. -->',
    '',
    'How to use the editor: [the guide](../guide/viraleditor.md). This file is the full list; `viraleditor schema --json` gives the same as data.',
    '',
    '## How to read it',
    '',
    ...ref.reading.map((line) => `- ${line}`),
  ];
  for (const section of ref.sections) {
    out.push('', `## ${section.title === 'The document' ? section.title : `\`${section.title}\``}`, '', section.about, '',
      ...table(['Field', 'Type', 'Default', 'What it is'], section.fields.map((field) => [`\`${field.path}\``, field.type, field.default, field.note])));
  }
  out.push('', '## Text styles that exist without being listed', '',
    'A text names one of these in "style", or a style of its own from "styles" (which may replace one of these by using its name). Sizes are px: the first on a canvas 1080 wide, the second on 720.', '',
    ...table(['Name', 'Font', 'Size', 'Fill', 'Outline', 'Plate', 'Other', 'Enter', 'Exit'],
      ref.styles.map((style) => [`\`${style.name}\``, `${style.font} ${style.weight}`, `${style.size1080} / ${style.size720}`, style.fill, style.outline, style.plate, style.other, style.enter, style.exit])),
    '', '## Safe areas', '',
    'In percent of the canvas. A text, the captions or a card must lie inside the area and outside the column of the platform\'s buttons, unless it says `"safe": false`.', '',
    ...table(['`safe`', 'Area', 'Column of the buttons'], ref.safeAreas.map((row) => [`\`${row.safe}\``, row.area, row.buttons])),
    '', '## Easings', '',
    ...table(['Name', 'Curve'], ref.easings.map((row) => [`\`${row.name}\``, row.css])),
    '', '## Limits', '',
    ...table(['What', 'Limit'], ref.limits.map((row) => [row.what, row.limit])));
  return `${out.join('\n')}\n`;
}
