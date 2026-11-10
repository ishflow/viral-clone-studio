// A speech template: time comes from the speech. Every shot is as long as its measured clip, the caption words are the
// script's words timed by what was heard, and a text, a card or a window is on screen while the words of its mark are spoken.
import type { Captions, Card, Edit, Enter, Exit, Shot, Window } from '../edit/types.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { alignWords } from './align.ts';
import { own, ResolveError } from './error.ts';
import type { ResolveMedia } from './index.ts';
import { audioOf, clipOf, documentBase, given, listed, pictureOf, textOf } from './parts.ts';
import type { MediaTable, Picture, Placed } from './parts.ts';
import { parseSegments } from './script.ts';
import { markFrames, placeWords } from './words.ts';
import type { CaptionWord } from './words.ts';

/** The frames a window takes to shrink and to return when the template names none (the edit document's default). */
const WINDOW_FRAMES = 10;
/** Two windows of a shot fewer than this many frames apart are one window whose picture changes: the presenter does not come back for a moment. */
const WINDOW_JOIN_FRAMES = 30;
/** The longest enter or exit the edit document gives an element that names none, and the most a preset spreads the lines of a text. */
const DEFAULT_ANIMATION = 8;
const STAGGER_ROOM = 6;
/** The fade an element gets on a mark too short for its animations. */
const QUICK_FADE = 3;

/** Where a mark is: its frames, and the shot of its segment. */
type Marked = (mark: string | undefined, what: string) => { placed: Placed; shot: Shot };

export function resolveSpeech(template: TemplateJson, fill: FillJson, media: ResolveMedia): Edit {
  const table: MediaTable = {};
  const segments = (template.script?.segments ?? []).map(({ id }) => ({ id, lines: own(fill.script, id) ?? '' }));
  const script = parseSegments(segments);
  const shots = shotsOf(template, media, table);
  const shotOf = segments.map(({ id }) => {                     // the shot that speaks each segment
    const index = template.shots.findIndex((shot) => shot.segment === id);
    if (index < 0) throw new ResolveError('template-invalid', `no shot speaks segment "${id}"`);
    return shots[index]!;
  });
  const words: CaptionWord[][] = segments.map(({ id }, i) => {  // the script's words, with the times of what was heard
    const heard = own(media.words, id);
    if (heard === undefined) throw new ResolveError('media-missing', `media.words has no words for segment "${id}"`);
    return placeWords(script.words[i]!, alignWords(script.words[i]!, heard), shotOf[i]!, template.canvas.fps);
  });
  const marked: Marked = (mark, what) => {
    const place = mark === undefined ? undefined : script.marks.get(mark);
    if (place === undefined) throw new ResolveError('mark-unknown', `${what} names the mark "${mark}", which the script does not have`);
    return { placed: markFrames(words[place.segment]!, place, shotOf[place.segment]!), shot: shotOf[place.segment]! };
  };

  const texts = template.texts.map((text) => {
    const { placed } = marked(text.mark, `text "${text.id}"`);
    return { ...textOf(text, fill, placed), ...animations(placed.for, text.enter, text.exit, true) };
  });
  const cards = cardsOf(template, fill, media, table, marked);
  openWindows(template, fill, media, table, marked);
  const last = shots.at(-1);
  return {
    ...documentBase(template, fill),
    frames: last ? last.at + last.for : 0,
    media: table, shots, texts,
    ...given({ captions: captionsOf(template, words.flat()) }),
    ...(cards.length > 0 ? { cards } : {}),
    ...audioOf(template, media, table),
  };
}

/** One shot per segment, end to end, each as long as its clip and with the clip's own sound. */
function shotsOf(template: TemplateJson, media: ResolveMedia, table: MediaTable): Shot[] {
  let end = 0;
  return template.shots.map((shot) => {
    const clip = clipOf(shot.id, media, table);
    const placed: Shot = { id: shot.id, at: end, for: clip.frames, media: clip.key, sound: { gain: 1 }, ...given({ in: shot.in, motion: shot.motion }) };
    end += clip.frames;
    return placed;
  });
}

