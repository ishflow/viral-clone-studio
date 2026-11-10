// What timeline.json must say, worked out from edit.json alone (not from compose): the frames of shots, transitions,
// windows, texts, caption words and cards, and that no list the edit fills is empty. The defaults are the ones the edit
// format documents (src/edit/types.ts comments, design §3, §4.1), written here again on purpose: a default that compose
// gets wrong is caught. A rule of compose that the format does not state (how words are grouped, how a text wraps) is
// checked only by what must hold whatever the rule is.
import type { Timeline } from '../edit/timeline.ts';
import type { Edit } from '../edit/types.ts';

type Motion = { kind: string; frames?: number };
const MOTION_FRAMES: Record<string, number> = { none: 0, fade: 6, pop: 8, slide: 8, blur: 8 };
const TRANSITION_FRAMES: Record<string, number> = { crossfade: 8, push: 10, whip: 8, zoom: 8, flash: 6, dip: 12 };
/** Enter / exit of a text by the style it names when it gives none (§4.1); any other style: fade 6 / fade 6. */
const TEXT_PRESETS: Record<string, { enter: Motion; exit: Motion }> = {
  hook: { enter: { kind: 'pop', frames: 8 }, exit: { kind: 'fade', frames: 6 } },
  label: { enter: { kind: 'fade', frames: 6 }, exit: { kind: 'fade', frames: 6 } },
  tag: { enter: { kind: 'pop', frames: 6 }, exit: { kind: 'fade', frames: 6 } },
  caption: { enter: { kind: 'pop', frames: 5 }, exit: { kind: 'none' } },
};
const CARD_DEFAULT: Motion = { kind: 'pop', frames: 8 };
const CAPTION_ENTER: Motion = { kind: 'pop', frames: 5 };
const CAPTION_HOLD = 12;
const WINDOW_FRAMES = 10;

const framesOf = (m: Motion): number => (m.kind === 'none' ? 0 : m.frames ?? MOTION_FRAMES[m.kind] ?? 0);
const words = (s: string) => s.split(/\s+/).filter((w) => w !== '');

