// Shots, the motion on them, the transitions between them and the windows (design §5.3).
// A transition lives on the untimed wrapper of a shot (clock: frame 0), a motion on the timed media element itself
// (clock: its own start). No timed element has a timed ancestor (R6).
import { MOTION, TRANSITION, WINDOW, motionScale, overlaps, tailOf, transitionFrames, transitionOf, windowPictures } from '../edit/presets.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { Ease, Frame, Frames, Motion, Shot, Side, Transition } from '../edit/types.ts';
import { animation, join, movesStyle, row, still } from './animation.ts';
import type { Moves } from './animation.ts';
import { fileOf, note, rgb, timing, words } from './build.ts';
import type { Build } from './build.ts';
import { px, windowRect } from './layout.ts';
import { seconds } from './time.ts';
import { shotTrack } from './tracks.ts';

/** Where the incoming picture of a push starts, in canvas sizes; the pictures travel to the side named. */
const START: Record<Side, readonly [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };
const share = (part: number): string => (part === 0 ? '0px' : `${part * 100}%`);

interface Picture { id: string; media: string; at: Frame; length: Frames; from: Frame; track: number; focus?: [number, number]; motion?: Motion; scaled?: boolean }

/** A timed <video> or <img>, with the motion on it. */
function picture(b: Build, p: Picture): string {
  const [fx, fy] = p.focus ?? [50, 50];
  let style = p.focus ? `object-position:${fx}% ${fy}%;` : '';
  if (p.motion) {
    const { from, to } = motionScale(p.motion);
    // push-in and pull-out span the whole time on screen; a punch-in starts on its own frame and stays
    const [at, length, ease]: [Frame, Frames, Ease] = p.motion.kind === 'punch-in'
      ? [p.motion.at, p.motion.frames ?? MOTION.punchFrames, 'out']
      : [p.at, p.length, p.motion.ease ?? 'linear'];
    style += `--ve-s0:${from};--ve-s1:${to};transform-origin:${fx}% ${fy}%;animation:${animation('ve-scale', at, length, ease, 'both', p.at, b.fps)}`;
    note(b, p.id, [row('scale', at, length, from, to, ease, 'both')]);
  }
  const common = words(`id="${p.id}"`, `class="${words('clip', p.motion && 've-m')}"`, (p.motion || p.scaled) && 'data-layout-allow-overflow', `src="${fileOf(b, p.media)}"`);
  const styled = style === '' ? '' : ` style="${style}"`;
  return b.edit.media[p.media]!.kind === 'video'
    ? `<video ${common} ${timing(b, p.at, p.length)} data-media-start="${seconds(p.from, b.fps)}" data-track-index="${p.track}" muted playsinline${styled}></video>`
    : `<img ${common} alt="" ${timing(b, p.at, p.length)} data-track-index="${p.track}"${styled} />`;
}

/** How a shot comes in: on its own wrapper, from frame `cut` on. */
function arrive(b: Build, transition: Transition, cut: Frame): Moves {
  const n = transitionFrames(transition);
  const { width: W, height: H } = b.canvas;
  switch (transition.kind) {
    case 'crossfade':
      return { vars: [], animations: [animation('ve-fade-in', cut, n, 'linear', 'backwards', 0, b.fps)], blur: false, rows: [row('opacity', cut, n, 0, 1, 'linear', 'backwards')] };
    case 'push': case 'whip': {
      const [x, y] = START[transition.to];
      const ease: Ease = transition.kind === 'whip' ? 'whip' : 'in-out';
      const move: Moves = {
        vars: [`--ve-in-x:${share(x)}`, `--ve-in-y:${share(y)}`], animations: [animation('ve-move-in', cut, n, ease, 'backwards', 0, b.fps)], blur: false,
        rows: [x !== 0 ? row('x', cut, n, x * W, 0, ease, 'backwards') : row('y', cut, n, y * H, 0, ease, 'backwards')],
      };
      if (transition.kind === 'push') return move;
      const blur = px(TRANSITION.whipBlur, W);
      return join(move, { vars: [`--ve-in-b:${blur}px`], animations: [animation('ve-blur-in', cut, n, 'whip', 'backwards', 0, b.fps)], blur: true, rows: [row('blur', cut, n, blur, 0, 'whip', 'backwards')] });
    }
    case 'zoom': {
      const scale = transition.scale ?? TRANSITION.zoomScale;
      const half = Math.ceil(n / 2);
      return { vars: [`--ve-in-s:${scale}`], animations: [animation('ve-scale-in', cut, half, 'out', 'backwards', 0, b.fps)], blur: false, rows: [row('scale', cut, half, scale, 1, 'out', 'backwards')] };
    }
    default: return still();
  }
}

