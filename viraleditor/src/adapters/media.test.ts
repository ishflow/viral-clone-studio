import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runProcess } from './exec.ts';
import { MediaError, SHEET_GAP, createMedia, sheetLayout } from './media.ts';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const have = existsSync(FFMPEG) && existsSync(FFPROBE);
const T = 120_000;

async function source(dir: string): Promise<string> {
  const file = join(dir, 'src.mp4');
  const r = await runProcess(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1072x1928:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-g', '240', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
  if (r.code !== 0) throw new Error(r.stderr);
  return file;
}

/** A video of solid colours, one after the other with a hard cut between them: [colour, frames] each. `pad` (ffmpeg's `pad`) sets that picture into a larger black frame. */
async function solid(file: string, rate: number, parts: [string, number][], size = '360x640', pad?: string): Promise<string> {
  const inputs = parts.flatMap(([colour, frames]) => ['-f', 'lavfi', '-i', `color=c=${colour}:s=${size}:r=${rate}:d=${frames / rate}`]);
  const r = await runProcess(FFMPEG, ['-y', ...inputs, '-filter_complex', `${parts.map((_, i) => `[${i}]`).join('')}concat=n=${parts.length}:v=1:a=0${pad ? `,pad=${pad}:black` : ''}`, '-pix_fmt', 'yuv420p', file]);
  if (r.code !== 0) throw new Error(r.stderr);
  return file;
}
/** A video of lavfi sources, each a whole frame of the same size and rate, one after the other with a hard cut between them. */
async function joined(file: string, sources: string[]): Promise<string> {
  const r = await runProcess(FFMPEG, ['-y', ...sources.flatMap((source) => ['-f', 'lavfi', '-i', source]), '-filter_complex', `${sources.map((_, i) => `[${i}]`).join('')}concat=n=${sources.length}:v=1:a=0`, '-pix_fmt', 'yuv420p', file]);
  if (r.code !== 0) throw new Error(r.stderr);
  return file;
}
/** A picture file as rgb24 rows, and its width. */
async function pixels(dir: string, file: string): Promise<{ width: number; at(x: number, y: number): [number, number, number] }> {
  const size = await runProcess(FFPROBE, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const width = Number(size.stdout.trim().split(',')[0]);
  const raw = join(dir, 'pixels.rgb');
  const decoded = await runProcess(FFMPEG, ['-y', '-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  if (decoded.code !== 0) throw new Error(decoded.stderr);
  const rgb = readFileSync(raw);
  return { width, at: (x, y) => { const i = (y * width + x) * 3; return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!]; } };
}
const RGB: Record<string, [number, number, number]> = { red: [255, 0, 0], lime: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0], black: [0, 0, 0], grey: [128, 128, 128] };
const isColour = (pixel: number[], colour: string): boolean => pixel.reduce((sum, c, k) => sum + Math.abs(c - RGB[colour]![k]!), 0) < 90;

describe.skipIf(!have)('createMedia with real ffmpeg', () => {
  const media = createMedia(FFMPEG, FFPROBE);
  const dir = mkdtempSync(join(tmpdir(), 've-media-'));
  beforeAll(async () => { await source(dir); }, T);                 // src.mp4 for every test below, whichever runs alone

  it('probe: size, fps as a number, exact frame count, seconds, sound', async () => {
    const f = await media.probe(await source(dir));
    expect(f.width).toBe(1072);
    expect(f.height).toBe(1928);
    expect(f.fps).toBe(24);
    expect(f.frames).toBe(72);
    expect(f.seconds).toBeCloseTo(3, 1);
    expect(f.audio).toBe(true);
  }, T);

  it('normalize: 720x1280, 30 fps, 90 frames, a keyframe every 30 frames, facts from a fresh probe', async () => {
    const to = join(dir, 'norm.mp4');
    const f = await media.normalize(join(dir, 'src.mp4'), to, { width: 720, height: 1280, fps: 30, audio: true });
    expect(f).toMatchObject({ width: 720, height: 1280, fps: 30, frames: 90, audio: true });
    expect(f).toEqual(await media.probe(to));
    const r = await runProcess(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=key_frame', '-of', 'csv=p=0', to]);
    const keys = r.stdout.trim().split('\n').map((l, i) => (l.trim().startsWith('1') ? i : -1)).filter((i) => i >= 0);
    expect(keys).toEqual([0, 30, 60]);
    const head = readFileSync(to).subarray(0, 64).toString('latin1');
    expect(head).toContain('ftyp');
    const moov = readFileSync(to).indexOf('moov');
    const mdat = readFileSync(to).indexOf('mdat');
    expect(moov).toBeGreaterThan(0);
    expect(moov).toBeLessThan(mdat); // +faststart
  }, T);

  it('normalize: output is tagged BT.709 (space, transfer, primaries) for an untagged and a BT.601 source', async () => {
    const tags = async (f: string) => {
      const r = await runProcess(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_transfer,color_primaries', '-of', 'json', f]);
      return JSON.parse(r.stdout).streams[0];
    };
    const bt601 = join(dir, 'bt601.mp4');
    const made = await runProcess(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-colorspace', 'smpte170m', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m', bt601]);
    expect(made.code, made.stderr).toBe(0);
    expect((await tags(bt601)).color_space).toBe('smpte170m');
    for (const [name, src] of [['untagged', join(dir, 'src.mp4')], ['bt601', bt601]] as const) {
      const to = join(dir, `tag-${name}.mp4`);
      await media.normalize(src, to, { width: 720, height: 1280, fps: 30, audio: false });
      expect(await tags(to), name).toMatchObject({ color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709' });
    }
  }, T);

  it('normalize: sound dropped when asked', async () => {
    const f = await media.normalize(join(dir, 'src.mp4'), join(dir, 'mute.mp4'), { width: 720, height: 1280, fps: 30, audio: false });
    expect(f.audio).toBe(false);
  }, T);

  it('still: one jpg at a second', async () => {
    const to = join(dir, 'poster.jpg');
    await media.still(join(dir, 'src.mp4'), 1.5, to);
    expect(readFileSync(to).subarray(0, 2).toString('hex')).toBe('ffd8');
  }, T);

  it('sheet: one jpg of columns x rows tiles and the second of every tile', async () => {
    const to = join(dir, 'sheet.jpg');
    const { seconds } = await media.sheet(join(dir, 'src.mp4'), to, { columns: 3, rows: 2 });
    expect(seconds).toHaveLength(6);
    expect(seconds[0]).toBeCloseTo(0.25, 2);
    expect(seconds[5]).toBeCloseTo(2.75, 2);
    expect(statSync(to).size).toBeGreaterThan(1000);
    const r = await runProcess(FFPROBE, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', to]);
    const [w, h] = r.stdout.trim().split(',').map(Number);
    expect(w! / h!).toBeGreaterThan(0.75); // 3 portrait tiles side by side, 2 rows
  }, T);

  it('sheet: every tile shows the colour of its claimed second', async () => {
    const colours = ['red', 'lime', 'blue', 'yellow'];
    const src = join(dir, 'colours.mp4');
    const inputs = colours.flatMap((c) => ['-f', 'lavfi', '-i', `color=c=${c}:s=360x640:r=24:d=1`]);
    const made = await runProcess(FFMPEG, ['-y', ...inputs, '-filter_complex', '[0][1][2][3]concat=n=4:v=1:a=0', '-pix_fmt', 'yuv420p', src]);
    expect(made.code).toBe(0);
    const to = join(dir, 'colour-sheet.jpg');
    const { seconds } = await media.sheet(src, to, { columns: 2, rows: 2 });
    expect(seconds).toHaveLength(4);
    const raw = join(dir, 'sheet.rgb');
    const size = await runProcess(FFPROBE, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', to]);
    const [w, h] = size.stdout.trim().split(',').map(Number) as [number, number];
    const tw = w / 2, th = h / 2;
    const rgbAt = async (x: number, y: number) => {
      const r = await runProcess(FFMPEG, ['-y', '-v', 'error', '-i', to, '-vf', `crop=2:2:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
      expect(r.code, r.stderr).toBe(0);
      return [...readFileSync(raw)].slice(0, 3);
    };
    for (let i = 0; i < 4; i++) {
      const [r, g, b] = await rgbAt((i % 2) * tw + tw / 2, Math.floor(i / 2) * th + th / 2) as [number, number, number];
      const second = Math.floor(seconds[i]!);              // the colour of the claimed second
      const [er, eg, eb] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]][second] as [number, number, number];
      expect(Math.abs(r - er) + Math.abs(g - eg) + Math.abs(b - eb), `tile ${i} at ${seconds[i]} s`).toBeLessThan(90);
    }
  }, T);

  it('sheet: a gap around every tile, and the second of each tile written in its corner', async () => {
    const src = join(dir, 'blue.mp4');
    const made = await runProcess(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=0x2040c0:s=720x1280:r=30:d=4', '-pix_fmt', 'yuv420p', src]);
    expect(made.code, made.stderr).toBe(0);
    const to = join(dir, 'label-sheet.png');
    const grid = { columns: 4, rows: 3 };
    const { seconds } = await media.sheet(src, to, { ...grid, labels: true });
    const layout = sheetLayout({ width: 720, height: 1280 }, grid);
    expect(layout.tile).toEqual({ width: 360, height: 640 });                       // half the size of a 720-wide video: a hook can be read
    const raw = join(dir, 'label-sheet.rgb');
    const decoded = await runProcess(FFMPEG, ['-y', '-v', 'error', '-i', to, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
    expect(decoded.code, decoded.stderr).toBe(0);
    const rgb = readFileSync(raw);
    expect(rgb.length).toBe(layout.width * layout.height * 3);                       // the sheet has the size the layout says
    const at = (x: number, y: number): [number, number, number] => { const i = (y * layout.width + x) * 3; return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!]; };
    const gap = [1, 3, 5].map((k) => Number.parseInt(SHEET_GAP.colour.slice(k + 1, k + 3), 16));
    const isGap = (p: number[]) => p.every((c, k) => Math.abs(c - gap[k]!) < 16);
    const isBlue = (p: number[]) => p[2]! > 150 && p[0]! < 90;
    const labels = new Set<string>();
    for (let i = 0; i < seconds.length; i++) {
      const { x, y } = layout.origin(i);
      let white = '';
      let dark = 0;
      for (let yy = 0; yy < 40; yy++) for (let xx = 0; xx < 140; xx++) {
        const p = at(x + xx, y + yy);
        if (p.every((c) => c > 200)) white += `${xx},${yy};`;
        else if (p.every((c) => c < 70)) dark++;
      }
      expect(white.split(';').length, `the digits of tile ${i}`).toBeGreaterThan(60);
      expect(dark, `the plate of tile ${i}`).toBeGreaterThan(300);
      labels.add(white);
      expect(isBlue(at(x + layout.tile.width / 2, y + layout.tile.height / 2)), `the picture of tile ${i}`).toBe(true);
      expect(isGap(at(x - SHEET_GAP.padding / 2, y + layout.tile.height / 2)), `the gap left of tile ${i}`).toBe(true);
      expect(isGap(at(x + layout.tile.width / 2, y - SHEET_GAP.padding / 2)), `the gap above tile ${i}`).toBe(true);
      expect(isGap(at(x + layout.tile.width + 2, y + layout.tile.height + 2)), `the gap after tile ${i}`).toBe(true);
    }
    expect(labels.size).toBe(seconds.length);                                         // every tile carries its own second
  }, T);

  it('sheet: without labels the sheet is plain: 270 px tiles side by side, a tile starts with the frame\'s own pixels', async () => {
    const src = join(dir, 'plain.mp4');
    const made = await runProcess(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=0x2040c0:s=720x1280:r=30:d=4', '-pix_fmt', 'yuv420p', src]);
    expect(made.code, made.stderr).toBe(0);
    for (const grid of [{ columns: 4, rows: 3 }, { columns: 4, rows: 3, labels: false }]) {
      const to = join(dir, 'plain-sheet.png');
      await media.sheet(src, to, grid);
      const raw = join(dir, 'plain-sheet.rgb');
      const size = await runProcess(FFPROBE, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', to]);
      expect(size.stdout.trim()).toBe(`${4 * 270},${3 * 480}`);                         // no margin, no gaps
      const decoded = await runProcess(FFMPEG, ['-y', '-v', 'error', '-i', to, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
      expect(decoded.code, decoded.stderr).toBe(0);
      const rgb = readFileSync(raw);
      const W = 4 * 270;
      for (const [x, y] of [[0, 0], [270, 0], [0, 480], [3 * 270, 2 * 480]] as const) {   // the top left corner of tiles 0, 1, 4, 11
        const i = (y * W + x) * 3;
        expect([rgb[i]!, rgb[i + 1]!, rgb[i + 2]!].map((c, k) => Math.abs(c - [0x20, 0x40, 0xc0][k]!) < 30), `tile corner ${x},${y}`).toEqual([true, true, true]);
      }
    }
  }, T);

  it('sheet: labels asked for in a folder that is not there is a tool-failed, not a crash', async () => {
    await expect(media.sheet(join(dir, 'src.mp4'), join(dir, 'no', 'dir', 's.png'), { columns: 2, rows: 1, labels: true })).rejects.toMatchObject({ code: 'tool-failed' });
  }, T);

  it('sheet: with `at` the tiles are the frames at those seconds, in order, and the rest of the grid stays empty', async () => {
    const src = await solid(join(dir, 'at.mp4'), 24, [['red', 24], ['lime', 24], ['blue', 24], ['yellow', 24]]);
    // the last red frame, the first lime one, a blue one asked for between two frames, a yellow one after the end of the video
    const plain = join(dir, 'at-sheet.png');
    const { seconds } = await media.sheet(src, plain, { columns: 3, rows: 2, at: [23 / 24, 1, 2.49, 9] });
    expect(seconds).toEqual([23 / 24, 1, 60 / 24, 95 / 24]);                            // the seconds really taken: frames 23, 24, the nearest one (60) and the last one
    const sheet = await pixels(dir, plain);
    expect(sheet.width).toBe(3 * 270);
    const tiles = ['red', 'lime', 'blue', 'yellow', 'black', 'black'];
    tiles.forEach((colour, i) => expect(isColour(sheet.at((i % 3) * 270 + 135, Math.floor(i / 3) * 480 + 240), colour), `tile ${i} is ${colour}`).toBe(true));

    // the labelled sheet: the same frames, a label for each, and grey where no tile is
    const labelled = join(dir, 'at-labels.png');
    const grid = { columns: 2, rows: 2 };
    expect((await media.sheet(src, labelled, { ...grid, labels: true, at: [0.5, 1.5, 2.5] })).seconds).toEqual([0.5, 1.5, 2.5]);
    const layout = sheetLayout({ width: 360, height: 640 }, grid);
    const drawn = await pixels(dir, labelled);
    expect(drawn.width).toBe(layout.width);
    ['red', 'lime', 'blue', 'grey'].forEach((colour, i) => {
      const { x, y } = layout.origin(i);
      expect(isColour(drawn.at(x + layout.tile.width / 2, y + layout.tile.height / 2), colour), `tile ${i} is ${colour}`).toBe(true);
      expect(drawn.at(x + 4, y + 4).every((c) => c < 70), `the plate of tile ${i}`).toBe(colour !== 'grey');
    });
  }, T);

  it('sheet: `at` with more seconds than tiles, or with a tile that is not later than the one before it, is refused', async () => {
    const src = join(dir, 'at.mp4');
    await expect(media.sheet(src, join(dir, 'no.png'), { columns: 2, rows: 1, at: [0.5, 1.5, 2.5] })).rejects.toMatchObject({ code: 'tool-failed' });
    await expect(media.sheet(src, join(dir, 'no.png'), { columns: 2, rows: 1, at: [1.5, 0.5] })).rejects.toMatchObject({ code: 'tool-failed' });
    await expect(media.sheet(src, join(dir, 'no.png'), { columns: 2, rows: 1, at: [1.5, 1.51] })).rejects.toMatchObject({ code: 'tool-failed' });   // the same frame twice
    expect(existsSync(join(dir, 'no.png'))).toBe(false);
  }, T);

  /** The hard cuts of a video: what `cuts` told before it told the faint ones too. */
  const hard = async (file: string): Promise<number[]> => (await media.cuts(file)).seconds;

  it('cuts: the second at which each new shot starts, and none for one take', async () => {
    const src = await solid(join(dir, 'cuts.mp4'), 30, [['red', 51], ['lime', 30], ['blue', 31], ['yellow', 8]]);
    const cuts = await hard(src);
    expect(cuts.map((second) => Math.round(second * 30))).toEqual([51, 81, 112]);
    expect(cuts[0]).toBe(1.7);
    expect(await hard(join(dir, 'src.mp4'))).toEqual([]);                          // a test pattern that moves, and never cuts
    await expect(media.cuts(join(dir, 'nope.mp4'))).rejects.toMatchObject({ code: 'not-found' });
  }, T);

  // two greys 41 of 255 apart: a cut by the score of the picture (0.41), not by the score of a frame that is 44 % black bars (0.23)
  const GREYS: [string, number][] = [['0x505050', 30], ['0x808080', 30]];
  const SOFT: [string, number][] = [['0x505050', 30], ['0x686868', 30]];          // 21 apart: no cut, wherever it is measured

  it('cuts: a video with black bars beside its picture is measured in the picture, so its cut is found', async () => {
    const bars = '1920:1080:418:0';                                                // a 1084 wide picture in the middle of a 1920x1080 frame
    expect(await hard(await solid(join(dir, 'bars.mp4'), 30, GREYS, '1084x1080', bars))).toEqual([1]);
    expect(await hard(await solid(join(dir, 'bars-soft.mp4'), 30, SOFT, '1084x1080', bars))).toEqual([]);   // the picture is not measured more strictly than one without bars
  }, T);

  it('cuts: a video without bars is measured as before', async () => {
    expect(await hard(await solid(join(dir, 'whole.mp4'), 30, GREYS))).toEqual([1]);
    expect(await hard(await solid(join(dir, 'whole-soft.mp4'), 30, SOFT))).toEqual([]);
  }, T);

  it('cuts: a video that is dark from start to end is measured whole, not in the little of it that is lit', async () => {
    expect(await hard(await solid(join(dir, 'black.mp4'), 30, [['black', 30]]))).toEqual([]);          // nothing lit: no picture to crop to, and no error
    // a lit patch, 1/16 of the frame, that turns white: 0.09 over the frame, and 1 when the patch is taken for the picture
    expect(await hard(await solid(join(dir, 'patch.mp4'), 30, [['0x606060', 30], ['white', 30]], '120x120', '360:640:120:260'))).toEqual([]);
  }, T);

  it('cuts: a picture under half of the frame that runs its whole width or height (a wide video in a tall frame, and the other way round) is measured in the picture too', async () => {
    // 360x202 in 360x640 (32 % of the frame): a cut of 0.41 in the picture is 0.13 over the frame
    expect(await hard(await solid(join(dir, 'wide-in-tall.mp4'), 30, GREYS, '360x202', '360:640:0:219'))).toEqual([1]);
    expect(await hard(await solid(join(dir, 'wide-in-tall-soft.mp4'), 30, SOFT, '360x202', '360:640:0:219'))).toEqual([]);   // measured no more strictly than a video without bars
    expect(await hard(await solid(join(dir, 'tall-in-wide.mp4'), 30, GREYS, '202x360', '640:360:219:0'))).toEqual([1]);
  }, T);

  it('cuts: a lit area under half of the frame that does not run a whole side is no picture (a dark video with a window of light), and nor is a sliver', async () => {
    // a window with black on all four sides, 40 % of the frame: 0.41 inside it, 0.16 over the frame
    expect(await hard(await solid(join(dir, 'window.mp4'), 30, GREYS, '228x404', '360:640:66:118'))).toEqual([]);
    // a strip across the whole width, but 19 % of the frame: under the least a strip may be
    expect(await hard(await solid(join(dir, 'sliver.mp4'), 30, GREYS, '360x120', '360:640:0:260'))).toEqual([]);
  }, T);

  it('cuts: a video of one or two frames is measured as it is, with no error', async () => {
    expect(await hard(await solid(join(dir, 'one-frame.mp4'), 30, [['0x505050', 1]]))).toEqual([]);
    expect(await hard(await solid(join(dir, 'two-frames.mp4'), 30, [['0x505050', 1], ['0x808080', 1]]))).toEqual([0.0333333]);
    expect(await hard(await solid(join(dir, 'two-frames-bars.mp4'), 30, [['0x505050', 1], ['0x808080', 1]], '360x202', '360:640:0:219'))).toEqual([]);   // too short for cropdetect to print: whole frame, 0.13
  }, T);

  it('cuts: a lit line (wide, but with no height to it) is no picture to crop to, and no error', async () => {
    expect(await hard(await solid(join(dir, 'line.mp4'), 30, [['0x606060', 30], ['white', 30]], '2x100', '360:640:100:300'))).toEqual([]);
  }, T);

  // a 640x360 frame at 30 fps: a tall picture in its middle (a third of it) with black bars beside it, a moving pattern over all of it, one grey over all of it
  const tall = (colour: string, frames: number): string => `color=c=${colour}:s=202x360:r=30:d=${frames / 30},pad=640:360:219:0:black`;
  const pattern = (frames: number): string => `testsrc2=size=640x360:rate=30:duration=${frames / 30}`;
  const whole = (colour: string, frames: number): string => `color=c=${colour}:s=640x360:r=30:d=${frames / 30}`;
  const frameOf = (cuts: number[]): number[] => cuts.map((second) => Math.round(second * 30));

  it('cuts: a video that opens with a few seconds of a pattern over the whole frame is measured in the picture it shows after that: the cut in it is found, and the one from the pattern to it', async () => {
    const src = await joined(join(dir, 'opening.mp4'), [pattern(75), tall('0x505050', 90), tall('0x808080', 90)]);
    expect(frameOf(await hard(src))).toEqual([75, 165]);
  }, T);

  it('cuts: a video that ends with a few seconds of a card over the whole frame is measured in the picture it shows before that', async () => {
    const src = await joined(join(dir, 'ending.mp4'), [tall('0x505050', 90), tall('0x808080', 90), pattern(75)]);
    expect(frameOf(await hard(src))).toEqual([90, 180]);
  }, T);

  it('cuts: one frame that lights the whole frame (a flash) does not take the picture away', async () => {
    // the flash is 0.14 in the picture: no cut of its own
    const src = await joined(join(dir, 'flash.mp4'), [tall('0x505050', 30), whole('0x606060', 1), tall('0x505050', 29), tall('0x808080', 30)]);
    expect(frameOf(await hard(src))).toEqual([60]);
  }, T);

  it('cuts: a video that shows two areas about half of the time each has no picture of its own: it is measured in what is lit in any frame, as before', async () => {
    // the tall picture in 52 % of the frames, the whole frame in the rest: the cut in the picture (frame 32) is 0.13 over the frame
    const src = await joined(join(dir, 'two-areas.mp4'), [tall('0x505050', 32), tall('0x808080', 30), whole('0x505050', 56)]);
    expect(frameOf(await hard(src))).toEqual([62]);
  }, T);

  it('cuts: when the area most frames show is too small to be a picture, the video is measured in what is lit in any frame, as one without such an area is', async () => {
    // a square picture (18 % of the frame) in 70 % of the frames, the whole column it stands in (32 %) lit in the rest
    const boxed = (colour: string, frames: number, height: number, y: number): string => `color=c=${colour}:s=202x${height}:r=30:d=${frames / 30},pad=640:360:219:${y}:black`;
    const src = await joined(join(dir, 'square-then-column.mp4'), [boxed('0x303030', 42, 202, 79), boxed('0xf0f0f0', 42, 202, 79), boxed('0xf0f0f0', 36, 360, 0)]);
    expect(frameOf(await hard(src))).toEqual([42, 84]);
  }, T);

  it('cuts: a picture whose edge moves by a few pixels from part to part (a soft border) is one area all the same', async () => {
    // the tall picture 219, 225 and 221 from the left, then the whole frame: no one place of its edge is in most of the frames, three places near each other are
    const at = (x: number, colour: string, frames: number): string => `color=c=${colour}:s=202x360:r=30:d=${frames / 30},pad=640:360:${x}:0:black`;
    const src = await joined(join(dir, 'edge-moves.mp4'), [at(219, '0x505050', 30), at(225, '0x505050', 30), at(221, '0x808080', 30), whole('0x808080', 30)]);
    expect(frameOf(await hard(src))).toEqual([60]);
  }, T);

  // a 360x640 frame at 30 fps: one grey background, and on it a dark figure that stands `x` from the left. The figure 120 further on is a jump cut of 0.2
  const figure = (x: number, frames: number): string => `color=c=0x808080:s=360x640:r=30:d=${frames / 30},drawbox=x=${x}:y=200:w=160:h=240:color=0x202020:t=fill`;
  const frameAt = (cut: { second: number }): number => Math.round(cut.second * 30);

  it('cuts: a jump cut on one background, too soft to be a hard cut, is told as a faint cut with its score', async () => {
    const cuts = await media.cuts(await joined(join(dir, 'jump.mp4'), [figure(40, 45), figure(160, 45)]));
    expect(cuts.seconds).toEqual([]);
    expect(cuts.faint).toHaveLength(1);
    expect(cuts.faint[0]!.second).toBe(1.5);
    expect(cuts.faint[0]!.score).toBeGreaterThan(0.15);
    expect(cuts.faint[0]!.score).toBeLessThan(0.3);
  }, T);

  it('cuts: a hard cut is not a faint one too, and the faint cuts before and after it are told in order', async () => {
    const cuts = await media.cuts(await joined(join(dir, 'jump-hard.mp4'), [figure(40, 30), figure(160, 30), 'color=c=white:s=360x640:r=30:d=1', figure(40, 30), figure(160, 30)]));
    expect(cuts.seconds.map((second) => Math.round(second * 30))).toEqual([60, 90]);
    expect(cuts.faint.map(frameAt)).toEqual([30, 120]);
  }, T);

  it('cuts: a soft change is no faint cut when it is too slight, and when it does not stand alone among the frames around it', async () => {
    // the figure 20 further on: 0.03
    expect((await media.cuts(await joined(join(dir, 'jump-slight.mp4'), [figure(40, 45), figure(60, 45)]))).faint).toEqual([]);
    // there and back within 4 frames (an effect, as the two frames of a glitch are): each is as strong as the other
    expect((await media.cuts(await joined(join(dir, 'jump-back.mp4'), [figure(40, 45), figure(160, 4), figure(40, 45)]))).faint).toEqual([]);
    // 9 frames apart, each stands alone
    expect((await media.cuts(await joined(join(dir, 'jump-twice.mp4'), [figure(40, 45), figure(160, 9), figure(40, 45)]))).faint.map(frameAt)).toEqual([45, 54]);
    // 2 frames after a hard cut: the frames of the cut itself settling
    expect((await media.cuts(await joined(join(dir, 'jump-after-hard.mp4'), ['color=c=white:s=360x640:r=30:d=1', figure(40, 2), figure(160, 45)]))).faint).toEqual([]);
  }, T);

  it('cuts: a change that is a little under what a faint cut is, is motion, and a little over it is a cut', async () => {
    // the figure 60 further on: 0.10, the figure 80 further on: 0.14
    expect((await media.cuts(await joined(join(dir, 'jump-0-10.mp4'), [figure(40, 45), figure(100, 45)]))).faint).toEqual([]);
    expect((await media.cuts(await joined(join(dir, 'jump-0-14.mp4'), [figure(40, 45), figure(120, 45)]))).faint.map(frameAt)).toEqual([45]);
  }, T);

  it('cuts: a change stands alone when no change near it comes within 2.5 times of it, and does not when one does', async () => {
    // 0.21 and, 5 frames later, a change of 0.05 (4 times less): the cut stands out of it
    expect((await media.cuts(await joined(join(dir, 'jump-quiet.mp4'), [figure(40, 45), figure(160, 5), figure(130, 45)]))).faint.map(frameAt)).toEqual([45]);
    // 0.21 and, 5 frames later, a change of 0.10 (2 times less): the two are one movement
    expect((await media.cuts(await joined(join(dir, 'jump-stirred.mp4'), [figure(40, 45), figure(160, 5), figure(100, 45)]))).faint).toEqual([]);
  }, T);

  it('cuts: a video with hundreds of cuts among thousands of frames: every one is read, none lost where the cuts and the other frames are printed to one pipe', async () => {
    // 100 s that change between two greys every 4 frames
    const src = await joined(join(dir, 'many.mp4'), ["color=c=black:s=64x64:r=30:d=100,geq=lum='if(lt(mod(N,8),4),80,128)':cb=128:cr=128"]);
    const cuts = await media.cuts(src);
    expect(cuts.seconds.map((second) => Math.round(second * 30))).toEqual(Array.from({ length: 749 }, (_, i) => 4 * (i + 1)));
    expect(cuts.faint).toEqual([]);
  }, T);

  it('sheet: tiles shrink when many columns are asked for, and never exceed the video', () => {
    expect(sheetLayout({ width: 720, height: 1280 }, { columns: 8, rows: 2 }).tile.width).toBeLessThan(360);
    expect(sheetLayout({ width: 720, height: 1280 }, { columns: 8, rows: 2 }).width).toBeLessThanOrEqual(1600);
    expect(sheetLayout({ width: 240, height: 426 }, { columns: 2, rows: 2 }).tile.width).toBe(240);
  });

  it('still: a real "no frame" run leaves an old file at `to` untouched and reports failure', async () => {
    const to = join(dir, 'old.jpg');
    writeFileSync(to, 'OLD');
    await expect(media.still(join(dir, 'src.mp4'), 100, to)).rejects.toMatchObject({ code: 'tool-failed' });
    expect(readFileSync(to, 'utf8')).toBe('OLD');
  }, T);

  it('not-found for a missing file, not-media for a text file', async () => {
    await expect(media.probe(join(dir, 'nope.mp4'))).rejects.toMatchObject({ name: 'MediaError', code: 'not-found' });
    const txt = join(dir, 'a.txt');
    writeFileSync(txt, 'hello');
    await expect(media.probe(txt)).rejects.toMatchObject({ code: 'not-media' });
    await expect(media.normalize(txt, join(dir, 'x.mp4'), { width: 720, height: 1280, fps: 30, audio: true })).rejects.toBeInstanceOf(MediaError);
  }, T);

  it('trim: a range of a 10 s clip comes out re-encoded, 4.5 s long, with sound and the same size', async () => {
    const long = join(dir, 'long.mp4');
    const made = await runProcess(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
      '-c:v', 'libx264', '-g', '240', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', long]);
    if (made.code !== 0) throw new Error(made.stderr);
    const out = join(dir, 'trimmed.mp4');
    const r = await media.trim(long, 2, 6.5, out);
    expect(r.seconds).toBeGreaterThan(4.4);
    expect(r.seconds).toBeLessThan(4.6);
    expect(r.audio).toBe(true);
    expect([r.width, r.height]).toEqual([360, 640]);
    expect((await media.probe(out)).seconds).toBeCloseTo(4.5, 1);
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp.mp4'))).toEqual([]);
  }, T);

  it('trim: a start so small that a number prints it with an exponent still cuts (ffmpeg gets a plain decimal)', async () => {
    const long = join(dir, 'long.mp4');
    if (!existsSync(long)) await runProcess(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24:duration=10', '-pix_fmt', 'yuv420p', long]);
    const out = join(dir, 'tiny-start.mp4');
    expect((await media.trim(long, 1e-7, 4, out)).seconds).toBeGreaterThan(3.9);
  }, T);

  it('trim: a range that is not finite, not ascending, negative or past the end is refused before ffmpeg runs', async () => {
    const long = join(dir, 'long.mp4');
    if (!existsSync(long)) await runProcess(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24:duration=10', '-pix_fmt', 'yuv420p', long]);
    const out = join(dir, 'never.mp4');
    for (const [from, to] of [[6, 2], [3, 3], [Number.NaN, 4], [1, Number.NaN], [-1, 4], [0, Number.POSITIVE_INFINITY], [2, 10.5]] as [number, number][]) {
      await expect(media.trim(long, from, to, out), `${from}..${to}`).rejects.toMatchObject({ name: 'MediaError', code: 'bad-range' });
    }
    expect(existsSync(out)).toBe(false);
    const tool = createMedia('/no/ffmpeg', FFPROBE);                       // a missing ffmpeg would say tool-failed: bad-range comes first
    await expect(tool.trim(long, 6, 2, out)).rejects.toMatchObject({ code: 'bad-range' });
  }, T);

  it('tool-failed when the output cannot be written', async () => {
    await expect(media.still(join(dir, 'src.mp4'), 1, join(dir, 'no-such-dir', 'p.jpg'))).rejects.toMatchObject({ code: 'tool-failed' });
  }, T);
});

describe('createMedia with a missing tool', () => {
  it('tool-failed', async () => {
    const media = createMedia('/no/ffmpeg', '/no/ffprobe');
    const dir = mkdtempSync(join(tmpdir(), 've-media-'));
    const f = join(dir, 'a.mp4');
    writeFileSync(f, 'x');
    await expect(media.probe(f)).rejects.toMatchObject({ code: 'tool-failed' });
  });
});

const SWS = 'accurate_rnd+full_chroma_int';
const COLOURS: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [40, 140, 70]];

/** A 1 s clip of one flat RGB colour, "really encoded" with `matrix` and `range`, carrying `tags` (or none). */
async function flatSource(file: string, w: number, h: number, rgb: [number, number, number], matrix: 'bt709' | 'smpte170m', tags: 'none' | 'bt709' | 'smpte170m', range: 'tv' | 'pc' = 'tv') {
  const ppm = `${file}.ppm`;
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6 ${w} ${h} 255\n`), Buffer.alloc(w * h * 3).map((_, i) => rgb[i % 3]!)]));
  const set = tags === 'none' ? 'colorspace=unknown:color_primaries=unknown:color_trc=unknown' : `colorspace=${tags}:color_primaries=${tags}:color_trc=${tags}`;
  const pix = range === 'pc' ? 'yuvj420p' : 'yuv420p';
  const r = await runProcess(FFMPEG, ['-v', 'error', '-y', '-loop', '1', '-framerate', '24', '-i', ppm, '-t', '1',
    '-vf', `scale=out_color_matrix=${matrix}:out_range=${range}:flags=${SWS},format=${pix},setparams=${set}`, '-c:v', 'libx264', '-g', '24', file]);
  expect(r.code, r.stderr).toBe(0);
}
/** Decodes the centre of a clip as BT.709 limited range (or reads the raw Y plane) and returns the bytes. */
async function centre(file: string, filter: string, bytes: number): Promise<number[]> {
  const raw = `${file}.raw`;
  const r = await runProcess(FFMPEG, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', `crop=4:4:in_w/2-2:in_h/2-2,${filter}`, '-f', 'rawvideo', raw]);
  expect(r.code, r.stderr).toBe(0);
  return [...readFileSync(raw)].slice(0, bytes);
}
const asRgb709 = `setparams=colorspace=bt709:range=tv,scale=in_color_matrix=bt709:in_range=tv:flags=${SWS},format=rgb24`;

describe.skipIf(!have)('normalize keeps colours (decoded as BT.709 limited range, +-3 per channel)', () => {
  const dir = mkdtempSync(join(tmpdir(), 've-media-colour-'));
  const media = createMedia(FFMPEG, FFPROBE);
  const target = { width: 720, height: 1280, fps: 30, audio: false };
  const cases: [string, number, number, 'bt709' | 'smpte170m', 'none' | 'bt709' | 'smpte170m'][] = [
    ['untagged, 709-encoded, 1072x1928', 1072, 1928, 'bt709', 'none'],
    ['tagged smpte170m, 601-encoded', 640, 480, 'smpte170m', 'smpte170m'],
    ['untagged, 601-encoded, 640x480 (SD rule)', 640, 480, 'smpte170m', 'none'],
  ];
  for (const [name, w, h, matrix, tags] of cases) {
    it(`${name}: red, green, blue and (40,140,70) survive`, async () => {
      const seen: string[] = [];
      for (const [i, rgb] of COLOURS.entries()) {
        const src = join(dir, `c-${name.length}-${w}-${i}.mp4`);
        await flatSource(src, w, h, rgb, matrix, tags);
        const to = `${src}.out.mp4`;
        await media.normalize(src, to, target);
        const got = await centre(to, asRgb709, 3);
        seen.push(`${rgb} -> ${got}`);
        got.forEach((v, k) => expect(Math.abs(v - rgb[k]!), `${name}: ${seen.join(' | ')}`).toBeLessThanOrEqual(3));
      }
    }, T);
  }

  it('full-range (yuvj420p) 709 source: black -> Y 16, white -> Y 235; output tags tv, bt709 x3', async () => {
    for (const [rgb, y] of [[[0, 0, 0], 16], [[255, 255, 255], 235]] as const) {
      const src = join(dir, `full-${y}.mp4`);
      await flatSource(src, 640, 480, [...rgb], 'bt709', 'bt709', 'pc');
      const to = `${src}.out.mp4`;
      await media.normalize(src, to, target);
      const [got] = await centre(to, 'extractplanes=y', 1);
      expect(Math.abs(got! - y), `Y ${got}`).toBeLessThanOrEqual(1);
      const t = await runProcess(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_range,color_space,color_transfer,color_primaries', '-of', 'csv=p=0', to]);
      expect(t.stdout.trim()).toBe('tv,bt709,bt709,bt709');
    }
  }, T);

  it('the ffmpeg arguments carry no -colorspace / -color_primaries / -color_trc', async () => {
    const d = mkdtempSync(join(tmpdir(), 've-ffargs-'));
    const log = join(d, 'args');
    const bin = join(d, 'ffmpeg');
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\nexit 1\n`);
    chmodSync(bin, 0o755);
    const src = join(d, 's.mp4');
    await flatSource(src, 1072, 1928, [10, 20, 30], 'bt709', 'none');
    await expect(createMedia(bin, FFPROBE).normalize(src, join(d, 'o.mp4'), target)).rejects.toMatchObject({ code: 'tool-failed' });
    const args = readFileSync(log, 'utf8').split('\n');
    expect(args).not.toContain('-colorspace');
    expect(args).not.toContain('-color_primaries');
    expect(args).not.toContain('-color_trc');
    const vf = args[args.indexOf('-vf') + 1]!;
    expect(vf).toContain(`in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv:flags=${SWS}`);
    expect(vf).toContain('setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709');
  }, T);
});

/** A stub ffmpeg: writes a partial file to its last argument, then exits with the given code (or writes nothing). */
function stubFfmpeg(code: number, writes: boolean): string {
  const d = mkdtempSync(join(tmpdir(), 've-ffstub-'));
  const bin = join(d, 'ffmpeg');
  writeFileSync(bin, `#!/bin/sh\nfor a in "$@"; do last="$a"; done\n${writes ? 'echo partial > "$last"' : ''}\nexit ${code}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe.skipIf(!have)('output files are written to a temp name and renamed on success', () => {
  const dir = mkdtempSync(join(tmpdir(), 've-media-atomic-'));
  const src = join(dir, 'src.mp4');
  const target = { width: 720, height: 1280, fps: 30, audio: true };
  it('normalize: ffmpeg dies mid-run -> no file at `to`, no leftover temp file', async () => {
    await runProcess(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-pix_fmt', 'yuv420p', src]);
    const media = createMedia(stubFfmpeg(1, true), FFPROBE);
    const to = join(dir, 'out.mp4');
    await expect(media.normalize(src, to, target)).rejects.toMatchObject({ code: 'tool-failed' });
    expect(existsSync(to)).toBe(false);
    expect(readdirSync(dir)).toEqual(['src.mp4']);
  });
  it('normalize: an old file at `to` is kept when the run fails', async () => {
    const to = join(dir, 'old.mp4');
    writeFileSync(to, 'OLD');
    await expect(createMedia(stubFfmpeg(1, true), FFPROBE).normalize(src, to, target)).rejects.toMatchObject({ code: 'tool-failed' });
    expect(readFileSync(to, 'utf8')).toBe('OLD');
  });
  it('still: exit 0 but no frame written, with an old file at `to` -> failure, not success', async () => {
    const to = join(dir, 'old.jpg');
    writeFileSync(to, 'OLD');
    await expect(createMedia(stubFfmpeg(0, false), FFPROBE).still(src, 100, to)).rejects.toMatchObject({ code: 'tool-failed' });
    expect(readFileSync(to, 'utf8')).toBe('OLD');
  });
});

/** An ffprobe that writes its arguments, one run per line, to `log` and then runs the real one. */
function recordingFfprobe(log: string): string {
  const d = mkdtempSync(join(tmpdir(), 've-fpstub-'));
  const bin = join(d, 'ffprobe');
  writeFileSync(bin, `#!/bin/sh\necho "$*" >> "${log}"\nexec ${FFPROBE} "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe.skipIf(!have)('still checks the file without decoding all of it', () => {
  const dir = mkdtempSync(join(tmpdir(), 've-still-'));
  const log = join(dir, 'ffprobe.log');
  const media = createMedia(FFMPEG, recordingFfprobe(log));
  beforeAll(async () => { await source(dir); }, T);

  it('takes a frame without asking ffprobe to count the frames, and probe still counts them', async () => {
    await media.still(join(dir, 'src.mp4'), 1, join(dir, 'frame.jpg'));
    expect(existsSync(join(dir, 'frame.jpg'))).toBe(true);
    expect(readFileSync(log, 'utf8')).not.toContain('-count_frames');
    await media.probe(join(dir, 'src.mp4'));
    expect(readFileSync(log, 'utf8')).toContain('-count_frames');
  }, T);

  it('keeps the error kinds: a missing file is not-found, a text file and an empty file are not-media, a second after the end is tool-failed', async () => {
    const to = join(dir, 'never.jpg');
    await expect(media.still(join(dir, 'nope.mp4'), 1, to)).rejects.toMatchObject({ name: 'MediaError', code: 'not-found' });
    const txt = join(dir, 'a.txt');
    writeFileSync(txt, 'hello');
    await expect(media.still(txt, 1, to)).rejects.toMatchObject({ code: 'not-media' });
    const empty = join(dir, 'empty.mp4');
    writeFileSync(empty, '');
    await expect(media.still(empty, 0, to)).rejects.toMatchObject({ code: 'not-media' });
    await expect(media.still(join(dir, 'src.mp4'), 100, to)).rejects.toMatchObject({ code: 'tool-failed' });
    expect(existsSync(to)).toBe(false);
  }, T);
});
