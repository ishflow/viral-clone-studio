// The fixture documents as real projects: a temp folder with edit.json and media made by ffmpeg (nothing binary is kept
// in the repo). For the tests that run the real tools.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { barFilter, readBar } from '../../adapters/framebar.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const find = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find((path) => existsSync(path));
const FFMPEG = find('ffmpeg');
/** The real tools are installed: the HyperFrames CLI, its Chrome, ffmpeg and ffprobe. */
export const available = existsSync(join(HERE, '../../../node_modules/.bin/hyperframes')) && existsSync(join(homedir(), '.cache/hyperframes/chrome')) && FFMPEG !== undefined && find('ffprobe') !== undefined;

function ffmpeg(args: string[]): void {
  const run = spawnSync(FFMPEG!, ['-v', 'error', '-y', ...args], { encoding: 'utf8', timeout: 120_000 });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}: ${run.stderr}`);
}

/** What each media file of the fixtures is made from: the arguments of ffmpeg before the output file. */
const MEDIA: Record<string, string[]> = {
  // a moving test picture, as `normalize` would leave it: 30 fps, a keyframe every second, BT.709
  'clip.mp4': ['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709', '-frames:v', '90',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0'],
  'still.png': ['-f', 'lavfi', '-i', 'color=c=0x204060:s=720x1280', '-frames:v', '1'],
  'product.png': ['-f', 'lavfi', '-i', 'color=c=0xf0c040:s=600x600', '-frames:v', '1'],
  'tone.mp3': ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k'],
  // a clip whose every frame carries its own number as a frame bar (adapters/framebar.ts)
  'bars.mp4': ['-f', 'lavfi', '-i', 'color=c=0x305070:s=720x1280:r=30', '-vf', `${barFilter({ width: 720, height: 1280, fps: 30 })},format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709`,
    '-frames:v', '130', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0'],
  'paper.png': ['-f', 'lavfi', '-i', 'color=c=white:s=720x1280', '-frames:v', '1'],
};
const ASSETS = { small: ['clip.mp4', 'still.png', 'product.png', 'tone.mp3'], white: ['paper.png'], bars: ['bars.mp4'] };

/** A project folder in a temp dir with the fixture as edit.json and its media in assets/ (all but `without`). Returns the path of edit.json. */
export function realProject(name: 'small' | 'white' | 'bars', without: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), `ve-cli-${name}-`));
  mkdirSync(join(dir, 'assets'));
  for (const asset of ASSETS[name]) if (!without.includes(asset)) ffmpeg([...MEDIA[asset]!, join(dir, 'assets', asset)]);
  copyFileSync(join(HERE, `${name}.json`), join(dir, 'edit.json'));
  return join(dir, 'edit.json');
}

/** The frame number a 720×1280 still of the `bars` project shows, read from its frame bar; null when no bar can be read. */
export function barOf(png: string): number | null {
  const run = spawnSync(FFMPEG!, ['-v', 'error', '-i', png, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24, timeout: 120_000 });
  if (run.status !== 0) throw new Error(run.stderr.toString());
  return readBar(new Uint8Array(run.stdout), 720, 1280);
}
