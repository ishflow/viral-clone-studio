// One animation as CSS text and as rows of timeline.json (design §5.2, §5.4, §7).
// An animation covers whole frames at … at+for−1; its edges lie half a frame before them (R2).
import { ENTER, cssEase, motionFrames } from '../edit/presets.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { Ease, Enter, Exit, Frame, Frames, Side } from '../edit/types.ts';
import { px } from './layout.ts';
import { halfSeconds, seconds } from './time.ts';

export type Row = Omit<Timeline['animations'][number], 'element'>;
type Fill = 'backwards' | 'forwards' | 'both';

/** What an element carries because it moves: custom properties, the animation list, and what the frame table says about it. */
export interface Moves {
  vars: string[];          // '--ve-in-s:0.6'
  animations: string[];    // values of `animation`, enter first, exit last
  blur: boolean;           // needs the class ve-mb
  rows: Row[];
}
export const still = (): Moves => ({ vars: [], animations: [], blur: false, rows: [] });
export function join(...parts: Moves[]): Moves {
  return { vars: parts.flatMap((p) => p.vars), animations: parts.flatMap((p) => p.animations), blur: parts.some((p) => p.blur), rows: parts.flatMap((p) => p.rows) };
}

/** `<keyframes> <for / fps>s <ease> <(at − base − 0.5) / fps>s <fill>`; `base` is the frame the element's clock starts at. */
export function animation(keyframes: string, at: Frame, length: Frames, ease: Ease, fill: Fill, base: Frame, fps: number): string {
  return `${keyframes} ${seconds(length, fps)}s ${cssEase(ease)} ${halfSeconds(at - base, fps)}s ${fill}`;
}

const HOLD = { backwards: 'before', forwards: 'after', both: 'both' } as const;
export function row(property: Row['property'], at: Frame, length: Frames, from: number, to: number, ease: Ease, fill: Fill): Row {
  return { property, at, for: length, from, to, ease, hold: HOLD[fill] };
}

/** Where a slide starts (enter) or ends (exit), in pixels: `side` is the side it comes from or goes to. */
function offset(side: Side, distance: number): { x: number; y: number } {
  return { x: side === 'left' ? -distance : side === 'right' ? distance : 0, y: side === 'top' ? -distance : side === 'bottom' ? distance : 0 };
}
function slideRows(at: Frame, length: Frames, from: { x: number; y: number }, to: { x: number; y: number }, ease: Ease, fill: Fill): Row[] {
  return [
    ...(from.x !== to.x ? [row('x', at, length, from.x, to.x, ease, fill)] : []),
    ...(from.y !== to.y ? [row('y', at, length, from.y, to.y, ease, fill)] : []),
  ];
}

interface Clock { base: Frame; fps: number; canvas: { width: number; height: number } }

/**
 * An enter that starts on frame `at` (design §5.4). `frames` may shorten it (a caption group shorter than its enter).
 * `soft`: the pop of a caption group, which eases out on scale and opacity alike (design §5.5).
 */
export function enterMoves(enter: Enter, at: Frame, clock: Clock, options: { frames?: Frames; soft?: boolean } = {}): Moves {
  const n = options.frames ?? motionFrames(enter);
  if (enter.kind === 'none' || n < 1) return still();
  const play = (keyframes: string, length: Frames, ease: Ease) => animation(keyframes, at, length, ease, 'backwards', clock.base, clock.fps);
  const fade = (length: Frames, ease: Ease = 'linear'): Moves => ({ vars: [], animations: [play('ve-fade-in', length, ease)], blur: false, rows: [row('opacity', at, length, 0, 1, ease, 'backwards')] });
  switch (enter.kind) {
    case 'fade': return fade(n);
    case 'pop': {
      const from = enter.from ?? ENTER.popFrom;
      const ease: Ease = options.soft ? 'out' : 'back';
      return join({ vars: [`--ve-in-s:${from}`], animations: [play('ve-scale-in', n, ease)], blur: false, rows: [row('scale', at, n, from, 1, ease, 'backwards')] },
        options.soft ? fade(n, 'out') : fade(Math.min(ENTER.popFade, n)));
    }
    case 'slide': {
      const from = offset(enter.from, px(enter.distance ?? ENTER.slideDistance, clock.canvas.height));
      return join({ vars: [`--ve-in-x:${from.x}px`, `--ve-in-y:${from.y}px`], animations: [play('ve-move-in', n, 'out')], blur: false, rows: slideRows(at, n, from, { x: 0, y: 0 }, 'out', 'backwards') }, fade(n));
    }
    case 'blur': {
      const radius = px(enter.radius ?? ENTER.blurRadius, clock.canvas.width);
      return join({ vars: [`--ve-in-b:${radius}px`], animations: [play('ve-blur-in', n, 'out')], blur: true, rows: [row('blur', at, n, radius, 0, 'out', 'backwards')] }, fade(n));
    }
  }
}

/** An exit whose last frame is `end − 1` (design §5.4). */
export function exitMoves(exit: Exit, end: Frame, clock: Clock): Moves {
  const n = motionFrames(exit);
  if (exit.kind === 'none' || n < 1) return still();
  const at = end - n;
  const play = (keyframes: string, ease: Ease) => animation(keyframes, at, n, ease, 'forwards', clock.base, clock.fps);
  const fade: Moves = { vars: [], animations: [play('ve-fade-out', 'linear')], blur: false, rows: [row('opacity', at, n, 1, 0, 'linear', 'forwards')] };
  switch (exit.kind) {
    case 'fade': return fade;
    case 'pop': {
      const to = exit.to ?? ENTER.popTo;
      return join({ vars: [`--ve-out-s:${to}`], animations: [play('ve-scale-out', 'in')], blur: false, rows: [row('scale', at, n, 1, to, 'in', 'forwards')] }, fade);
    }
    case 'slide': {
      const to = offset(exit.to, px(exit.distance ?? ENTER.slideDistance, clock.canvas.height));
      return join({ vars: [`--ve-out-x:${to.x}px`, `--ve-out-y:${to.y}px`], animations: [play('ve-move-out', 'in')], blur: false, rows: slideRows(at, n, { x: 0, y: 0 }, to, 'in', 'forwards') }, fade);
    }
    case 'blur': {
      const radius = px(exit.radius ?? ENTER.blurRadius, clock.canvas.width);
      return join({ vars: [`--ve-out-b:${radius}px`], animations: [play('ve-blur-out', 'in')], blur: true, rows: [row('blur', at, n, 0, radius, 'in', 'forwards')] }, fade);
    }
  }
}

/** The `style` text of what moves: the custom properties, then one `animation` declaration. */
export function movesStyle(moves: Moves): string {
  return `${moves.vars.map((v) => `${v};`).join('')}${moves.animations.length ? `animation:${moves.animations.join(', ')}` : ''}`;
}
