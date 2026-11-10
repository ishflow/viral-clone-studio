// Text lines (design §5.4, §5.8): the copy is fitted at compose time, then every line is one timed leaf with its final
// pixel size and box. Nothing is left to the browser's line breaking.
import { motionFrames, textMotion } from '../edit/presets.ts';
import type { Rect } from '../edit/timeline.ts';
import type { Edit, EditIssue, EditText, TextStyle } from '../edit/types.ts';
import { fitText } from '../fit/index.ts';
import type { FitResult, FitStyle } from '../fit/index.ts';
import { enterMoves, exitMoves, join, movesStyle } from './animation.ts';
import { escapeHtml, note, rgb, timing, words } from './build.ts';
import type { Build } from './build.ts';
import { styleClass } from './css.ts';
import type { StyleClass } from './css.ts';
import { rectOf } from './layout.ts';

export interface TextPlan { text: EditText; cls: StyleClass; lines: string[]; rect: Rect; top: number }

export function fitStyleOf(style: TextStyle): FitStyle {
  return { font: style.font, weight: style.weight, size: style.size, tracking: style.tracking, leading: style.leading };
}

/** The characters as the fit names them: a visible one in quotes, an invisible one by its code point (U+200B). */
export function glyphIssue(path: string, font: string, characters: string[]): EditIssue {
  const list = characters.map((ch) => (/^U\+[0-9A-F]+$/.test(ch) ? ch : `"${ch}"`)).join(', ');
  return {
    code: 'text-glyph', path,
    message: `${path} has characters the font ${font} has no width for: ${list}`,
    fix: `remove them from ${path}; Latin letters (Latin, Latin-1, Latin Extended-A), digits, common punctuation and emoji are covered, other scripts are not`,
  };
}

function tooLongIssue(path: string, text: EditText, style: TextStyle, canvas: { width: number; height: number }, fit: Extract<FitResult, { code: 'text-too-long' }>, lines: number): EditIssue {
  const smallest = `at the smallest size allowed (${fit.smallest} px; the style's size is ${style.size} px, "shrink" ${text.shrink ?? 0.6})`;
  const share = (pixels: number, of: number) => Math.ceil((pixels / of) * 1000) / 10;
  const shrink = (text.shrink ?? 0.6) > 0.5 ? `, or lower ${path}.shrink (not below 0.5)` : '';
  switch (fit.reason) {
    case 'word': {
      const more = Math.ceil((fit.needed - fit.available) / 0.98) + 1;
      const widen = fit.needed / 0.98 < canvas.width ? `, or widen ${path}.box by at least ${more} px (${share(more, canvas.width)} % of the canvas width)` : '';
      return {
        code: 'text-too-long', path: `${path}.copy`,
        message: `${path}.copy does not fit: ${smallest} its longest word needs ${Math.ceil(fit.needed)} px, the box gives ${Math.floor(fit.available)} px of width`,
        fix: `shorten that word${widen}${shrink}`,
      };
    }
    case 'lines':
      return {
        code: 'text-too-long', path: `${path}.copy`,
        message: `${path}.copy does not fit: ${smallest} it needs ${fit.needed} lines, ${fit.available} ${fit.available === 1 ? 'is' : 'are'} allowed`,
        fix: `${fit.needed <= 4 && fit.needed > lines ? `raise ${path}.lines to ${fit.needed}, or ` : ''}shorten the copy${shrink}, or widen ${path}.box`,
      };
    case 'height': {
      const more = Math.ceil(fit.needed - fit.available);
      return {
        code: 'text-too-long', path: `${path}.copy`,
        message: `${path}.copy does not fit: ${smallest} its lines need ${Math.ceil(fit.needed)} px of height, the box is ${Math.floor(fit.available)} px high`,
        fix: `make ${path}.box taller by at least ${more} px (${share(more, canvas.height)} % of the canvas height)${lines > 1 ? `, or lower ${path}.lines` : ''}${shrink}`,
      };
    }
  }
}

/** How far apart the lines of one text stand: a line height, and with a plate also the padding above and below it, so the plates of two lines do not cover each other. */
export function linePitch(cls: StyleClass): number {
  const plate = cls.style.plate;
  return cls.lineHeight + (plate ? 2 * Math.ceil(plate.padY * cls.size) : 0);
}

