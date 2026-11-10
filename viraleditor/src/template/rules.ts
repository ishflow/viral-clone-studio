// What a template must satisfy beyond the shape of its fields: the rules of its mode, references that resolve, and the rules of
// the editor that can be checked before any clip exists. Each finding names its path and says what to write instead.
import type { z } from 'zod';
import { ResolveError } from '../resolve/error.ts';
import { parseSegments, sharingWords } from '../resolve/script.ts';
import type { MarkPlace } from '../resolve/script.ts';
import { partsOf } from './clips.ts';
import { billedSeconds, MAX_IMAGE_REFERENCES, SEGMENT_SECONDS_MAX, SHOT_SECONDS_MAX, SPEECH_SECONDS_MAX, SPEECH_TRANSITION_FRAMES_MAX, VIDEO_SECONDS_MAX } from './limits.ts';
import { tailOf } from './motion.ts';
import type { TemplateShape } from './schema.ts';
import { imageOf } from './values.ts';

/**
 * How much longer than its shots show a clip may be asked for: twice their seconds and two more, so a clip has room for the engine to
 * spread its parts (clips.ts) and a billed minimum of 4 s still holds a short shot. The provider's own limit (15 s per clip, the
 * schema's) stays above this; it is this rule that stops a 1 s shot from being billed 15 s (B12).
 */
const CLIP_SLACK_FACTOR = 2;
const CLIP_SLACK_SECONDS = 2;

type Path = (string | number)[];
export type Issue = (path: Path, message: string) => void;
type Shape = z.infer<typeof TemplateShape>;
type Speech = Shape & { script: NonNullable<Shape['script']> };

export function templateRules(template: Shape, issue: Issue): void {
  const { width, height } = template.canvas;
  if (width * 16 !== height * 9) issue(['canvas'], 'the canvas is 720×1280 or 1080×1920');
  if (template.products.min > template.products.max) issue(['products'], 'products.min is larger than products.max');
  const music = template.audio.music;
  if (music.duck && music.duck.to > music.gain) issue(['audio', 'music', 'duck', 'to'], `ducking lowers the music: "to" (${music.duck.to}) is at most the gain (${music.gain})`);

  const seen = new Map<string, string>();                   // these ids become element ids of one composition
  const once = (id: string, path: Path) => {
    const first = seen.get(id);
    if (first !== undefined) issue(path, `the id "${id}" is already used by ${first}: ids of shots, texts and cards are unique together`);
    else seen.set(id, path.slice(0, 2).join('.'));
  };
  template.shots.forEach((shot, i) => once(shot.id, ['shots', i, 'id']));
  template.texts.forEach((text, i) => once(text.id, ['texts', i, 'id']));
  template.cards?.forEach((card, i) => once(card.id, ['cards', i, 'id']));

  template.shots.forEach((shot, i) => {
    for (const product of shot.products) if (product !== 'all' && Number(product) > template.products.min) issue(['shots', i, 'products'], `product ${product} is beyond products.min (${template.products.min}): a shot names only products every customer has`);
    if (i === 0 && shot.in !== undefined && shot.in.kind !== 'cut') issue(['shots', 0, 'in'], 'the first shot replaces nothing: remove "in"');
  });

  if (template.mode === 'beats') beatsRules(template, issue);
  else if (!template.script || !template.presenter) issue(['script'], 'a speech template needs script and presenter');
  else speechRules({ ...template, script: template.script }, issue);
}

