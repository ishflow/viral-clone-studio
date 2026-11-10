// Time in a composition (design R1, R2). Frames are the only unit in the edit document; seconds exist only as text.

/** Seconds of a frame count, never rounded: `seconds(47, 30)` is "1.5666666666666667". */
export function seconds(frame: number, fps: number): string {
  return String(frame / fps);
}

/** The half-frame form: the edge that lies half a frame before `frame`, so that no frame time ever coincides with it. */
export function halfSeconds(frame: number, fps: number): string {
  return String((frame - 0.5) / fps);
}