/** Fits one text into its box. An issue is added, and null returned, when it cannot be shown as the document asks. */
export function planText(edit: Edit, styles: Record<string, TextStyle>, text: EditText, index: number, issues: EditIssue[]): TextPlan | null {
  const path = `texts[${index}]`;
  const style = styles[text.style]!;
  const copy = style.upper ? text.copy.toLocaleUpperCase(edit.language) : text.copy;       // R10: never CSS text-transform
  const rect = rectOf(text.box, edit.canvas);
  // a plate is wider and taller than its line: the text is fitted into what is left of the box
  const inset = style.plate ? { x: Math.ceil(style.plate.padX * style.size), y: Math.ceil(style.plate.padY * style.size) } : { x: 0, y: 0 };
  const forced = copy.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '').length;
  const lines = text.lines ?? (forced > 1 ? Math.min(4, forced) : 2);
  const room = { width: rect.width - 2 * inset.x, height: rect.height - 2 * inset.y };
  const fit = fitText(copy, { ...fitStyleOf(style), plateY: style.plate?.padY }, room, { lines, shrink: text.shrink ?? 0.6 });
  if (!fit.ok) {
    issues.push(fit.code === 'text-glyph' ? glyphIssue(`${path}.copy`, style.font, fit.characters) : tooLongIssue(path, text, style, edit.canvas, fit, lines));
    return null;
  }
  if (fit.lines.length === 0) {                                                              // nothing visible is left of the copy
    issues.push({ code: 'text-empty', path: `${path}.copy`, message: `${path}.copy has no visible character`, fix: `write the words to show into ${path}.copy, or remove ${path}` });
    return null;
  }
  const motion = textMotion(text, edit.styles);
  const enter = motionFrames(motion.enter);
  const exit = motionFrames(motion.exit);
  const spread = enter > 0 ? motion.stagger * (fit.lines.length - 1) : 0;
  if (enter + exit < text.for && enter + exit + spread >= text.for) {                       // without the stagger: validate has said it
    issues.push({
      code: 'animation-too-long', path,
      message: `${path} is on screen for ${text.for} frames; its enter takes ${enter}, its exit ${exit}, and its ${fit.lines.length} lines start ${motion.stagger} frames apart: ${enter} + ${exit} + ${motion.stagger} × ${fit.lines.length - 1} = ${enter + exit + spread} leaves no frame on which the last line stands still`,
      fix: `set ${path}.stagger to ${Math.max(0, Math.floor((text.for - enter - exit - 1) / (fit.lines.length - 1)))}, or lengthen ${path}.for to ${enter + exit + spread + 1} or more`,
    });
    return null;
  }
  const cls = styleClass(text.style, style, fit.size);
  const pitch = linePitch(cls);
  const free = room.height - ((fit.lines.length - 1) * pitch + cls.lineHeight);
  const valign = text.valign ?? 'middle';
  const top = rect.y + inset.y + (valign === 'top' ? 0 : valign === 'bottom' ? free : Math.round(free / 2));
  return { text, cls, lines: fit.lines, rect, top };
}

/** One timed leaf per line. Fills timeline.texts. */
export function textHtml(b: Build, plan: TextPlan): string[] {
  const { text, cls, rect } = plan;
  const motion = textMotion(text, b.edit.styles);
  const clock = { base: text.at, fps: b.fps, canvas: b.canvas };
  const end = text.at + text.for;
  const enterFrames = motionFrames(motion.enter);
  return plan.lines.map((line, k) => {
    const id = `${text.id}-${k + 1}`;
    const start = enterFrames > 0 ? text.at + motion.stagger * k : text.at;
    const moves = join(enterMoves(motion.enter, start, clock), exitMoves(motion.exit, end, clock));
    const top = plan.top + k * linePitch(cls);
    const restAt = start + enterFrames;
    note(b, id, moves.rows);
    b.timeline.texts.push({
      id: text.id, line: k + 1, element: id, copy: line, at: text.at, for: text.for,
      rect: { x: rect.x, y: top, width: rect.width, height: cls.lineHeight }, size: cls.size, colour: rgb(cls.style.fill),
      rest: { at: restAt, for: end - motionFrames(motion.exit) - restAt },
    });
    const content = cls.style.plate ? `<span class="ve-plate">${escapeHtml(line)}</span>` : escapeHtml(line);
    const classes = words('clip ve-line', moves.animations.length > 0 && 've-m', moves.blur && 've-mb', `ve-al-${cls.style.align}`, cls.name);
    return `        <div id="${id}" class="${classes}" ${timing(b, text.at, text.for)} data-track-index="${b.tracks.take(text.at, text.for)}" style="left:${rect.x}px;top:${top}px;width:${rect.width}px;height:${cls.lineHeight}px;${movesStyle(moves)}">${content}</div>`;
  });
}
