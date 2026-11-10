// Percent of the canvas → whole pixels, rounded once (design R5). The rules of the document and the composer both measure with it.
import type { Rect } from './timeline.ts';
import type { Box } from './types.ts';

/** A share of a length in whole pixels. */
export function px(percent: number, of: number): number {
  return Math.round((percent * of) / 100);
}

/** A box in percent as whole pixels: the four edges are rounded, the width and height follow from them. */
export function rectOf(box: Box, canvas: { width: number; height: number }): Rect {
  const x = px(box.left, canvas.width);
  const y = px(box.top, canvas.height);
  return { x, y, width: px(box.right, canvas.width) - x, height: px(box.bottom, canvas.height) - y };
}
