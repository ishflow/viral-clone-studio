// Real HyperFrames, real Chrome, real ffmpeg: `pnpm test:render`. Skipped when the CLI or Chrome is missing.
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RenderError } from '../ports.ts';
import { fixtureTimeline, writeFixtureComposition } from './fixtures/composition.ts';
import { readBar } from './framebar.ts';
import { hardwareEncoderFault } from './encode.ts';
import { createMeasure } from './measure.ts';
import { createRenderer } from './renderer.ts';

const BIN = resolve(import.meta.dirname, '../../node_modules/.bin/hyperframes');
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const CHROME = join(homedir(), '.cache', 'hyperframes', 'chrome');
const available = existsSync(BIN) && existsSync(FFMPEG) && existsSync(FFPROBE) && existsSync(CHROME) && readdirSync(CHROME).length > 0;
const MASTER = { lufs: -14, peak: -1 };
/** null where h264_videotoolbox works: only there the hardware path is rendered for real. */
const noHardware = available ? await hardwareEncoderFault(FFMPEG, 60_000) : 'not tried';

describe.skipIf(!available)('createRenderer with the real HyperFrames CLI', () => {
  const measure = createMeasure(FFMPEG, FFPROBE);
  const renderer = createRenderer({ bin: BIN, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure });
  const work = mkdtempSync(join(tmpdir(), 've-renderer-real-'));
  const good = join(work, 'good');
  const good2 = join(work, 'good2');

  it('is ready', async () => {
    expect(await renderer.ready()).toEqual({ ready: true, note: null });
  });

  it('checks a good composition: no issue', async () => {
    await writeFixtureComposition(good, { master: MASTER, ffmpeg: FFMPEG });
    expect(await renderer.check(good)).toEqual({ ok: true, issues: [] });
  });

  const paths = [['cli', false], ['hardware', noHardware !== null]] as const;
  it.skipIf(noHardware !== null)('is ready on the hardware path: the encoder is there', async () => {
    expect(await createRenderer({ bin: BIN, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure, encode: 'hardware' }).ready()).toEqual({ ready: true, note: null });
  });

  for (const [path, skip] of paths) it.skipIf(skip)(`renders it on the ${path} path: 720x1280, 30 fps, 60 frames, sound; progress reaches 60/60; the loudness lands on the target or on the peak ceiling`, async () => {
    const to = join(work, `out-${path}`, 'good.mp4');
    const seen: { frame: number; frames: number }[] = [];
    const facts = await createRenderer({ bin: BIN, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure, encode: path }).render(good, to, (p) => seen.push(p));
    expect(facts).toMatchObject({ width: 720, height: 1280, fps: 30, frames: 60, audio: true, encode: path, note: null });
    expect(Math.abs(facts.seconds - 2)).toBeLessThanOrEqual(0.05);                      // the sound is as long as the picture
    const stages = facts.stages.map((stage) => stage.stage);
    expect(stages).toContain('cli.capture');
    expect(stages.filter((stage) => !stage.startsWith('cli.'))).toEqual(path === 'cli' ? ['cli', 'probe', 'loudness', 'gain', 'verify'] : ['cli', 'loudness', 'pass', 'verify']);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toEqual({ frame: 60, frames: 60 });
    expect(seen.map((p) => p.frame)).toEqual([...seen.map((p) => p.frame)].sort((a, b) => a - b));
    expect(readdirSync(join(work, `out-${path}`))).toEqual(['good.mp4']);

    const streams = await measure.streams(to);
    expect(streams).toMatchObject({ width: 720, height: 1280, fps: 30, frames: 60, codec: 'h264', pixelFormat: 'yuv420p', constantRate: true });
    expect(streams.colour).toEqual({ space: 'bt709', transfer: 'bt709', primaries: 'bt709' });
    if (path === 'hardware') {                                                          // the CLI's hardware encoder: a keyframe at least every second
      const gaps = streams.keyframes.map((k, i) => (streams.keyframes[i + 1] ?? streams.frames) - k);
      expect(streams.keyframes[0]).toBe(0);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(30);
    }
    expect(streams.sound).toMatchObject({ codec: 'aac', sampleRate: 48000 });

    const loud = (await measure.loudness(to))!;
    const onTarget = Math.abs(loud.integrated - MASTER.lufs) <= 0.5;
    const peakLimited = loud.truePeak <= MASTER.peak + 0.5 && loud.truePeak >= MASTER.peak - 1.0;   // the pass keeps 0.5 dB under the ceiling
    expect(onTarget || peakLimited, `integrated ${loud.integrated}, true peak ${loud.truePeak}`).toBe(true);
    expect(loud.truePeak).toBeLessThanOrEqual(MASTER.peak + 0.5);

    // the frames are the ones the timeline says: output frame 0 shows source frame 0 of clip A, frame 30 shows frame 60 of clip B
    const bar = async (frame: number) => { const p = await measure.picture(to, frame); return readBar(p.rgb, p.width, p.height); };
    expect(await bar(0)).toBe(0);
    expect(await bar(30)).toBe(60);
    expect(await bar(59)).toBe(89);
  });

  it('without a master the sound is left as the CLI made it', async () => {
    await writeFixtureComposition(good2, { master: null, ffmpeg: FFMPEG });
    const to = join(work, 'out', 'plain.mp4');
    const facts = await renderer.render(good2, to, () => {});
    expect(facts).toMatchObject({ frames: 60, audio: true });
  });

  it('check reports a missing asset', async () => {
    const bad = join(work, 'bad');
    await writeFixtureComposition(bad, { master: null, ffmpeg: FFMPEG, missingAsset: true });
    const { ok, issues } = await renderer.check(bad);
    expect(ok).toBe(false);
    expect(issues.some((i) => i.code === 'missing_local_asset' && i.message.includes('assets/clip-b.mp4'))).toBe(true);
  });

  it('check reports text that does not fit and a font that is not there', async () => {
    const bad = join(work, 'bad2');
    await writeFixtureComposition(bad, { master: null, ffmpeg: FFMPEG });
    const html = join(bad, 'index.html');
    const { readFileSync } = await import('node:fs');
    writeFileSync(html, readFileSync(html, 'utf8')
      .replace('scent layering combo</div>', 'scent layering combo that is far too long for its box and the whole canvas width</div>')
      .replace('inter-latin-wght-normal.woff2") format', 'missing.woff2") format'));
    const { ok, issues } = await renderer.check(bad);
    expect(ok).toBe(false);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('text_box_overflow');
    expect(codes).toContain('http_error');
    expect(issues.find((i) => i.code === 'text_box_overflow')).toMatchObject({ target: 't-hook', second: 1 });
  });

  it('a render that the CLI refuses is a RenderError and leaves nothing', async () => {
    const empty = join(work, 'empty');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(empty);
    writeFileSync(join(empty, 'timeline.json'), JSON.stringify(fixtureTimeline(null)));
    const to = join(work, 'out2', 'x.mp4');
    const e = await renderer.render(empty, to, () => {}).catch((x) => x);
    expect(e).toBeInstanceOf(RenderError);
    expect(e.message).toMatch(/No composition found|index\.html/);
    expect(readdirSync(join(work, 'out2'))).toEqual([]);
  });
});