/** How a shot gives way to the next one: on its own wrapper, around the frame `cut` on which the next shot starts. */
function leave(b: Build, transition: Transition, cut: Frame): Moves {
  const n = transitionFrames(transition);
  const { width: W, height: H } = b.canvas;
  switch (transition.kind) {
    case 'push': case 'whip': {
      const [x, y] = START[transition.to];
      const ease: Ease = transition.kind === 'whip' ? 'whip' : 'in-out';
      const move: Moves = {
        vars: [`--ve-out-x:${share(-x)}`, `--ve-out-y:${share(-y)}`], animations: [animation('ve-move-out', cut, n, ease, 'forwards', 0, b.fps)], blur: false,
        rows: [x !== 0 ? row('x', cut, n, 0, -x * W, ease, 'forwards') : row('y', cut, n, 0, -y * H, ease, 'forwards')],
      };
      if (transition.kind === 'push') return move;
      const blur = px(TRANSITION.whipBlur, W);
      return join(move, { vars: [`--ve-out-b:${blur}px`], animations: [animation('ve-blur-out', cut, n, 'whip', 'forwards', 0, b.fps)], blur: true, rows: [row('blur', cut, n, 0, blur, 'whip', 'forwards')] });
    }
    case 'zoom': {
      const scale = transition.scale ?? TRANSITION.zoomScale;
      const half = Math.floor(n / 2);
      if (half < 1) return still();
      return { vars: [`--ve-out-s:${scale}`], animations: [animation('ve-scale-out', cut - half, half, 'in', 'forwards', 0, b.fps)], blur: false, rows: [row('scale', cut - half, half, 1, scale, 'in', 'forwards')] };
    }
    default: return still();
  }
}

/** The windows of a shot: what its wrapper does, and the pictures behind it (each a wrapper of its own, before the shot's). */
function windows(b: Build, shot: Shot, index: number): { moves: Moves; behind: string[] } {
  // in the order of their frames: of the animations of one list, the later one wins on every frame after it has started
  const list = [...(shot.windows ?? [])].sort((a, b) => a.at - b.at);
  const first = list[0];
  if (!first) return { moves: still(), behind: [] };
  const W = b.canvas.width;
  const rect = windowRect(first, b.edit);                      // validate: the windows of one shot share their place
  const radius = px(first.radius ?? WINDOW.radius, W);
  const scale = rect.width / W;
  const moves: Moves = { vars: [`--ve-win-x:${rect.x}px`, `--ve-win-y:${rect.y}px`, `--ve-win-s:${scale}`, `--ve-win-r:${radius / scale}px`], animations: [], blur: false, rows: [] };
  const behind: string[] = [];
  list.forEach((window, k) => {
    const n = window.frames ?? WINDOW.frames;
    const back = window.at + window.for - n;
    moves.animations.push(animation('ve-window-in', window.at, n, 'in-out', 'forwards', 0, b.fps), animation('ve-window-out', back, n, 'in-out', 'forwards', 0, b.fps));
    moves.rows.push(row('window', window.at, n, 0, 1, 'in-out', 'forwards'), row('window', back, n, 1, 0, 'in-out', 'forwards'));
    // behind the window: one untimed wrapper with a timed picture per swap; a motion runs over the whole window, so it is
    // on the wrapper (clock: frame 0) and goes on across the swaps
    const id = `${shot.id}-b${k + 1}`;
    const pictures = windowPictures(window).map((p, j) => ({ ...p, element: j === 0 ? `${id}-v` : `${id}-s${j}` }));
    const entry: Timeline['windows'][number] = { shot: shot.id, behind: window.behind, at: window.at, for: window.for, frames: n, rect, radius, pictures };
    b.timeline.windows.push(entry);
    let zoom = '';
    if (window.behindMotion) {
      const { from, to } = motionScale(window.behindMotion);
      const ease: Ease = window.behindMotion.kind === 'punch-in' ? 'out' : window.behindMotion.ease ?? 'linear';     // validate: no punch-in here
      zoom = `;--ve-s0:${from};--ve-s1:${to};animation:${animation('ve-scale', window.at, window.for, ease, 'both', 0, b.fps)}`;
      note(b, id, [row('scale', window.at, window.for, from, to, ease, 'both')]);
    }
    behind.push(
      `      <div id="${id}" class="${words('ve-shot', zoom !== '' && 've-m')}" style="z-index:${index + 1}${zoom}">`,
      ...pictures.map((p) => `        ${picture(b, { id: p.element, media: p.behind, at: p.at, length: p.for, from: 0, track: b.tracks.take(p.at, p.for), scaled: zoom !== '' })}`),
      '      </div>',
    );
  });
  return { moves, behind };
}