function beatsRules(template: Shape, issue: Issue): void {
  const fps = template.canvas.fps;
  for (const key of ['script', 'presenter', 'cards', 'windows', 'captions'] as const) {
    if (template[key] !== undefined) issue([key], `"${key}" belongs to a speech template`);
  }
  let end = 0;
  template.shots.forEach((shot, i) => {
    if (shot.segment !== undefined) issue(['shots', i, 'segment'], 'a beats shot has no segment');
    if (shot.continues !== undefined) continuesRules(template, i, issue);
    else ownsClip(shot, i, issue);
    // its image request reads its stills and one photograph of each product it names ("all": of every product a customer may give)
    const pictures = (shot.stills?.length ?? 0) + (shot.products.includes('all') ? template.products.max : new Set(shot.products).size);
    // Ruling: current shape limits (two stills + five products) cannot exceed fourteen references.
    // Keep this guard as defense for a future schema expansion; it has no current refusal branch.
    if (pictures > MAX_IMAGE_REFERENCES) issue(['shots', i, 'stills'], `the first frame would be made from ${pictures} pictures (its stills and the photographs of its products): an image takes at most ${MAX_IMAGE_REFERENCES}`);
    if (shot.at === undefined || shot.for === undefined) { issue(['shots', i], 'a beats shot needs at and for'); return; }
    if (shot.at !== end) issue(['shots', i, 'at'], `shots follow each other without a gap: this one starts at ${end}`);
    end = shot.at + shot.for;
    if (shot.for > SHOT_SECONDS_MAX * fps) issue(['shots', i, 'for'], `a shot is at most ${SHOT_SECONDS_MAX} s (${SHOT_SECONDS_MAX * fps} frames)`);
    if (shot.continues === undefined && shot.clip_seconds !== undefined) {
      // the parts fit the clip: this shot's frames and those of every shot that continues it, with the transition after the last
      const parts = partsOf(template, shot.id);
      const needed = parts.reduce((sum, part) => sum + part.frames, 0), asked = billedSeconds(shot.clip_seconds);
      const most = Math.max(billedSeconds(0), CLIP_SLACK_FACTOR * Math.ceil(needed / fps) + CLIP_SLACK_SECONDS);
      if (asked > most) issue(['shots', i, 'clip_seconds'], `the clip is asked for ${asked} s but the shots show only ${needed} frames of it (${Math.ceil(needed / fps)} s): ask for at most ${most} s, a clip is billed by its length`);
      if (needed > asked * fps) {
        issue(['shots', i, 'clip_seconds'], parts.length === 1
          ? `the shot shows ${needed} frames (with the next shot's transition) but its clip is asked for ${asked} s (${asked * fps} frames)`
          : `the shots ${parts.map((part) => `"${part.shot.id}"`).join(', ')} show ${needed} frames of this clip (with the transition after the last) but it is asked for ${asked} s (${asked * fps} frames)`);
      }
    }
    if (shot.motion?.kind === 'punch-in' && (shot.motion.at < shot.at || shot.motion.at >= end)) issue(['shots', i, 'motion', 'at'], `the punch-in lies outside its shot (frames ${shot.at} … ${end - 1})`);
  });
  if (end > VIDEO_SECONDS_MAX * fps) issue(['shots'], `a video is at most ${VIDEO_SECONDS_MAX} s`);
  template.texts.forEach((text, i) => {
    if (text.mark !== undefined) issue(['texts', i, 'mark'], 'a beats text has at and for, not a mark');
    if (text.at === undefined || text.for === undefined) issue(['texts', i], 'a beats text needs at and for');
    else if (text.at + text.for > end) issue(['texts', i, 'for'], `the text ends after the last shot (frame ${end})`);
  });
  pictureRules(template, issue);
}

/** A beats shot that owns its clip: its first frame and its clip are paid requests made from its own prompts. */
function ownsClip(shot: Shape['shots'][number], i: number, issue: Issue): void {
  if (shot.still_prompt === undefined) issue(['shots', i, 'still_prompt'], 'a beats shot needs still_prompt: its first frame is a generated image');
  if (shot.motion_prompt === undefined) issue(['shots', i, 'motion_prompt'], 'a beats shot needs motion_prompt: what moves in the clip made from its first frame');
  if (shot.clip_seconds === undefined) issue(['shots', i, 'clip_seconds'], 'a beats shot needs clip_seconds: the length its clip is asked for');
}

/**
 * A beats shot that continues the clip of an earlier shot: it names the shot that owns the clip (one level), the parts of a
 * clip follow each other, and it has nothing a paid request is made from: no prompt, no clip_seconds, no stills, no product.
 * It is the same take as the shot before it, so it comes in by a cut.
 */
function continuesRules(template: Shape, i: number, issue: Issue): void {
  const shot = template.shots[i]!, id = shot.continues!;
  const at = template.shots.findIndex((candidate) => candidate.id === id);
  const owner = template.shots[at];
  if (owner === undefined) issue(['shots', i, 'continues'], `the template has no shot "${id}": a shot continues the clip of an earlier shot, named by its id`);
  else if (at >= i) issue(['shots', i, 'continues'], `"${id}" does not stand before this shot: a shot continues the clip of an earlier shot`);
  else if (owner.continues !== undefined) issue(['shots', i, 'continues'], `"${id}" continues a clip itself: name the shot that owns the clip, "${owner.continues}"`);
  else {
    const between = template.shots.slice(at + 1, i).find((other) => other.continues !== id);
    if (between !== undefined) issue(['shots', i, 'continues'], `the parts of a clip follow each other: "${between.id}" stands between "${id}" and this shot and does not continue "${id}"`);
  }
  for (const field of ['still_prompt', 'motion_prompt', 'clip_seconds', 'stills'] as const) {
    if (shot[field] !== undefined) issue(['shots', i, field], `a shot that continues a clip has no ${field}: it shows a part of the clip of "${id}"`);
  }
  if (shot.products.length > 0) issue(['shots', i, 'products'], `a shot that continues a clip names no product (products: []): what its clip is made from is named by "${id}"`);
  if (shot.in !== undefined && shot.in.kind !== 'cut') issue(['shots', i, 'in'], 'a shot that continues a clip comes in by a cut: it is the same take as the shot before it');
}

