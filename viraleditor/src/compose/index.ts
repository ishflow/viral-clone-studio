// compose: an edit document and the facts of its media → a HyperFrames composition and its frame table (design §5, §7).
// Pure: the same input gives the same text; no clock, no file, no random number.
import { MASTER, stylesOf } from '../edit/presets.ts';
import { MORE_ISSUES, capped, parseEdit } from '../edit/schema.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { ComposeFacts, Edit } from '../edit/types.ts';
import { blurIssue, factsOf, validateParsed } from '../edit/validate.ts';
import { audioHtml } from './audio.ts';
import type { Build } from './build.ts';
import { captionsHtml, planCaptions } from './captions.ts';
import { checkFrames } from './check.ts';
import { cardHtml } from './cards.ts';
import { fontFiles, stylesheet } from './css.ts';
import type { StyleClass } from './css.ts';
import { ComposeError } from './error.ts';
import { shotsHtml } from './shots.ts';
import { planText, textHtml } from './texts.ts';
import { seconds } from './time.ts';
import { createTracks, tracksAfterShots } from './tracks.ts';

export { ComposeError } from './error.ts';
export { seconds } from './time.ts';

export interface Composition {
  html: string;            // index.html
  timeline: Timeline;      // timeline.json
  fonts: string[];         // the font files the HTML names, as paths inside the composition folder (assets/fonts/…)
  files: string[];         // the media files the HTML names (assets/…): writeComposition refuses a missing one
}

/**
 * Throws ComposeError with every issue of the document: its shape (schema), its rules and the facts of its media
 * (validate), and its texts and captions that do not fit. Nothing of the document reaches the output before all have
 * passed, and nothing else is ever thrown, whatever is passed as `facts`.
 */
export function compose(edit: Edit, facts: Record<string, ComposeFacts>): Composition {
  const parsed = parseEdit(edit);
  if (!parsed.ok) throw new ComposeError(parsed.issues);
  const doc = parsed.edit;
  const issues = validateParsed(doc, facts);
  // a list that was cut does not say everything that is wrong: nothing is fitted on top of it
  if (issues.at(-1)?.code === MORE_ISSUES) throw new ComposeError(issues);
  const styles = stylesOf(doc);

  // a text is fitted only when nothing it depends on is wrong; the others have their issue already
  const wrong = (path: string) => issues.some((issue) => issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`));
  const fittable = !wrong('canvas') && !wrong('styles') && !wrong('language');
  const texts = (doc.texts ?? []).map((text, i) => (fittable && !wrong(`texts[${i}]`) ? planText(doc, styles, text, i, issues) : null));
  const captions = fittable && !wrong('captions') ? planCaptions(doc, styles, issues) : null;
  // the fit may have made more lines and groups than validate could count: the blurred elements once more, now exactly
  const blur = issues.length === 0 ? blurIssue(doc, texts.map((plan) => plan!.lines.length), captions?.groups.filter((group) => group.end - group.at > 1).length ?? 0) : null;
  if (blur) issues.push(blur);
  if (issues.length > 0) throw new ComposeError(capped(issues));

  const { width, height, fps } = doc.canvas;
  const master = doc.audio?.master;
  const timeline: Timeline = {
    fps, frames: doc.frames, width, height,
    shots: [], transitions: [], windows: [], texts: [], captions: [], cards: [], audio: [], animations: [],
    master: master === false ? null : { lufs: master?.lufs ?? MASTER.lufs, peak: master?.peak ?? MASTER.peak },
    checkAt: [],
  };
  const b: Build = { edit: doc, facts: factsOf(doc, facts), styles, fps, canvas: doc.canvas, tracks: createTracks(tracksAfterShots(doc.shots.length)), timeline, files: new Set() };

  const layerZ = Math.max(100, doc.shots.length + 1);                       // colour layers above every shot, overlays above those
  const shots = shotsHtml(b, layerZ);
  const overlays = [
    ...(doc.cards ?? []).map((card) => cardHtml(b, card)),
    ...texts.flatMap((plan) => textHtml(b, plan!)),
    ...(captions ? captionsHtml(b, captions) : []),
  ];
  const audio = audioHtml(b);
  timeline.checkAt = checkFrames(timeline);

  const classes = new Map<string, StyleClass>();
  for (const plan of texts) classes.set(plan!.cls.name, plan!.cls);
  if (captions) classes.set(captions.cls.name, captions.cls);              // last: the caption's class carries its custom properties
  const used = [...classes.values()];

  const html = [
    '<!doctype html>',
    `<html lang="${doc.language}">`,
    '  <head>',
    '    <meta charset="UTF-8" />',
    `    <meta name="viewport" content="width=${width}, height=${height}" />`,
    '    <title>viraleditor</title>',
    '    <style>',
    stylesheet(doc.canvas, doc.background ?? '#000000', used),
    '    </style>',
    '  </head>',
    '  <body>',
    `    <div id="root" data-composition-id="main" data-start="0" data-width="${width}" data-height="${height}" data-fps="${fps}" data-duration="${seconds(doc.frames, fps)}" data-no-timeline>`,
    ...shots,
    `      <div id="overlays" class="ve-layer" style="z-index:${layerZ + 100}">`,
    ...overlays,
    '      </div>',
    ...audio,
    '    </div>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');

  return {
    html, timeline,
    fonts: [...new Set(used.map((cls) => cls.style.font))].sort().flatMap(fontFiles),
    files: [...b.files].sort(),
  };
}
