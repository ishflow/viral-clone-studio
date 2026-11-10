// Percent of the canvas → whole pixels, rounded once (design R5). Everything that reaches CSS as a box comes from here.
import { buttonColumn, safeArea, WINDOW } from '../edit/presets.ts';
import type { Rect } from '../edit/timeline.ts';
import { px, rectOf } from '../edit/geometry.ts';
import type { Edit, Window } from '../edit/types.ts';

export { px, rectOf };

/**
 * The largest rect of the picture's aspect ratio that fits the box, centred in it, in whole pixels:
 * where a card shows its whole picture (`fit: 'contain'`).
 */
export function containRect(box: Rect, picture: { width: number; height: number }): Rect {
  const scale = Math.min(box.width / picture.width, box.height / picture.height);
  const width = Math.min(box.width, Math.max(1, Math.round(picture.width * scale)));
  const height = Math.min(box.height, Math.max(1, Math.round(picture.height * scale)));
  return { x: box.x + Math.round((box.width - width) / 2), y: box.y + Math.round((box.height - height) / 2), width, height };
}

/** Percent of the height a window keeps above the column of the buttons: more than the rounding of its size to whole pixels can add (under 9 px of 1280). */
const CLEAR = 1;

/**
 * Where a window rests: in a corner of the safe area, with the canvas's own ratio. The width is rounded so that the height
 * is whole too (9:16: a multiple of 9 px), because the window is the whole frame scaled by width / canvas width.
 * A window on the right that would reach into the column of the buttons rests against the column instead (§12.16).
 */
export function windowRect(window: Window, edit: Edit): Rect {
  const { width: W, height: H } = edit.canvas;
  const unit = W / gcd(W, H);
  const width = Math.max(unit, Math.round(px(window.width ?? WINDOW.width, W) / unit) * unit);
  const height = (width * H) / W;
  const area = safeArea(edit);
  const safe = rectOf(area, edit.canvas);
  const [vertical, horizontal] = window.corner.split('-');
  const y = vertical === 'top' ? safe.y : safe.y + safe.height - height;
  // Decided in percent, so that one document rests its window at the same place on both canvases: a window has the
  // canvas's ratio, so its height in percent of the height is its width in percent of the width. One at the bottom
  // always lies beside the column; one at the top does when it comes down to the column's top, less the margin.
  const column = buttonColumn(edit);
  const beside = column !== null && (vertical === 'bottom' || area.top + (window.width ?? WINDOW.width) > column.top - CLEAR);
  const right = beside ? px(column.left, W) : safe.x + safe.width;
  return { x: horizontal === 'left' ? safe.x : right - width, y, width, height };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