function speechRules(template: Speech, issue: Issue): void {
  const segments = template.script.segments;
  const ids = new Set<string>();
  segments.forEach((segment, i) => { if (ids.has(segment.id)) issue(['script', 'segments', i, 'id'], `the segment id "${segment.id}" is used twice`); ids.add(segment.id); });
  const marks = marksOf(segments, (message) => issue(['script', 'segments'], message));

  speechShots(template, issue);
  if (typeof template.audio.music.duck?.under === 'object') issue(['audio', 'music', 'duck', 'under'], 'frame ranges are not known in a speech template: use "sound" or "captions"');
  const marked = (mark: string | undefined, path: Path) => {
    if (mark !== undefined && !marks.has(mark)) issue(path, `mark-unknown: the script has no [${mark}]…[/${mark}]`);
  };
  template.texts.forEach((text, i) => {
    if (text.at !== undefined || text.for !== undefined) issue(['texts', i], 'a speech text has a mark, not at and for');
    if (text.mark === undefined) issue(['texts', i], 'a speech text needs mark');
    marked(text.mark, ['texts', i, 'mark']);
  });
  template.cards?.forEach((card, i) => marked(card.mark, ['cards', i, 'mark']));
  template.windows?.forEach((window, i) => marked(window.mark, ['windows', i, 'mark']));
  pictureRules(template, issue);
  windowRules(template, marks, issue);
}

/** One shot per segment, in the script's order; each a talking clip made from the presenter still. */
function speechShots(template: Speech, issue: Issue): void {
  const segments = template.script.segments;
  if (template.shots.length !== segments.length) issue(['shots'], `one shot per script segment, in the same order: ${segments.length} segments, ${template.shots.length} shots`);
  let seconds = 0;
  template.shots.forEach((shot, i) => {
    if (shot.at !== undefined || shot.for !== undefined) issue(['shots', i], 'a speech shot has no at and for: it is as long as its clip');
    if (shot.still_prompt !== undefined) issue(['shots', i, 'still_prompt'], 'a speech shot has no still_prompt: every clip starts from the presenter still');
    if (shot.stills !== undefined) issue(['shots', i, 'stills'], 'a speech shot has no stills: every clip starts from the presenter still');
    if (shot.segment === undefined) issue(['shots', i], 'a speech shot needs segment');
    else if (shot.segment !== segments[i]?.id) issue(['shots', i, 'segment'], `shot ${i + 1} speaks segment ${i + 1} of the script ("${segments[i]?.id ?? 'none'}")`);
    if (shot.continues !== undefined) issue(['shots', i, 'continues'], 'a speech shot continues no clip: every segment is a talking clip of its own');
    if (shot.motion_prompt === undefined) issue(['shots', i, 'motion_prompt'], 'a speech shot needs motion_prompt: how the presenter performs the segment');
    if (shot.clip_seconds === undefined) issue(['shots', i, 'clip_seconds'], 'a speech shot needs clip_seconds: the length its talking clip is asked for');
    else if (shot.clip_seconds > SEGMENT_SECONDS_MAX) issue(['shots', i, 'clip_seconds'], `a talking clip is asked for at most ${SEGMENT_SECONDS_MAX} s`);
    seconds += shot.clip_seconds ?? 0;
    if (shot.in !== undefined && tailOf(shot.in) > 0) issue(['shots', i, 'in'], `"${shot.in.kind}" needs frames after the last one of the segment before: between talking clips use cut, zoom, flash or dip`);
    else if (shot.in !== undefined && shot.in.kind !== 'cut' && (shot.in.frames ?? 0) > SPEECH_TRANSITION_FRAMES_MAX) issue(['shots', i, 'in', 'frames'], `a transition between talking clips takes at most ${SPEECH_TRANSITION_FRAMES_MAX} frames`);
    if (shot.motion?.kind === 'punch-in') issue(['shots', i, 'motion'], 'a punch-in names a frame, and the frames of a talking clip are not known in the template: use push-in or pull-out');
  });
  if (seconds > SPEECH_SECONDS_MAX) issue(['shots'], `the talking clips are asked for ${seconds} s together: at most ${SPEECH_SECONDS_MAX}`);
}

