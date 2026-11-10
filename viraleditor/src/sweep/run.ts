// parseEdit → compose → writeComposition → renderer.check → renderer.render, twice, through createRenderer with its defaults.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMeasure } from '../adapters/measure.ts';
import { createRenderer } from '../adapters/renderer.ts';
import type { RenderFacts } from '../adapters/renderer.ts';
import { compose } from '../compose/index.ts';
import { writeComposition } from '../compose/write.ts';
import { available } from '../compose/golden-helpers.ts';
import { parseEdit } from '../edit/schema.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { Edit } from '../edit/types.ts';
import { FFMPEG, FFPROBE } from './media.ts';
import type { SweepMedia } from './media.ts';

export { available };
export const SLOW = 2_400_000;                      // a render may take many minutes on the shared machine

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN = join(ROOT, 'node_modules/.bin/hyperframes');

export interface Rendered {
  name: string; dir: string; edit: Edit; timeline: Timeline; outputs: string[];
  facts: RenderFacts[]; seconds: number[]; load: number[]; checkIssues: string[];
}

/** `renders`: how many times the same folder is rendered (2 for the two-render comparison). */
export async function renderDoc(name: string, json: Edit, media: SweepMedia, renders = 2): Promise<Rendered> {
  const parsed = parseEdit(json);
  if (!parsed.ok) throw new Error(`${name}: parseEdit: ${JSON.stringify(parsed.issues).slice(0, 1500)}`);
  const composition = compose(parsed.edit, media.facts);
  const dir = mkdtempSync(join(tmpdir(), `ve-sweep-${name}-`));
  writeComposition(dir, composition, media.sources);
  mkdirSync(join(dir, 'out'), { recursive: true });
  const renderer = createRenderer({ bin: BIN, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure: createMeasure(FFMPEG, FFPROBE), timeoutMs: 15 * 60_000, checkTimeoutMs: 8 * 60_000 });
  const checked = await renderer.check(dir);
  const out: Rendered = { name, dir, edit: parsed.edit, timeline: composition.timeline, outputs: [], facts: [], seconds: [], load: [], checkIssues: checked.issues.map((i) => `${i.code}:${i.target}:${i.message}`.slice(0, 300)) };
  for (let i = 1; i <= renders; i++) {
    const to = join(dir, 'out', `render-${i}.mp4`);
    const t0 = Date.now();
    out.load.push(Number(loadavg()[0]!.toFixed(1)));
    out.facts.push(await renderer.render(dir, to, () => {}));
    out.seconds.push(Number(((Date.now() - t0) / 1000).toFixed(1)));
    out.outputs.push(to);
  }
  writeFileSync(join(dir, 'out', 'render-info.json'), JSON.stringify({ seconds: out.seconds, load: out.load, notes: out.facts.map((f) => f.note) }));
  return out;
}
