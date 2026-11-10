// Word-by-word captions (design §5.5, §12.5): the words are grouped and broken into lines here, from the metrics table;
// one timed element per group, the active word switched by animations on the word spans.
import { ACTIVE_POP, ACTIVE_SCALE, captionDefaults, motionFrames } from '../edit/presets.ts';
import type { Rect } from '../edit/timeline.ts';
import type { Edit, EditIssue, Frame, TextStyle } from '../edit/types.ts';
import { fitText, textWidth } from '../fit/index.ts';
import { enterMoves } from './animation.ts';
import { escapeHtml, note, rgb, timing, words as joined } from './build.ts';
import type { Build } from './build.ts';
import { endsGroup } from '../edit/groups.ts';
import { styleClass } from './css.ts';
import type { StyleClass } from './css.ts';
import { rectOf } from './layout.ts';
import { halfSeconds, seconds } from './time.ts';
import { fitStyleOf, glyphIssue } from './texts.ts';

const SAFETY = 0.98;          // as the text fit: the table has no kerning, so 2 % of the box width stays free
const WORD_PADDING = 0.28;    // em: .ve-w has 0.14 em of padding on each side
const UNBOUNDED = { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER };

interface Word { index: number; text: string; at: Frame; end: Frame; width: number }
export interface Group { words: Word[]; lines: Word[][]; at: Frame; end: Frame }
export interface CaptionPlan { groups: Group[]; cls: StyleClass; rect: Rect }

/** The words on at most `maxLines` lines no wider than `limit`: one line when it fits, else the most even two. Null: no way. */
function breakLines(words: Word[], space: number, grow: number, limit: number, maxLines: number): Word[][] | null {
  // the active word is drawn larger by `grow` of its own width; the widest word decides how far a line can reach
  const widthOf = (line: Word[]) => line.reduce((sum, w) => sum + w.width, 0) + space * (line.length - 1) + grow * Math.max(...line.map((w) => w.width));
  if (widthOf(words) <= limit) return [words];
  if (maxLines < 2) return null;
  let best: { lines: Word[][]; widest: number } | null = null;
  for (let k = 1; k < words.length; k++) {
    const lines = [words.slice(0, k), words.slice(k)];
    const widest = Math.max(...lines.map(widthOf));
    if (widest <= limit && (best === null || widest < best.widest)) best = { lines, widest };
  }
  return best?.lines ?? null;
}

/** Groups the caption words and breaks each group into lines. Issues are added, and null returned, when a word cannot be shown. */
export function planCaptions(edit: Edit, styles: Record<string, TextStyle>, issues: EditIssue[]): CaptionPlan | null {
  const captions = edit.captions;
  if (!captions || captions.words.length === 0) return null;
  const d = captionDefaults(captions);
  const style = styles[d.style]!;
  const cls = styleClass(d.style, style, style.size);
  const rect = rectOf(captions.box, edit.canvas);
  const fit = fitStyleOf(style);
  const before = issues.length;

  const maxLines = Math.min(d.lines, Math.floor(rect.height / cls.lineHeight));         // validate: the box holds at least one line
  const limit = rect.width * SAFETY;
  const grow = (d.active.kind === 'colour' ? d.active.scale ?? ACTIVE_SCALE : 1) - 1;
  const words: Word[] = captions.words.map((word, index) => {
    const path = `captions.words[${index}].text`;
    // the fit cleans a text (NFC, no zero-width characters) and measures it: a word is shown exactly as it was measured
    const measured = fitText(style.upper ? word.text.toLocaleUpperCase(edit.language) : word.text, fit, UNBOUNDED, { lines: 1, shrink: 1 });
    const text = measured.ok ? measured.lines[0] ?? '' : '';
    if (!measured.ok && measured.code === 'text-glyph') issues.push(glyphIssue(path, style.font, measured.characters));
    else if (text === '') issues.push({ code: 'text-empty', path, message: `${path} has nothing to show`, fix: `write the word into ${path}, or remove captions.words[${index}]` });
    const width = measured.ok && text !== '' ? measured.widths[0]! + WORD_PADDING * style.size : 0;
    if (width * (1 + grow) > limit) {
      const smaller = Math.floor((style.size * limit) / (width * (1 + grow)));
      const wider = Math.ceil(((width * (1 + grow)) / SAFETY / edit.canvas.width) * 1000) / 10;
      issues.push({
        code: 'caption-word-too-long', path,
        message: `captions.words[${index}] ("${text}") is ${Math.ceil(width * (1 + grow))} px wide in the style "${d.style}" (${style.size} px), the caption box allows ${Math.floor(limit)} px`,
        fix: `${wider <= 100 ? `widen captions.box to at least ${wider} % of the canvas width (right − left), or ` : ''}lower the size of the style "${d.style}" to ${smaller} px or less, or split the word`,
      });
    }
    return { index, text, at: word.at, end: word.at + word.for, width };
  });
  if (issues.length > before) return null;

  const space = textWidth(' ', fit, style.size) ?? 0;
  const groups: Group[] = [];
  let open: Word[] = [];
  const close = () => { if (open.length > 0) groups.push({ words: open, lines: breakLines(open, space, grow, limit, maxLines)!, at: open[0]!.at, end: 0 }); open = []; };
  for (const word of words) {
    const last = open.at(-1);
    if (last && (endsGroup(open.length, last, word, d) || breakLines([...open, word], space, grow, limit, maxLines) === null)) close();
    open.push(word);
  }
  close();
  // on screen until the next group begins, at most `hold` frames after its last word ends
  groups.forEach((group, g) => {
    const lastEnd = group.words.at(-1)!.end;
    group.end = Math.min(groups[g + 1]?.at ?? edit.frames, lastEnd + d.hold, edit.frames);
  });
  return { groups, cls, rect };
}