/**
 * Every picture that is named exists. What a paid request is made from (a still's and the presenter's references) names only
 * products every customer has, 1 … products.min: a missing one would be found after payment. A card or a window may name up
 * to products.max: without that product or photograph it is left out. A still builds only on a still made before it, a mark
 * shows a picture once, and a still that nothing uses is refused: it would be paid for. In beats the first frame of a shot is
 * made from the stills the shot names, and a still is an image of the variant like a shot's: it has no shot's id.
 */
function pictureRules(template: Shape, issue: Issue): void {
  const beats = template.mode === 'beats';
  const stills = new Set<string>(), used = new Set<string>();
  const pictured = (ref: string, path: Path, limit: 'min' | 'max') => {
    const image = imageOf(ref);
    if (image.kind === 'still') {
      if (stills.has(image.id)) used.add(image.id);
      else issue(path, `"${ref}" names no still listed before it in "stills"`);
    } else if (image.product > template.products[limit]) {
      issue(path, `"${ref}" is beyond products.${limit} (${template.products[limit]})${limit === 'min' ? ': a paid request names only products every customer has' : ''}`);
    }
  };
  template.presenter?.references.forEach((ref, k) => pictured(ref, ['presenter', 'references', k], 'min'));
  template.stills?.forEach((still, i) => {
    still.references.forEach((ref, k) => pictured(ref, ['stills', i, 'references', k], 'min'));
    if (stills.has(still.id)) issue(['stills', i, 'id'], `the still id "${still.id}" is used twice`);
    if (beats && template.shots.some((shot) => shot.id === still.id)) issue(['stills', i, 'id'], `"${still.id}" is also the id of a shot: the still and the shot's first frame would be one image of the variant`);
    stills.add(still.id);
  });
  if (beats) template.shots.forEach((shot, i) => shot.stills?.forEach((id, k) => {
    if (!stills.has(id)) issue(['shots', i, 'stills', k], `the template has no still "${id}": a shot names ids of "stills"`);
    else if (shot.stills!.indexOf(id) < k) issue(['shots', i, 'stills', k], `the still "${id}" is named twice in this shot`);
    else used.add(id);
  }));
  const shown = new Set<string>();
  template.cards?.forEach((card, i) => {
    pictured(card.image, ['cards', i, 'image'], 'max');
    if (shown.has(`${card.mark} ${card.image}`)) issue(['cards', i], `an earlier card shows the same picture on the same mark [${card.mark}]: keep one`);
    shown.add(`${card.mark} ${card.image}`);
  });
  template.windows?.forEach((window, i) => pictured(window.behind, ['windows', i, 'behind'], 'max'));
  template.stills?.forEach((still, i) => {
    if (used.has(still.id)) return;
    if (beats) issue(['stills', i], `still-unused: no shot and no other still uses "${still.id}", and every still is a paid image: name it in "stills" of a shot or remove it`);
    else issue(['stills', i], `still-unused: no card, no window and no other still uses "still:${still.id}", and every still is a paid image: show it or remove it`);
  });
}

/** The editor's rules for windows: one at a time; the windows of one shot rest at one place; a shot with a window neither comes in nor leaves by a zoom. */
function windowRules(template: Speech, marks: Map<string, MarkPlace>, issue: Issue): void {
  const windows = template.windows ?? [];
  const open = sharingWords(marks, windows.map((window) => window.mark));
  if (open) issue(['windows'], `window-overlap: the windows on [${open[0]}] and [${open[1]}] share words: only one window is open at a time`);
  const placeOf = new Map<number, string>();                // segment → where its first window rests
  windows.forEach((window, i) => {
    const segment = marks.get(window.mark)?.segment;
    if (segment === undefined) return;
    const place = `corner ${window.corner}, width ${window.width ?? 'default'}, radius ${window.radius ?? 'default'}`;
    const first = placeOf.get(segment);
    if (first === undefined) placeOf.set(segment, place);
    else if (first !== place) issue(['windows', i], `the windows of one segment rest at one place: give this one the ${first} of the segment's first window`);
  });
  for (const segment of placeOf.keys()) {
    for (const at of [segment, segment + 1]) {              // the transition that brings the shot in, and the one that takes it out
      if (template.shots[at]?.in?.kind === 'zoom') issue(['shots', at, 'in'], `the shot of segment "${template.script.segments[segment]!.id}" has a window, and a shot with a window neither comes in nor leaves by a zoom: use cut, flash or dip`);
    }
  }
}

/** The marks of a script; a script that cannot be read is an issue and has no marks. */
function marksOf(segments: { id: string; lines: string }[], refuse: (message: string) => void): Map<string, MarkPlace> {
  try { return parseSegments(segments).marks; } catch (error) {
    if (!(error instanceof ResolveError)) throw error;
    refuse(`${error.code}: ${error.message}`);
    return new Map();
  }
}
