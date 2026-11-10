import { ToolUnavailable } from '../adapters/measure.ts';
import { MediaError } from '../adapters/media.ts';
import type { Rect, Timeline } from '../edit/timeline.ts';
import type { Measure, Picture, StreamFacts } from '../ports.ts';
import type { QualityIssue } from './issue.ts';
import { parseColour, readInk, readOver, toHex } from './pixels.ts';
import type { OverReading } from './pixels.ts';
import { placed, plainShot } from './placement.ts';
import type { Plain } from './placement.ts';
import {
  BLACK_DARK_CHANNEL, BLACK_EXPLAIN_MARGIN, BLACK_MIN_FRAMES, ELEMENT_MARGIN, FOOTAGE_MATCH_SHARE, FPS_TOLERANCE_OUTPUT, MATCH_MIN_AREA, MATCH_STEP, OVER_MIN_AREA, FROZEN_MAX_FRAMES, INK_BACKGROUND_SHARE, INK_GROWTH, RAW_GROWTH_SIGMAS, STILL_SOURCE_SHARE, INK_MIN_PIXELS, INK_MIN_SHARE, LUFS_CEILING_NO_MASTER,
  LUFS_FLOOR_NO_MASTER, LUFS_TOLERANCE, MIN_CONTRAST, MIX_SILENT_LUFS, RING_MIN_PIXELS, TRUE_PEAK_MAX,
} from './thresholds.ts';

/** Runs of consecutive numbers in a sorted set of frames, as { at, for }. */
function runsOf(frames: Iterable<number>): { at: number; for: number }[] {
  const sorted = [...frames].sort((a, b) => a - b);
  const runs: { at: number; for: number }[] = [];
  for (const f of sorted) {
    const last = runs[runs.length - 1];
    if (last && f === last.at + last.for) last.for++;
    else runs.push({ at: f, for: 1 });
  }
  return runs;
}
function span(at: number, length: number): number[] {
  return Array.from({ length: Math.max(0, length) }, (_, i) => at + i);
}
const lu = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '-inf');

/** A transition colour hides black frames only when it is itself black: every channel at most BLACK_DARK_CHANNEL. No colour given counts as dark. */
function isDark(colour: string | null): boolean {
  if (colour === null) return true;
  const c = parseColour(colour);
  return Math.max(c.r, c.g, c.b) <= BLACK_DARK_CHANNEL;
}

/**
 * `sources` (media key → file), when given, lets the check tell a render fault from footage that is black itself:
 * black in a video shot whose source frames are black too is the warning `dark-footage`, not the error `black-frames`.
 */