function cardsOf(template: TemplateJson, fill: FillJson, media: ResolveMedia, table: MediaTable, marked: Marked): Card[] {
  const cards: Card[] = [];
  for (const card of template.cards ?? []) {
    const { placed } = marked(card.mark, `card "${card.id}"`);
    const picture = pictureOf(card.image, fill, media);
    if (picture === null) continue;                             // a product or a photograph this customer did not give
    const { left, top, right, bottom } = card.box;
    const fullFrame = left === 0 && top === 0 && right === 100 && bottom === 100;
    cards.push({
      id: card.id, ...placed, media: listed(picture, table), box: card.box,
      ...(fullFrame ? { fit: 'cover' as const } : {}),           // a card shows its whole picture; only one that fills the frame is cropped to it
      ...given({ radius: card.radius, motion: card.motion, safe: card.safe }), ...animations(placed.for, card.enter, card.exit, false),
    });
  }
  return cards;
}

interface Opening { placed: Placed; shot: Shot; picture: Picture; window: NonNullable<TemplateJson['windows']>[number] }

/**
 * Puts the windows on the shots of their segments, in time order. Windows that follow each other closely are one window
 * whose picture changes on the first frame of the later mark; its place, speed and motion are the first one's.
 * A window shrinks, rests at least one frame and returns, and its picture changes only while it rests: on short marks it
 * moves faster, and a window under 3 frames is left out.
 */
function openWindows(template: TemplateJson, fill: FillJson, media: ResolveMedia, table: MediaTable, marked: Marked): void {
  const openings: Opening[] = [];
  for (const window of template.windows ?? []) {
    const picture = pictureOf(window.behind, fill, media);
    if (picture !== null) openings.push({ ...marked(window.mark, `the window on "${window.mark}"`), picture, window });
  }
  openings.sort((a, b) => a.placed.at - b.placed.at);
  const runs: Opening[][] = [];
  for (const opening of openings) {
    const run = runs.at(-1), before = run?.at(-1);
    if (run && before && before.shot === opening.shot && opening.placed.at - (before.placed.at + before.placed.for) < WINDOW_JOIN_FRAMES) run.push(opening);
    else runs.push([opening]);
  }
  for (const run of runs) {
    const first = run[0]!, last = run.at(-1)!;
    const at = first.placed.at, end = last.placed.at + last.placed.for;
    let frames = Math.min(first.window.frames ?? WINDOW_FRAMES, Math.floor((end - at - 1) / 2));
    if (frames < 1) continue;
    const swaps: NonNullable<Window['swaps']> = [];
    for (const later of run.slice(1)) {
      // A one-frame final mark is shown on the preceding resting frame; the last frame is reserved for return.
      // This advances that swap by one frame at most instead of silently discarding a paid picture.
      const swapAt = Math.min(later.placed.at, end - 2);
      const room = Math.min(swapAt - at, end - 1 - swapAt);   // the frames the shrink and the return may take around this change
      if (room < 1) continue;
      frames = Math.min(frames, room);
      swaps.push({ at: swapAt, behind: listed(later.picture, table) });
    }
    const { corner, width, radius, behindMotion } = first.window;
    const opened: Window = {
      at, for: end - at, corner, behind: listed(first.picture, table),
      ...given({ width, radius, behindMotion }),
      ...(first.window.frames !== undefined || frames !== WINDOW_FRAMES ? { frames } : {}),
      ...(swaps.length > 0 ? { swaps } : {}),
    };
    first.shot.windows = [...(first.shot.windows ?? []), opened];
  }
}

/**
 * The enter and the exit of an element on a mark. The editor wants a frame on which the element stands still between the two,
 * and how long a mark lasts is known only when the clips exist: on a mark too short for its animations the element fades
 * quickly in and out instead, and the lines of a text come in together.
 */
function animations(length: number, enter: Enter | undefined, exit: Exit | undefined, text: boolean): { enter?: Enter; exit?: Exit; stagger?: number } {
  const frames = (motion: Enter | Exit | undefined) => motion?.kind === 'none' ? 0 : motion?.frames ?? DEFAULT_ANIMATION;
  if (frames(enter) + frames(exit) + (text ? STAGGER_ROOM : 0) < length) return given({ enter, exit });
  const quick = Math.min(QUICK_FADE, Math.floor((length - 1) / 2));
  const fade = quick >= 1 ? { kind: 'fade' as const, frames: quick } : { kind: 'none' as const };
  return { enter: fade, exit: fade, ...(text ? { stagger: 0 } : {}) };
}

function captionsOf(template: TemplateJson, words: CaptionWord[]): Captions | undefined {
  const captions = template.captions;
  return captions && { box: captions.box, words, ...given({ style: captions.style, group: captions.group, active: captions.active, enter: captions.enter }) };
}