/** Every way timeline.json differs from what the edit says, one line each; empty when it says the same. */
export function promiseErrors(edit: Edit, t: Timeline): string[] {
  const out: string[] = [];
  const same = (what: string, want: unknown, got: unknown) => { if (JSON.stringify(want) !== JSON.stringify(got)) out.push(`${what}: edit says ${JSON.stringify(want)}, timeline says ${JSON.stringify(got)}`); };

  same('canvas', [edit.frames, edit.canvas.fps, edit.canvas.width, edit.canvas.height], [t.frames, t.fps, t.width, t.height]);

  // ── shots and transitions ──
  same('shot ids', edit.shots.map((s) => s.id), t.shots.map((s) => s.id));
  edit.shots.forEach((s, i) => {
    const row = t.shots.find((x) => x.id === s.id);
    if (!row) return;
    same(`shot ${s.id} at/for/from/media/kind`, [s.at, s.for, s.from ?? 0, s.media, edit.media[s.media]?.kind], [row.at, row.for, row.from, row.media, row.kind]);
    if (row.tail < 0) out.push(`shot ${s.id}: tail ${row.tail} < 0`);
    const tr = t.transitions.filter((x) => x.to === s.id);
    if (i === 0) { if (tr.length > 0) out.push(`shot ${s.id}: the first shot has a transition into it`); return; }
    if (tr.length !== 1) { out.push(`shot ${s.id}: the timeline has ${tr.length} transitions into it`); return; }
    const kind = s.in?.kind ?? 'cut';                // a cut is a row too, of 0 frames
    const frames = kind === 'cut' ? 0 : (s.in as { frames?: number }).frames ?? TRANSITION_FRAMES[kind];
    same(`transition into ${s.id} kind/from/cut/for`, [kind, edit.shots[i - 1]!.id, s.at, frames], [tr[0]!.kind, tr[0]!.from, tr[0]!.cut, tr[0]!.for]);
  });

  // ── windows ──
  const windows = edit.shots.flatMap((s) => (s.windows ?? []).map((w) => ({ shot: s.id, w })));
  if (windows.length > 0 && t.windows.length === 0) out.push(`windows: the edit has ${windows.length}, the timeline none`);
  same('window count', windows.length, t.windows.length);
  for (const { shot, w } of windows) {
    const row = t.windows.find((x) => x.shot === shot && x.at === w.at);
    if (!row) { out.push(`window of ${shot} at ${w.at}: not in the timeline`); continue; }
    const swaps = w.swaps ?? [];
    const starts = [w.at, ...swaps.map((x) => x.at)];
    const pictures = starts.map((at, k) => ({ behind: k === 0 ? w.behind : swaps[k - 1]!.behind, at, for: (starts[k + 1] ?? w.at + w.for) - at }));
    same(`window of ${shot} at ${w.at} for/behind/frames/pictures`, [w.for, w.behind, w.frames ?? WINDOW_FRAMES, pictures], [row.for, row.behind, row.frames, row.pictures.map((p) => ({ behind: p.behind, at: p.at, for: p.for }))]);
  }

  // ── texts ──
  const texts = edit.texts ?? [];
  if (texts.length > 0 && t.texts.length === 0) out.push(`texts: the edit has ${texts.length}, the timeline none`);
  same('text ids', [...new Set(texts.map((x) => x.id))], [...new Set(t.texts.map((x) => x.id))]);
  for (const x of texts) {
    const rows = t.texts.filter((r) => r.id === x.id).sort((a, b) => a.line - b.line);
    if (rows.length === 0) continue;
    const preset = TEXT_PRESETS[x.style] ?? { enter: { kind: 'fade', frames: 6 }, exit: { kind: 'fade', frames: 6 } };
    const enter = framesOf(x.enter ?? preset.enter); const exit = framesOf(x.exit ?? preset.exit);
    const upper = edit.styles?.[x.style]?.upper ?? x.style === 'caption';
    const copy = upper ? x.copy.toLocaleUpperCase(edit.language) : x.copy;
    same(`text ${x.id} words`, words(copy), rows.flatMap((r) => words(r.copy)));
    rows.forEach((r, k) => same(`text ${x.id} line ${r.line} at/for/rest`, [x.at, x.for, x.at + enter + k * (x.stagger ?? 0), x.at + x.for - exit], [r.at, r.for, r.rest.at, r.rest.at + r.rest.for]));
  }

  // ── captions ──
  const cw = edit.captions?.words ?? [];
  if (cw.length > 0 && t.captions.length === 0) out.push(`captions: the edit has ${cw.length} words, the timeline no group`);
  if (cw.length > 0) {
    const style = edit.captions!.style ?? 'caption';
    const upper = edit.styles?.[style]?.upper ?? style === 'caption';
    const text = (s: string) => (upper ? s.toLocaleUpperCase(edit.language) : s);
    const flat = t.captions.flatMap((g) => g.words);
    same('caption words (index, text, at)', cw.map((w, i) => [i, text(w.text), w.at]), flat.map((w) => [w.index, w.text, w.at]));
    const hold = edit.captions!.group?.hold ?? CAPTION_HOLD;
    const enter = framesOf(edit.captions!.enter ?? CAPTION_ENTER);
    t.captions.forEach((g, n) => {
      const next = t.captions[n + 1];
      const last = g.words.at(-1);
      if (!last) { out.push(`caption group ${g.group}: no word`); return; }
      const lastEdit = cw[last.index];
      const end = Math.min(next?.at ?? edit.frames, lastEdit ? lastEdit.at + lastEdit.for + hold : Infinity, edit.frames);
      same(`caption group ${g.group} at/end/rest`, [g.words[0]!.at, end, g.words[0]!.at + Math.min(enter, end - g.words[0]!.at - 1), end], [g.at, g.at + g.for, g.rest.at, g.rest.at + g.rest.for]);
      same(`caption group ${g.group} word ends`, g.words.map((w, k) => (g.words[k + 1]?.at ?? end)), g.words.map((w) => w.at + w.for));
      same(`caption group ${g.group} lines`, g.words.map((w) => w.text), g.lines.flatMap(words));
    });
  }

  // ── cards ──
  const cards = edit.cards ?? [];
  if (cards.length > 0 && t.cards.length === 0) out.push(`cards: the edit has ${cards.length}, the timeline none`);
  same('card ids', cards.map((c) => c.id), t.cards.map((c) => c.id));
  for (const c of cards) {
    const row = t.cards.find((x) => x.id === c.id);
    if (!row) continue;
    const enter = framesOf(c.enter ?? CARD_DEFAULT); const exit = framesOf(c.exit ?? CARD_DEFAULT);
    same(`card ${c.id} at/for/media/rest`, [c.at, c.for, c.media, c.at + enter, c.at + c.for - exit], [row.at, row.for, row.media, row.rest.at, row.rest.at + row.rest.for]);
  }
  return out;
}