/** The colour layer of a flash or a dip: a timed leaf over both shots, its opacity a triangle with the peak on the cut. */
function colourLayer(b: Build, shot: Shot, transition: Transition & { kind: 'flash' | 'dip' }, zIndex: number): string {
  const n = transitionFrames(transition);
  const at = shot.at - Math.floor(n / 2);
  const colour = transition.colour ?? (transition.kind === 'flash' ? TRANSITION.flashColour : TRANSITION.dipColour);
  const rising = Math.ceil(n / 2);                             // frames on which the opacity grows (the middle frame of an odd n is the peak)
  note(b, `${shot.id}-fx`, [
    row('opacity', at, rising, 0, (2 * rising) / n, 'linear', 'backwards'),
    ...(n > rising ? [row('opacity', at + rising, n - rising, (2 * (n - rising)) / n, 0, 'linear', 'forwards')] : []),
  ]);
  return `      <div id="${shot.id}-fx" class="clip ve-fx ve-m" ${timing(b, at, n)} data-track-index="${b.tracks.take(at, n)}" style="z-index:${zIndex};background:${colour};animation:${animation('ve-flash', at, n, 'linear', 'both', at, b.fps)}"></div>`;
}

/** The shots in order, each in its wrapper (z-index 1 … n), then the colour layers. Fills timeline.shots, .transitions, .windows. */
export function shotsHtml(b: Build, layerZ: number): string[] {
  const { shots } = b.edit;
  const lines: string[] = [];
  const layers: string[] = [];
  shots.forEach((shot, i) => {
    const previous = shots[i - 1];
    const next = shots[i + 1];
    const incoming: Transition = previous ? transitionOf(shot) : { kind: 'cut' };
    const tail = tailOf(shots, i);
    const video = b.edit.media[shot.media]!.kind === 'video';
    const from = video ? shot.from ?? 0 : 0;
    const inset = windows(b, shot, i);
    const moves = join(arrive(b, incoming, shot.at), next ? leave(b, transitionOf(next), next.at) : still(), inset.moves);
    note(b, shot.id, moves.rows);
    b.timeline.shots.push({ id: shot.id, element: `${shot.id}-v`, media: shot.media, kind: video ? 'video' : 'image', at: shot.at, for: shot.for, tail, from });
    if (previous) {
      const n = transitionFrames(incoming);
      const centred = incoming.kind === 'zoom' || incoming.kind === 'flash' || incoming.kind === 'dip';
      const colour = incoming.kind === 'flash' || incoming.kind === 'dip' ? rgb(incoming.colour ?? (incoming.kind === 'flash' ? TRANSITION.flashColour : TRANSITION.dipColour)) : null;
      b.timeline.transitions.push({ kind: incoming.kind, from: previous.id, to: shot.id, cut: shot.at, at: centred ? shot.at - Math.floor(n / 2) : shot.at, for: n, overlap: overlaps(incoming), colour });
      if (incoming.kind === 'flash' || incoming.kind === 'dip') layers.push(colourLayer(b, shot, incoming, layerZ));
    }
    const media = picture(b, { id: `${shot.id}-v`, media: shot.media, at: shot.at, length: shot.for + tail, from, track: shotTrack(i), focus: shot.focus, motion: shot.motion });
    lines.push(
      ...inset.behind,
      `      <div id="${shot.id}" class="${words('ve-shot ve-m', moves.blur && 've-mb', inset.behind.length > 0 && 've-win')}" style="z-index:${i + 1};${movesStyle(moves)}">`,
      `        ${media}`,
      '      </div>',
    );
  });
  return [...lines, ...layers];
}