export async function checkOutput(file: string, timeline: Timeline, measure: Measure, sources?: Record<string, string>): Promise<QualityIssue[]> {
  const issues: QualityIssue[] = [];
  const tell = (code: string, severity: 'error' | 'warning', message: string, fix: string, at: number | null, target: string | null) =>
    issues.push({ code, severity, message, fix, at, target });
  const { fps, width, height } = timeline;
  const when = (frame: number) => `frame ${frame} (${(frame / fps).toFixed(2)} s)`;
  const shotAt = (frame: number) => timeline.shots.find((s) => s.at <= frame && frame < s.at + s.for + s.tail);

  // ── the file is what the timeline says it is ──
  let facts: StreamFacts;
  try {
    facts = await measure.streams(file);
  } catch (e) {
    if (!(e instanceof MediaError)) throw e;
    if (e instanceof ToolUnavailable) {
      tell('tool-failed', 'error', `${e.bin} is missing or cannot start (${e.message}): the render could not be examined.`, 'Install ffmpeg (ffprobe comes with it) and make sure both can be started; `viraleditor doctor` shows which tools are found. Then check again.', null, null);
      return issues;
    }
    tell('output-mismatch', 'error', `The render ${file} cannot be read (${e.message}).`, 'Render again; if it fails the same way, run `viraleditor check <edit.json> --deep` and fix what it reports.', null, file);
    return issues;
  }
  const shape: string[] = [];
  if (facts.width !== width || facts.height !== height) shape.push(`size ${facts.width}x${facts.height}, the timeline says ${width}x${height}`);
  if (Math.abs(facts.fps - fps) > FPS_TOLERANCE_OUTPUT) shape.push(`${facts.fps} fps, the timeline says ${fps}`);
  if (facts.frames !== timeline.frames) shape.push(`${facts.frames} frames, the timeline says ${timeline.frames}`);
  if (!facts.constantRate) shape.push('a variable frame rate (frames do not all last the same; frame numbers would not mean the same time)');
  if (shape.length > 0) {
    tell('output-mismatch', 'error', `The render does not match its timeline: ${shape.join('; ')}.`,
      'Render again from the current composition (the file may be from an earlier run). If the numbers stay wrong, the canvas, the fps or the shot lengths in the edit are not what the renderer got: check them and compose again.', null, file);
    return issues;                                    // every frame number below would be read against the wrong file
  }
  const wantsSound = timeline.audio.length > 0;
  if (wantsSound && !facts.sound) {
    tell('output-mismatch', 'error', 'The render has no sound stream, although the timeline has sound.',
      'Render again. If the stream is still missing, check that the audio files in edit.media exist and that edit.audio points at them.', null, file);
  }

  // ── black frames ──
  const explained = new Set<number>();
  for (const t of timeline.transitions) {
    if ((t.kind === 'dip' || t.kind === 'flash') && isDark(t.colour)) for (const f of span(t.at - BLACK_EXPLAIN_MARGIN, t.for + 2 * BLACK_EXPLAIN_MARGIN)) explained.add(f);
  }
  const black = new Set<number>();
  const anyBlack = new Set<number>();                // black, explained or not: a black stretch is also still, and is judged as black only
  for (const r of await measure.black(file)) for (const f of span(r.at, r.for)) { anyBlack.add(f); if (!explained.has(f)) black.add(f); }
  // What the sources show on their own. A source that is missing or unreadable gives no information (null): the run is then judged as if `sources` were not given.
  const sourceSets = new Map<string, Promise<Set<number> | null>>();
  const inSource = (kind: 'black' | 'frozen', media: string): Promise<Set<number> | null> => {
    const path = sources?.[media];
    if (!path) return Promise.resolve(null);
    const key = `${kind}:${media}`;
    if (!sourceSets.has(key)) sourceSets.set(key, measure[kind](path).then((runs) => new Set(runs.flatMap((r) => span(r.at, r.for)))).catch((e: unknown) => { if (e instanceof MediaError) return null; throw e; }));
    return sourceSets.get(key)!;
  };
  const blackInSource = (media: string) => inSource('black', media);
  for (const run of runsOf(black)) {
    if (run.for < BLACK_MIN_FRAMES) continue;
    // one report per shot the run crosses
    const pieces: { shot: Timeline['shots'][number] | undefined; at: number; for: number }[] = [];
    for (const f of span(run.at, run.for)) {
      const shot = shotAt(f);
      const last = pieces[pieces.length - 1];
      if (last && last.shot === shot) last.for++;
      else pieces.push({ shot, at: f, for: 1 });
    }
    for (const piece of pieces) {
      const shot = piece.shot;
      if (shot?.kind === 'video') {
        const a = shot.from + (piece.at - shot.at);
        const b = a + piece.for - 1;
        const dark = await blackInSource(shot.media);
        if (dark && span(a, piece.for).every((f) => dark.has(f))) {
          tell('dark-footage', 'warning', `The footage of shot ${shot.id} is black on source frames ${a}-${b} of "${shot.media}" (output ${when(piece.at)}, ${piece.for} frames); the render shows what the clip holds.`,
            `Set shot ${shot.id}'s "from" to ${b + 1} or later, so that source frames ${a}-${b} are not used (the clip needs ${shot.for + shot.tail} frames after that), or use another clip. If the black is meant, ignore this warning.`, piece.at, shot.id);
          continue;
        }
        tell('black-frames', 'error', `${piece.for} black frames from ${when(piece.at)}, during shot ${shot.id} (media "${shot.media}", source frames ${a}-${b}); the timeline has no dark dip or flash there.`,
          `Source frame ${a} onward of shot ${shot.id} (media "${shot.media}") shows black in the render. Open the shot's clip and check whether it really has picture on source frames ${a}-${b}: if not, set the shot's "from" to ${b + 1} ("from": ${b + 1}) or use another clip. If the clip is fine, something else covers frames ${piece.at}-${piece.at + piece.for - 1}: look for an element with a black background or a black image there, and remove it. If the black is meant, add a transition of kind "dip" over those frames.`,
          piece.at, shot.id);
      } else {
        tell('black-frames', 'error', `${piece.for} black frames from ${when(piece.at)}${shot ? `, during shot ${shot.id} (media "${shot.media}", an image)` : ', where no shot is on screen'}; the timeline has no dark dip or flash there.`,
          shot ? `Shot ${shot.id} shows an image and should not be black: check that the image file "${shot.media}" is not black, or replace it, and look for an element covering frames ${piece.at}-${piece.at + piece.for - 1} with a black background.` :
            `No shot covers frames ${piece.at}-${piece.at + piece.for - 1}: the shots must tile the whole video. Fix the shot lengths in the edit, or put a shot on those frames. If the black is meant, add a transition of kind "dip" over them.`,
          piece.at, shot?.id ?? file);
      }
    }
  }

  // ── frozen frames ──
  const frozen = new Set<number>();
  for (const r of await measure.frozen(file)) for (const f of span(r.at, r.for)) frozen.add(f);
  for (const shot of timeline.shots) {
    if (shot.kind !== 'video') continue;
    const moving = new Set(span(shot.at, shot.for));
    for (const w of timeline.windows) {
      if (w.shot !== shot.id) continue;
      for (const f of span(w.at + w.frames, w.for - 2 * w.frames)) moving.delete(f);     // the window's rest: a small window over another picture
    }
    for (const run of runsOf([...moving].filter((f) => frozen.has(f) && !anyBlack.has(f)))) {
      if (run.for <= FROZEN_MAX_FRAMES) continue;
      const a = shot.from + (run.at - shot.at);
      const b = a + run.for - 1;
      const still = await inSource('frozen', shot.media);
      if (still && span(a, run.for).filter((f) => still.has(f)).length >= STILL_SOURCE_SHARE * run.for) {
        tell('still-footage', 'warning', `The footage of shot ${shot.id} does not move on source frames ${a}-${b} of "${shot.media}" (output ${when(run.at)}, ${run.for} frames); the render shows what the clip holds.`,
          `Use another clip for shot ${shot.id}, or set its "from" past source frame ${b} (the clip needs ${shot.for + shot.tail} frames after that), or shorten the shot. If a still picture is meant, make it an image shot instead of a video.`, run.at, shot.id);
        continue;
      }
      tell('frozen-frames', 'error', `The picture does not change for ${run.for} frames from ${when(run.at)}, while video shot ${shot.id} (media ${shot.media}) should be playing.`,
        `The clip "${shot.media}" is frozen (or ends and holds its last frame) from source frame ${a}. Set the shot's "from" to a frame where the clip moves, or shorten shot ${shot.id} so that it ends before the freeze, or use another clip.`,
        run.at, shot.id);
    }
  }

  // ── what the footage alone would show ──
  const pictures = new Map<number, Promise<Picture>>();
  const pictureAt = (frame: number) => {
    if (!pictures.has(frame)) pictures.set(frame, measure.picture(file, frame));
    return pictures.get(frame)!;
  };
  // The active mark of caption words: compose writes it as rows of property `active` on the word elements of a group (`<group>-w<k>`), one per word, on the frames
  // on which that word is the active one. A marked word is drawn in the mark's colour or on a pill, which the timeline does not give: it may show none of the fill.
  const marks = timeline.animations.filter((a) => a.property === 'active');
  const items = [
    ...timeline.texts.map((t) => ({ element: t.element, label: `text "${t.copy}"`, rect: t.rect, colour: t.colour, rest: t.rest, at: t.at, for: t.for, words: 0, marks: [] as { at: number; for: number }[] })),
    ...timeline.captions.map((c) => ({ element: c.element, label: `caption group ${c.group}`, rect: c.rect, colour: c.colour, rest: c.rest, at: c.at, for: c.for, words: c.words.length, marks: marks.filter((a) => a.element.startsWith(`${c.element}-`)) })),
  ];
  const elements = [...items, ...timeline.cards.map((c) => ({ element: c.element, rect: c.rect, at: c.at, for: c.for }))];
  const on = (e: { at: number; for: number }, f: number) => e.at <= f && f < e.at + e.for;
  const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  /** An element's rect with room for what leaves it: an outline, a shadow, the overshoot of a pop. */
  const roomy = (r: Rect): Rect => {
    const m = Math.ceil(ELEMENT_MARGIN * r.height);
    return { x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m };
  };
  /**
   * The footage under output frame `f` as the canvas shows it, when one shot fills the frame untouched and its source can be read,
   * and how much of the render outside every element differs from it. `certain`: the place of the footage is known exactly
   * (no crop, no zoom around a focus the timeline does not carry). null: nothing to compare with on that frame.
   */
  interface Under { picture: Picture; plain: Plain; unmatched: number; certain: boolean }
  const unders = new Map<number, Promise<Under | null>>();
  const underAt = (f: number): Promise<Under | null> => {
    if (!unders.has(f)) {
      unders.set(f, (async (): Promise<Under | null> => {
        const plain = plainShot(timeline, f);
        const path = plain ? sources?.[plain.shot.media] : undefined;
        if (!plain || !path || f >= facts.frames) return null;
        let source: Picture;
        try { source = await measure.picture(path, plain.source); } catch (e) { if (e instanceof MediaError) return null; throw e; }
        const focus = (plain.shot as { focus?: [number, number] }).focus;          // not in the timeline today (contract change request): without it the centre is assumed
        const sameShape = Math.abs(source.width * height - source.height * width) < Math.max(source.width, source.height);   // covering the canvas cuts nothing off
        const picture = placed(source, width, height, plain.scale, focus ?? [50, 50]);
        const masks = elements.filter((e) => on(e, f)).map((e) => roomy(e.rect));
        const read = readOver(await pictureAt(f), picture, { x: 0, y: 0, width, height }, { r: 0, g: 0, b: 0 }, masks, MATCH_STEP);
        if (read.area * MATCH_STEP * MATCH_STEP < MATCH_MIN_AREA * width * height) return null;      // the elements cover nearly all of the picture
        return { picture, plain, unmatched: read.drawn / read.area, certain: focus !== undefined || (sameShape && plain.scale === 1) };
      })());
    }
    return unders.get(f)!;
  };
  const percent = (share: number) => `${(100 * share).toFixed(share < 0.1 ? 1 : 0)} %`;

  // ── the footage: each shot shows the source frame the timeline says ──
  const told = new Set(issues.filter((i) => i.code === 'black-frames' || i.code === 'frozen-frames').map((i) => i.target));
  for (const shot of timeline.shots) {
    if (!sources?.[shot.media] || told.has(shot.id)) continue;
    // the shot's last untouched frame: a clip that froze or ran out differs most there
    const plainOf = (f: number) => f < facts.frames && plainShot(timeline, f)?.shot === shot;
    const frames = span(shot.at, shot.for);
    const last = frames.findLast(plainOf);
    if (last === undefined || anyBlack.has(last)) continue;
    const under = await underAt(last);
    if (!under || !under.certain || under.unmatched <= FOOTAGE_MATCH_SHARE) continue;
    const first = frames.find(plainOf)!;
    const start = first === last ? null : await underAt(first);
    const n = under.plain.source;
    const differs = `${when(last)} should show source frame ${n} of "${shot.media}", but ${percent(under.unmatched)} of the picture outside the texts differs from it`;
    if (start !== null && start.unmatched <= FOOTAGE_MATCH_SHARE) {
      tell('wrong-footage', 'error', `Shot ${shot.id} starts on its footage and leaves it: ${differs} (its first frame matches). The clip froze, ran out or skipped in the render.`,
        `Run \`viraleditor probe <file>\` on the file of edit.media.${shot.media}: it must have at least ${shot.from + shot.for + shot.tail} frames at ${fps} fps and keep moving up to source frame ${n} (a clip that ends early holds its last frame). Shorten shot ${shot.id}, lower its "from", or use a longer clip; then render again.`,
        last, shot.id);
    } else {
      tell('wrong-footage', 'error', `Shot ${shot.id} does not show its footage: ${differs}. Another file was rendered in its place, or the file changed after the edit was written.`,
        `Check that edit.media.${shot.media}.file is the clip meant for shot ${shot.id} and that the file in the assets folder is that clip (\`viraleditor probe <file>\` shows its size and length), and that the shot's "from" (${shot.from}) is the source frame it should start on; then render again.`,
        last, shot.id);
    }
  }

  // ── text ──
  for (const item of items) {
    const middle = item.rest.at + Math.floor(item.rest.for / 2);
    if (middle >= facts.frames) continue;
    const fill = parseColour(item.colour);
    // With the sources in hand the footage is taken away: on the rest frame nearest the middle where one shot fills the picture untouched and the render shows that footage.
    let frame = middle;
    let under: Under | null = null;
    if (sources) {
      const order = span(0, item.rest.for).map((k) => middle + (k % 2 === 1 ? (k + 1) / 2 : -k / 2)).filter((f) => f >= item.rest.at && f < item.rest.at + item.rest.for && f < facts.frames);
      const candidate = order.find((f) => plainShot(timeline, f) !== null);
      const found = candidate === undefined ? null : await underAt(candidate);
      if (found && found.unmatched <= FOOTAGE_MATCH_SHARE) { frame = candidate!; under = found; }
    }
    const picture = await pictureAt(frame);
    const reading = readInk(picture, item.rect, fill);
    const needed = Math.max(INK_MIN_PIXELS, INK_MIN_SHARE * reading.area);
    const check = 'Run `viraleditor check <edit.json> --deep` and render again. If it persists, the element is hidden, off screen or under another layer: check its box, its start and end frames, and that the font has every character of the copy.';
    let drawn: OverReading | null = null;               // what lies over the footage in the rect, when the footage could be compared
    let compared = true;                                // false: neither the footage nor a frame without the text was there to compare with
    const missing = () => tell('text-missing', 'error', `Nothing in the rect of ${item.label} (${item.element}) on ${when(frame)} shows the text colour ${item.colour} beyond what the footage has by itself (${reading.ink} of ${reading.area} pixels). The text did not render.`, check, frame, item.element);
    // Too little of the fill: the text did not render, unless a word of the caption group is marked on this frame and drawn in the mark, and at most one word is left
    // in the fill (a group of one word shows no fill at all; one other word may be as short as "I"; two or more show the fill plainly). Then only the footage can
    // tell, by what lies over it whatever its colour; where the footage cannot be compared the group cannot be verified.
    const faint = reading.ink < needed;
    const lit = item.marks.filter((m) => on(m, frame)).length;
    if (faint && !(lit > 0 && item.words - lit <= 1)) { missing(); continue; }
    const unverifiable = (why: string) => tell('text-unverified', 'warning', `${item.label} (${item.element}) could not be verified on ${when(frame)}: one of its words is the active word there and is drawn in the active mark (its colour, or on a pill), which the timeline does not give, and the rest shows the fill ${item.colour} on ${reading.ink} of ${reading.area} pixels only; ${why}.`,
      `Look at frame ${frame} of the render.${sources ? '' : ' Or run the check with the source clips: `viraleditor inspect <mp4> --timeline <timeline.json> --edit <edit.json>` (what `render` does by itself) sees what lies over the footage, whatever its colour.'}`, frame, item.element);
    if (faint && !under) { unverifiable(sources ? 'the footage under it could not be compared on any frame of its rest (a transition, a window or a moved shot is there, or the render does not show the source)' : 'without the source clips nothing tells it from the footage'); continue; }
    if (under) {
      // What lies over the footage in the rect: letters where the footage has another colour, their outline or plate where it has the text's own. Footage that moves, and a text with no frame of its shot without it, change nothing here.
      const others = elements.filter((e) => e.element !== item.element && on(e, frame) && meets(e.rect, item.rect)).map((e) => e.rect);
      const over = readOver(picture, under.picture, item.rect, fill, others);
      drawn = over;
      const attributable = over.area >= OVER_MIN_AREA * reading.area;
      if (attributable && over.drawn < Math.max(INK_MIN_PIXELS, INK_MIN_SHARE * over.area)) {
        tell('text-missing', 'error', `Nothing in the rect of ${item.label} (${item.element}) on ${when(frame)} lies over the footage: ${over.drawn} of ${over.area} pixels differ from source frame ${under.plain.source} of "${under.plain.shot.media}" (a text adds at least ${Math.ceil(Math.max(INK_MIN_PIXELS, INK_MIN_SHARE * over.area))}). The text did not render, or it has the footage's own colour ${item.colour} and nothing around it, so that nobody can see it.`,
          `If the footage under ${item.element} is close to ${item.colour}: add an outline (style.outline, about 0.06 em, in a colour far from ${item.colour}) or a plate (style.plate) to its style, or pick another fill. Otherwise the element did not render: ${check.charAt(0).toLowerCase()}${check.slice(1)}`, frame, item.element);
        continue;
      }
      if (faint && !attributable) { unverifiable('other elements cover most of its rect, so what lies over the footage there cannot be told to be it'); continue; }
    } else {
      // Without the footage: the same rect on a frame of the same shot where neither this text nor another element in the rect is on screen (the one before `at`, else the one after the end; the frame before a cut belongs to another picture, the frame before a caption group shows the group before it).
      // Known limit: a text with no such frame (it covers its whole shot) is judged by the ink share alone, and missing text over bright footage can pass; with `sources` the rule above has no such limit.
      const home = shotAt(frame);
      const free = (f: number) => f >= 0 && f < facts.frames && home !== undefined && f >= home.at && f < home.at + home.for + home.tail && !on(item, f)
        && !items.some((o) => o !== item && on(o, f) && meets(o.rect, item.rect));
      const emptyFrame = free(item.at - 1) ? item.at - 1 : free(item.at + item.for) ? item.at + item.for : null;
      compared = emptyFrame !== null;
      if (emptyFrame !== null) {
        const empty = readInk(await pictureAt(emptyFrame), item.rect, fill);
        if (empty.ink < INK_BACKGROUND_SHARE * empty.area) {
          // The footage's own change over the same gap: a second frame without the text, as far from the first as the rest frame is, on the other side. What the footage does by itself in that time it may have done under the text too.
          const far = emptyFrame + (emptyFrame - frame);
          const other = free(far) ? readInk(await pictureAt(far), item.rect, fill) : null;
          const own = other ? { ink: Math.abs(empty.ink - other.ink), connected: Math.abs(empty.connected - other.connected) } : { ink: 0, connected: 0 };
          // Either measure may show the text: connected ink (strokes, immune to a dark outline that covers specks) or raw ink (1 px diagonal or curved hairlines have no orthogonal neighbours).
          // Raw ink must gain more than the footage's own flicker (3 sigma of a count of scattered specks, a Poisson assumption for codec noise), not a factor: a sparse hairline over specky footage is a small share of the specks.
          const rawNeeded = Math.max(needed, RAW_GROWTH_SIGMAS * Math.sqrt(empty.ink));
          const grownBy = (sign: 1 | -1) =>
            (reading.connected - empty.connected + sign * own.connected >= needed && reading.connected + sign * own.connected >= INK_GROWTH * empty.connected)
            || reading.ink - empty.ink + sign * own.ink >= rawNeeded;
          if (!grownBy(1)) { missing(); continue; }                    // even with the footage's own change on its side the text colour did not grow
          if (!grownBy(-1)) {
            tell('text-unverified', 'warning', `${item.label} (${item.element}) could not be verified on ${when(frame)}: the footage in its rect changes by itself as much as the text would add (${own.ink} pixels of the colour ${item.colour} between frames ${Math.min(emptyFrame, far)} and ${Math.max(emptyFrame, far)}, which do not have the text; frame ${frame} has ${reading.ink - empty.ink} more than frame ${emptyFrame}).`,
              `Look at frame ${frame} of the render. Or run the output check with the source clips (\`viraleditor inspect <mp4> --timeline <timeline.json> --edit <edit.json>\`, which \`render\` does by itself): it takes the footage away and sees the text itself.`, frame, item.element);
            continue;
          }
        }
      }
    }
    // A marked group with too little fill (seen above by what lies over the footage). The mark's colour is not in the timeline, so it is read from the render: the colour most of
    // what lies over the footage has, judged like a fill (ink, ring, contrast). Known limit: a word whose mark colour is the footage's own and which has no edge or plate at
    // all shows nothing over the footage and is text-missing; one with an edge is judged by the edge.
    let judged = reading;
    let shown = item.colour;
    if (faint) {
      const mark = drawn?.colour;
      if (!mark) continue;
      judged = readInk(picture, item.rect, mark);
      shown = toHex(mark);
    }
    // no ring around thin text (strokes of 3 px or less have no solid ink, and the fallback ring found nothing): nothing to measure, no issue
    if (!judged.solid && judged.ring < RING_MIN_PIXELS) continue;
    const ratio = judged.ring < RING_MIN_PIXELS || judged.contrast === null ? 1 : judged.contrast;
    const colourOf = faint ? `the active word (drawn in about ${shown}, read from the render)` : `${item.label} (${item.element})`;
    if (ratio < MIN_CONTRAST && !compared) {
      // The text's colour is in the rect, but nothing says it is the text: bright footage reads the same, with a soft edge (a low contrast against what is around it).
      tell('text-unverified', 'warning', `${item.label} (${item.element}) could not be verified on ${when(frame)}: what has the colour ${shown} in its rect reads ${ratio.toFixed(1)} : 1 against what is around it, and the text is on screen for its whole shot, so no frame without it can be compared. Either the text did not render and the footage itself has that colour, or it rendered and is hard to read.`,
        `Look at frame ${frame} of the render. Or run the output check with the source clips (\`viraleditor inspect <mp4> --timeline <timeline.json> --edit <edit.json>\`, which \`render\` does by itself): it takes the footage away and sees the text itself. If the text is there, add an outline (style.outline, about 0.06 em, in a colour far from ${shown}) or a plate (style.plate) to the style of ${item.element}.`, frame, item.element);
    } else if (ratio < MIN_CONTRAST) {
      tell('low-contrast', 'warning', `${colourOf} has a contrast of ${ratio.toFixed(1)} : 1 against the footage around its letters on ${when(frame)}; at least ${MIN_CONTRAST} : 1 is needed to read it.`,
        `Add an outline (style.outline, about 0.06 em, in a colour far from ${shown}) or a plate (style.plate) to the style of ${item.element}${faint ? ' (for the active word: the active mark of the captions)' : ''}, or pick a text colour that differs more from the footage.`, frame, item.element);
    }
  }

  // ── sound ──
  if (wantsSound && facts.sound) {
    const loud = await measure.loudness(file);
    if (loud) {
      if (loud.integrated < MIX_SILENT_LUFS) {
        tell('silent', 'error', `The sound of the render is silent (${lu(loud.integrated)} LUFS), although the timeline has sound.`,
          'Check the gain of the music and sound effects in edit.audio (0 mutes them), that their files are not silent, and that "from" does not start past the end of the file. Then render again.', null, file);
      } else {
        const target = timeline.master?.lufs ?? null;
        const diff = target === null ? 0 : loud.integrated - target;
        const quiet = target === null ? loud.integrated < LUFS_FLOOR_NO_MASTER : diff < -LUFS_TOLERANCE;
        const high = target === null ? loud.integrated > LUFS_CEILING_NO_MASTER : diff > LUFS_TOLERANCE;
        const against = target === null ? `the range ${LUFS_FLOOR_NO_MASTER} … ${LUFS_CEILING_NO_MASTER} LUFS` : `the target ${target} LUFS (within ${LUFS_TOLERANCE} LU)`;
        if (quiet) tell('too-quiet', 'warning', `The sound is ${lu(loud.integrated)} LUFS, under ${against}.`, 'Raise the gain of the music and effects in edit.audio, and keep edit.audio.master on so that the loudness pass can bring the mix to its target.', null, file);
        if (high) tell('too-loud', 'warning', `The sound is ${lu(loud.integrated)} LUFS, over ${against}.`, 'Lower the gain of the music and effects in edit.audio, and keep edit.audio.master on so that the loudness pass can bring the mix to its target.', null, file);
        if (loud.truePeak > TRUE_PEAK_MAX) {
          tell('clipping', 'error', `The true peak of the sound is ${lu(loud.truePeak)} dBTP, over ${TRUE_PEAK_MAX} dBTP: the sound clips.`,
            'Lower the gain of the loudest track in edit.audio (music gain or a sound effect gain) until the mix peaks lower, and keep edit.audio.master on with a "peak" of -1. Then render again.', null, file);
        }
      }
    }
  }
  return issues;
}