/** One timed element per group, inside #overlays. Fills timeline.captions. */
export function captionsHtml(b: Build, plan: CaptionPlan): string[] {
  const d = captionDefaults(b.edit.captions!);
  const { cls, rect } = plan;
  const active = d.active;
  const scale = active.kind === 'colour' ? active.scale ?? ACTIVE_SCALE : 1;
  const highlight = active.kind === 'colour' ? active.colour : active.kind === 'pill' ? active.text : undefined;
  // every group comes in the same way, so what its enter needs is in the caption's class, as are the colours of the active word
  cls.vars = [
    ...enterMoves(d.enter, 0, { base: 0, fps: b.fps, canvas: b.canvas }, { soft: true }).vars.map((v) => v.replace(':', ': ')),
    ...(highlight !== undefined ? [`--ve-active: ${highlight}`] : []),
    ...(active.kind === 'pill' ? [`--ve-pill: ${active.colour}`] : []),
    ...(active.kind === 'colour' ? [`--ve-pop-s: ${Number((scale + ACTIVE_POP).toFixed(4))}`, `--ve-hold-s: ${scale}`] : []),
  ];
  const align = cls.style.align === 'center' ? '' : `ve-cl-${cls.style.align}`;
  return plan.groups.map((group, g) => {
    const id = `cap-${g + 1}`;
    const length = group.end - group.at;
    const clock = { base: group.at, fps: b.fps, canvas: b.canvas };
    // a group shorter than its enter keeps one frame at rest: the words come from speech, their length is not the author's choice
    const enterFrames = Math.min(motionFrames(d.enter), length - 1);
    const moves = enterMoves(d.enter, group.at, clock, { frames: enterFrames, soft: true });
    note(b, id, moves.rows);
    const spans = (word: Word): string => {
      const k = group.words.indexOf(word);
      const until = group.words[k + 1]?.at ?? group.end;
      const len = `${seconds(until - word.at, b.fps)}s`;
      const delay = `${halfSeconds(word.at - group.at, b.fps)}s`;
      const colour = `ve-word-colour ${len} step-end ${delay} 1 normal none`;
      const animations = active.kind === 'colour' ? [colour, `ve-word-pop ${len} linear ${delay} 1 normal none`]
        : active.kind === 'pill' ? [`ve-word-pill ${len} step-end ${delay} 1 normal none`, ...(active.text !== undefined ? [colour] : [])] : [];
      const wordId = `${id}-w${k + 1}`;
      if (animations.length > 0) note(b, wordId, [{ property: 'active', at: word.at, for: until - word.at, from: 0, to: 1, ease: 'step', hold: 'none' }]);
      // the active word grows past its line: said to the layout check, as for media that scales (R11)
      const grows = active.kind === 'colour' ? ' data-layout-allow-overflow' : '';
      return `<span id="${wordId}" class="${joined('ve-w', animations.length > 0 && 've-m')}"${grows}${animations.length > 0 ? ` style="animation:${animations.join(', ')}"` : ''}>${escapeHtml(word.text)}</span>`;
    };
    b.timeline.captions.push({
      group: g + 1, element: id, at: group.at, for: length, rect, size: cls.size, colour: rgb(cls.style.fill),
      lines: group.lines.map((line) => line.map((w) => w.text).join(' ')),
      words: group.words.map((word, k) => ({ index: word.index, text: word.text, at: word.at, for: (group.words[k + 1]?.at ?? group.end) - word.at })),
      rest: { at: group.at + enterFrames, for: length - enterFrames },
    });
    const lines = group.lines.map((line) => `<span class="ve-cap-line">${line.map(spans).join(' ')}</span>`).join('');
    // the element is exactly as high as its lines and sits in the middle of the box on a whole pixel (R5): centred by
    // the browser, an odd rest of the height would put every line on a half pixel
    const height = group.lines.length * cls.lineHeight;
    const top = rect.y + Math.round((rect.height - height) / 2);
    const classes = joined('clip ve-cap', moves.animations.length > 0 && 've-m', moves.blur && 've-mb', align, cls.name);
    const animationText = moves.animations.length > 0 ? `animation:${moves.animations.join(', ')}` : '';
    return `        <div id="${id}" class="${classes}" ${timing(b, group.at, length)} data-track-index="${b.tracks.take(group.at, length)}" style="left:${rect.x}px;top:${top}px;width:${rect.width}px;height:${height}px;${animationText}">${lines}</div>`;
  });
}
