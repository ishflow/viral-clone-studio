// Test support for the renderer: a small composition folder written by hand (compose is a different task).
// 720×1280 at 30 fps, 60 frames: clip A on frames 0–29, clip B on 30–59 (both carry the frame bar), one text, music as a tone.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createFakeGenerator } from '../fake-generator.ts';
import { runProcess } from '../exec.ts';
import { barFilter } from '../framebar.ts';
import type { Timeline } from '../../edit/timeline.ts';

export const FPS = 30;
export const FRAMES = 60;
const W = 720;
const H = 1280;
const FONT = resolve(import.meta.dirname, '../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
/** The time rule: seconds are frame / fps at full precision. */
const s = (frame: number): string => String(frame / FPS);

/** The timeline.json of the fixture. `master` is the loudness target; the rest is fixed. */
export function fixtureTimeline(master: { lufs: number; peak: number } | null): Timeline {
  return {
    fps: FPS, frames: FRAMES, width: W, height: H,
    shots: [
      { id: 'a', element: 'shot-a', media: 'assets/clip-a.mp4', kind: 'video', at: 0, for: 30, tail: 0, from: 0 },
      { id: 'b', element: 'shot-b', media: 'assets/clip-b.mp4', kind: 'video', at: 30, for: 30, tail: 0, from: 60 },
    ],
    transitions: [], windows: [],
    texts: [{ id: 'hook', line: 0, element: 't-hook', copy: 'scent layering combo', at: 10, for: 40, rect: { x: 43, y: 512, width: 634, height: 128 }, size: 40, colour: '#ffffff', rest: { at: 10, for: 40 } }],
    captions: [], cards: [],
    audio: [{ element: 'music', media: 'assets/music.mp3', at: 0, for: FRAMES, from: 0, gain: [[0, 1], [FRAMES, 1]] }],
    animations: [],
    master,
    checkAt: [30],
  };
}

/** Makes the media with the fake generator and ffmpeg (frame bar on the clips), writes index.html and timeline.json into `dir`. */
export async function writeFixtureComposition(dir: string, options: { master: { lufs: number; peak: number } | null; ffmpeg: string; missingAsset?: boolean }): Promise<Timeline> {
  const assets = join(dir, 'assets');
  mkdirSync(join(assets, 'fonts'), { recursive: true });
  copyFileSync(FONT, join(assets, 'fonts', 'inter-latin-wght-normal.woff2'));
  const generator = createFakeGenerator({ log: join(dir, '..', `${basename(dir)}-generator.jsonl`), ffmpeg: options.ffmpeg });
  const none = () => {};
  await generator.music({ prompt: 'tone' }, join(assets, 'music.mp3'), none);
  const clip = async (name: string, colour: string): Promise<void> => {
    const r = await runProcess(options.ffmpeg, ['-y', '-v', 'error', '-nostdin',
      '-f', 'lavfi', '-i', `color=c=0x${colour}:s=${W}x${H}:r=${FPS}:d=4`, '-vf', barFilter({ width: W, height: H, fps: FPS }),
      '-c:v', 'libx264', '-preset', 'veryfast', '-g', String(FPS), '-pix_fmt', 'yuv420p', '-frames:v', String(4 * FPS), join(assets, name)], { timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(r.stderr);
  };
  await clip('clip-a.mp4', '2b6a8a');
  if (!options.missingAsset) await clip('clip-b.mp4', '8a2b2b');
  const t = fixtureTimeline(options.master);
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify(t, null, 2));
  writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>renderer fixture</title>
    <style>
      @font-face { font-family: "Inter"; src: url("assets/fonts/inter-latin-wght-normal.woff2") format("woff2"); font-weight: 100 900; font-style: normal; font-display: block; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
      .shot { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
      .layer { position: absolute; inset: 0; }
      .box { position: absolute; display: flex; align-items: center; justify-content: center; white-space: nowrap; font-family: "Inter", sans-serif; line-height: 1; font-weight: 700; font-size: 40px; color: #ffffff; text-shadow: 0 2px 8px #000000cc; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-fps="${FPS}" data-duration="${s(FRAMES)}" data-no-timeline>
      <video id="shot-a" class="shot" src="assets/clip-a.mp4" data-start="${s(0)}" data-duration="${s(30)}" data-media-start="${s(0)}" data-track-index="0" muted playsinline></video>
      <video id="shot-b" class="shot" src="assets/clip-b.mp4" data-start="${s(30)}" data-duration="${s(30)}" data-media-start="${s(60)}" data-track-index="0" muted playsinline></video>
      <div id="texts" class="layer">
        <div id="t-hook" class="clip box" data-start="${s(10)}" data-duration="${s(40)}" data-track-index="1" style="left: 6%; top: 40%; right: 6%; bottom: 50%">scent layering combo</div>
      </div>
      <audio id="music" src="assets/music.mp3" data-start="0" data-duration="${s(FRAMES)}" data-track-index="10" data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1},{"t":${s(FRAMES)},"v":1}]}]}'></audio>
    </div>
  </body>
</html>
`);
  return t;
}
