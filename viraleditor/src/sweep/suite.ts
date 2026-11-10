// One sweep case: render a document twice, read every frame of both, compare with the promise and with each other.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { frameMd5 } from '../compose/golden-helpers.ts';
import type { Edit } from '../edit/types.ts';
import { analyse } from './analyse.ts';
import type { Analysis, Wrong } from './analyse.ts';
import { stills, streamFrames } from './frames.ts';
import type { SweepMedia } from './media.ts';
import { renderDoc } from './run.ts';
import type { Rendered } from './run.ts';

export interface Case {
  name: string; rendered: Rendered; analysis: Analysis; second: Analysis;
  /** framemd5 of both renders equal (null: not compared, a window is compared by decoded positions) */
  identical: boolean | null; framesDiffering: number; positionsDiffering: number;
  /** when the two renders differ: the frames, the largest step of a channel, the box (x0, y0, x1, y1) of the changed pixels */
  difference: { frames: number[]; max: number; box: [number, number, number, number] } | null;
  stills: Record<string, string[]>;
  /** wrong frames of one render only, on frames where the two renders differ (FINDING 1) */
  uneven: Wrong[];
}

const key = (w: Wrong) => `${w.kind}|${w.frame}|${w.element}`;
/** Both renders are judged. `uneven` is diagnostic evidence, never an exemption for a one-sided failure. */
export const wrongOf = (c: Case, ...kinds: string[]): Wrong[] => [...c.analysis.wrong, ...c.second.wrong.map((w) => ({ ...w, element: `render 2: ${w.element}` }))]
  .filter((w) => kinds.includes(w.kind));
/** The wrong frames of some kinds as one short line each, for an assertion message. */
export const describeWrong = (list: Wrong[]): string => `${list.length} wrong: ${list.slice(0, 6).map((w) => `f${w.frame} ${w.element}: promise ${w.promise} / shows ${w.shows}`).join(' | ')}`;

export async function runCase(name: string, edit: Edit, media: SweepMedia, options: { windows?: boolean } = {}): Promise<Case> {
  const rendered = await renderDoc(name, edit, media, 2);
  const analysis = await analyse(rendered, media, rendered.outputs[0]!);
  const second = await analyse(rendered, media, rendered.outputs[1]!);
  let identical: boolean | null = null; let framesDiffering = 0;
  if (!options.windows) {
    const a = frameMd5(rendered.outputs[0]!); const b = frameMd5(rendered.outputs[1]!);
    framesDiffering = Math.max(a.length, b.length) - a.filter((v, i) => v === b[i]).length;
    identical = framesDiffering === 0;
  }
  // two renders that differ: by how much and where (the largest step of any channel, the box of the changed pixels)
  let difference: { frames: number[]; max: number; box: [number, number, number, number] } | null = null;
  if (framesDiffering > 0) {
    const { width: W, height: H } = rendered.timeline;
    const first: Uint8Array[] = [];
    await streamFrames(rendered.outputs[0]!, W, H, (f, p) => { first[f] = p.rgb.slice(); });
    const d = { frames: [] as number[], max: 0, box: [W, H, -1, -1] as [number, number, number, number] };
    await streamFrames(rendered.outputs[1]!, W, H, (f, p) => {
      const a = first[f];
      if (!a) return;
      let changed = false;
      for (let j = 0; j < p.rgb.length; j++) {
        const v = Math.abs(p.rgb[j]! - a[j]!);
        if (v === 0) continue;
        changed = true; d.max = Math.max(d.max, v);
        const px = Math.floor(j / 3); const x = px % W; const y = Math.floor(px / W);
        d.box = [Math.min(d.box[0], x), Math.min(d.box[1], y), Math.max(d.box[2], x), Math.max(d.box[3], y)];
      }
      if (changed) d.frames.push(f);
    });
    difference = d;
  }
  const differs = new Set(difference?.frames ?? []);
  const inFirst = new Set(analysis.wrong.map(key)); const inSecond = new Set(second.wrong.map(key));
  const uneven = [...analysis.wrong.filter((w) => !inSecond.has(key(w))), ...second.wrong.filter((w) => !inFirst.has(key(w)))].filter((w) => differs.has(w.frame));
  let positionsDiffering = 0;
  analysis.samples.forEach((row, f) => { if (row.some((v, i) => Math.abs(v - (second.samples[f]?.[i] ?? -999)) > 10)) positionsDiffering++; });
  const out: Record<string, string[]> = {};
  const byKind = new Map<string, number[]>();
  for (const w of analysis.wrong) byKind.set(w.kind, [...(byKind.get(w.kind) ?? []), w.frame]);
  for (const [kind, frames] of byKind) out[kind] = stills(rendered.outputs[0]!, join(rendered.dir, 'out', 'stills'), kind, [...new Set(frames)].slice(0, 3));
  const c: Case = { name, rendered, analysis, second, identical, framesDiffering, positionsDiffering, difference, stills: out, uneven };
  const row = {
    name, dir: rendered.dir, frames: analysis.frames, elements: analysis.elements, read: analysis.read, byBar: analysis.byBar, byColourOnly: analysis.byColourOnly, unreadable: analysis.unreadable,
    wrongFrames: new Set(analysis.wrong.map((w) => w.frame)).size, wrongByKind: Object.fromEntries([...byKind].map(([k, v]) => [k, new Set(v).size])),
    identical, framesDiffering, positionsDiffering, difference: difference && { ...difference, count: difference.frames.length, frames: difference.frames.slice(0, 40) }, uneven: uneven.slice(0, 8), renderSeconds: rendered.seconds, load: rendered.load, check: rendered.checkIssues, notes: analysis.notes, stills: out,
    sharpness: Object.fromEntries(Object.entries(analysis.sharpness).map(([k, v]) => [k, v.filter((x) => x.opacity < 0.9).map((x) => `${x.frame}:${x.opacity}/${x.sharp}`)])),
    edges: analysis.edges, words: { frames: analysis.words.frames, judged: analysis.words.judged },
    first: analysis.wrong.slice(0, 4), secondWrongByKind: Object.fromEntries([...new Set(second.wrong.map((w) => w.kind))].map((k) => [k, new Set(second.wrong.filter((w) => w.kind === k).map((w) => w.frame)).size])), secondFirst: second.wrong.slice(0, 4),
  };
  if (process.env.VE_SWEEP_LOG) appendFileSync(process.env.VE_SWEEP_LOG, `${JSON.stringify(row)}\n`);
  return c;
}

/** A document's media section from the keys it uses. */
export function mediaOf(...keys: string[]): Edit['media'] {
  return Object.fromEntries(keys.map((k) => [k, k.startsWith('v') && !k.startsWith('vo') ? { file: `assets/${k}.mp4`, kind: 'video' as const } : k.startsWith('m-') || k.startsWith('fx-') ? { file: `assets/${k}.mp3`, kind: 'audio' as const } : { file: `assets/${k}.png`, kind: 'image' as const }]));
}
