// The frame of a faded edge, to a fraction of a frame: an enter or exit that takes several frames is judged by where its
// ink curve crosses half of the value at rest, interpolated linearly between the two frames around the crossing, and the
// same is done to the curve the timeline promises. The difference is the error of the edge in frames; a one-frame shift
// moves it by about one, whatever the length of the fade.

export interface Edge {
  element: string; side: 'enter' | 'exit'; frames: number;           // frames: length of the enter / exit zone (rest edge to element edge)
  promise: number | null; shows: number | null; error: number | null; // fractional frames; null: the curve does not cross half there
}

/** First upward (enter) or last downward (exit) crossing of `level` by `v` on frames `from` … `to` (inclusive), interpolated. */
export function crossing(v: (f: number) => number, from: number, to: number, level: number, side: 'enter' | 'exit'): number | null {
  if (side === 'enter') {
    for (let f = from; f < to; f++) { const a = v(f); const b = v(f + 1); if (a < level && b >= level) return f + (level - a) / (b - a); }
    return null;
  }
  for (let f = to - 1; f >= from; f--) { const a = v(f); const b = v(f + 1); if (a >= level && b < level) return f + (a - level) / (a - b); }
  return null;
}

/** The enter and exit edges of one element whose zones are `min` frames or longer, the measured curve against the promised one (both 1 at rest). */
export function edgesOf(row: { element: string; at: number; for: number; rest: { at: number; for: number } }, frames: number,
  shows: (f: number) => number, promise: (f: number) => number, min = 3): Edge[] {
  const out: Edge[] = [];
  const zones: [Edge['side'], number, number, number][] = [
    ['enter', row.rest.at - row.at, Math.max(0, row.at - 2), Math.min(frames - 1, row.rest.at + 1)],
    ['exit', row.at + row.for - row.rest.at - row.rest.for, Math.max(0, row.rest.at + row.rest.for - 2), Math.min(frames - 1, row.at + row.for + 1)],
  ];
  for (const [side, length, from, to] of zones) {
    if (length < min) continue;
    const p = crossing(promise, from, to, 0.5, side);
    if (p === null) continue;                              // the promise keeps its ink (a slide or a blur without a fade): no edge to time
    const s = crossing(shows, from, to, 0.5, side);
    out.push({ element: row.element, side, frames: length, promise: round(p), shows: s === null ? null : round(s), error: s === null ? null : round(s - p) });
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
