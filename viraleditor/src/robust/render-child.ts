// A render in a process of its own, for the robustness tests: `node render-child.ts <composition> <target> [timeoutMs]`.
// Prints `progress <frame>` while it renders, then `done` or `failed <message>`.
import { createMeasure } from '../adapters/measure.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { FFMPEG, FFPROBE, HYPERFRAMES } from './harness.ts';

const [dir, to, limit] = process.argv.slice(2) as [string, string, string | undefined];
const renderer = createRenderer({ bin: HYPERFRAMES, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure: createMeasure(FFMPEG, FFPROBE), timeoutMs: limit ? Number(limit) : undefined });
try {
  await renderer.render(dir, to, (p) => console.log(`progress ${p.frame}`));
  console.log('done');
} catch (e) {
  console.log(`failed ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
}
