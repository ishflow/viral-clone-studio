// The whole produce handler with the real pieces (`pnpm test:render`): the layering golden, and the same with a generated
// still that three first frames are made from, one variant each. The fake generator
// makes real files on this machine (clips that carry a frame bar), the real ffmpeg normalises and measures them, the real
// HyperFrames checks and renders, and the real quality checks read the result. Nothing is requested from anyone; no aligner,
// no Python. The only fakes are the language model (it answers the golden fill) and the recogniser (a beats video has no speech).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeGenerator } from '../adapters/fake-generator.ts';
import { readBar } from '../adapters/framebar.ts';
import { FakeClock, FakeLlm, FakeTranscriber } from '../adapters/fakes.ts';
import { createMeasure } from '../adapters/measure.ts';
import { createMedia } from '../adapters/media.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { available, decode, probe, readShot, showsExpected } from '../compose/golden-helpers.ts';
import type { Picture } from '../compose/golden-helpers.ts';
import { getRun } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import type { Timeline } from '../edit/timeline.ts';
import { paidFor } from '../template/estimate.ts';
import type { TemplateJson } from '../template/schema.ts';
import type { Quality } from './assemble.ts';
import { produceHandler } from './index.ts';
import { answerOf, golden, goldenWithStill, inputOf, seed, startRun, workspace } from './testing.ts';

const BIN = resolve(import.meta.dirname, '../../node_modules/.bin/hyperframes');
const find = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find((path) => existsSync(path)) ?? name;
const FFMPEG = find('ffmpeg');
const FFPROBE = find('ffprobe');
const SLOW = 1_000_000;                                      // the machine is shared: nothing here is judged by the clock

interface LogLine { kind: 'image' | 'clip' | 'music' | 'voice'; seconds: number | null; ticket: string }

describe.skipIf(!available).each([
  ['layering-01', () => golden('layering-01')], ['layering-01 with a still', () => goldenWithStill()],
] as const)('produce with the real pieces: %s, one variant', (_name, fixture) => {
  let template: TemplateJson;
  let dataDir: string;
  let run: RunRow;
  let log: LogLine[];
  let timeline: Timeline;
  let pictures: Map<number, Picture>;
  const file = (name: string) => join(dataDir, 'jobs', run.id, name);
  const said = (name: string) => (existsSync(file(name)) ? readFileSync(file(name), 'utf8') : `no ${name}`);

  beforeAll(async () => {
    const { dir, db } = workspace();
    const { template: golden_, fill } = fixture();
    template = golden_;
    dataDir = dir;
    seed(template, fill);
    const clock = new FakeClock();
    const claimed = startRun(db, clock, template, inputOf(template, fill, 1));
    const logFile = join(dir, 'fake-generator.log');
    const measure = createMeasure(FFMPEG, FFPROBE);
    await produceHandler({
      db, clock, measure,
      llm: new FakeLlm([answerOf(fill, 1)]),
      generator: createFakeGenerator({ log: logFile, ffmpeg: FFMPEG, clock }),
      media: createMedia(FFMPEG, FFPROBE),
      renderer: createRenderer({ bin: BIN, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure }),
      transcriber: new FakeTranscriber(),
    })(claimed);
    run = getRun(db, claimed.id)!;
    log = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((row) => row !== '').map((row) => JSON.parse(row) as LogLine) : [];
    if (run.state !== 'done') return;
    timeline = JSON.parse(readFileSync(file('v1/timeline.json'), 'utf8')) as Timeline;
    // the frames to look at come from template.json: around every cut, the frame before it and the frames of the way in
    const wanted = template.shots.slice(1).flatMap((shot) => Array.from({ length: wayIn(shot) + 2 }, (_, i) => shot.at! - 1 + i));
    pictures = decode(file('v1/final.mp4'), template.canvas.width, template.canvas.height, wanted);
  }, SLOW);
  /** The frames a shot's transition takes, as the template gives them; a plain cut takes none. */
  const wayIn = (shot: TemplateJson['shots'][number]): number => (shot.in as { frames?: number } | undefined)?.frames ?? 0;

  it('the run is done with one variant, and every step is done', () => {
    expect(run.state, `${said('stop.json')}\n${said('v1/quality.json')}`).toBe('done');
    expect(run.result).toEqual({ kind: 'produce', variants: [{ video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg` }] });
    expect(run.variants).toEqual([{ n: 1, status: 'done', video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg`, reason: null }]);
    expect(run.steps.map((step) => [step.key, step.status])).toEqual(['adaptation', 'images', 'clips', 'music', 'edit', 'render'].map((key) => [key, 'done']));
  });

  it('final.mp4 has the template\'s exact frame count at 720×1280 and 30 fps, with sound', () => {
    const frames = Math.max(...template.shots.map((shot) => shot.at! + shot.for!));
    expect(frames).toBe(240);
    expect(probe(file('v1/final.mp4'))).toMatchObject({ width: 720, height: 1280, fps: '30/1', frames, audio: true });
  });

  it('the cuts are on the template\'s frames: the frame bar of each clip says which source frame is on screen', () => {
    // Which source frame a decoded frame should show is told by template.json alone: where each shot begins, how long it is,
    // how long its way in takes. The run's frame table is used only for where a shot is drawn on a frame (its scale and place).
    const byTemplate: Timeline = { ...timeline, shots: timeline.shots.map((shot, i) => ({ ...shot, at: template.shots[i]!.at!, for: template.shots[i]!.for!, from: 0 })) };
    /** Shot `index` shows its frame `f − at` on frame `f`: both digits of the bar were read, so a slip of one frame fails on the units and a slip of thirty on the thirties. */
    const shows = (index: number, f: number, what: string): void => {
      const reading = readShot(byTemplate, pictures.get(f)!, index, f);
      expect(reading?.units ?? null, `${what}: the units digit cannot be read`).not.toBeNull();
      expect(reading?.thirties ?? null, `${what}: the thirties digit cannot be read`).not.toBeNull();
      expect(showsExpected(reading), `${what}: ${JSON.stringify(reading)}`).toBe(true);
    };
    template.shots.slice(1).forEach((shot, k) => {
      const cut = shot.at!, before = template.shots[k]!;
      shows(k, cut - 1, `${before.id} on frame ${cut - 1}, its last (source frame ${before.for! - 1})`);
      shows(k + 1, cut + wayIn(shot), `${shot.id} on frame ${cut + wayIn(shot)}, after its way in (source frame ${wayIn(shot)})`);
      // inside the way in: wherever the incoming bar can be read, it is the expected frame
      for (let f = cut; f < cut + wayIn(shot); f++) expect(showsExpected(readShot(byTemplate, pictures.get(f)!, k + 1, f)), `${shot.id} on frame ${f}`).not.toBe(false);
    });

    // The plain reader of the bar knows nothing of any table: it reads the frame number off the picture. Where a clip is
    // alone and not scaled (a shot without motion, after its way in, up to its last frame) that number is `f − at` of the template.
    const read: [string, number, number | null][] = [];
    for (const shot of template.shots.slice(1, -1)) {
      if (shot.motion !== undefined) continue;
      for (const f of [shot.at! + wayIn(shot), shot.at! + shot.for! - 1]) {
        const picture = pictures.get(f)!;
        read.push([shot.id, f, readBar(picture.rgb, picture.width, picture.height)]);
      }
    }
    expect(read).toEqual([['s2', 45, 6], ['s2', 86, 47], ['s3', 87, 0], ['s3', 124, 37], ['s4', 125, 0], ['s4', 169, 44]]);

    // and the frame table the run wrote says the same as the template
    expect(timeline.shots.map((shot) => [shot.id, shot.at, shot.for, shot.from])).toEqual(template.shots.map((shot) => [shot.id, shot.at, shot.for, 0]));
    expect(timeline.transitions.map((t) => t.cut)).toEqual(template.shots.slice(1).map((shot) => shot.at));
  });

  it('the fake generator\'s log has exactly the requests paidFor counts, and the run says the same', () => {
    const need = paidFor(template, 1);
    const of = (kind: LogLine['kind']) => log.filter((line) => line.kind === kind);
    expect({
      images: of('image').length, clips: of('clip').length, clipSeconds: of('clip').reduce((sum, line) => sum + (line.seconds ?? 0), 0),
      music: of('music').length, voice: of('voice').length,
    }).toEqual(need);
    expect(log.length).toBe(need.images + need.clips + need.music + need.voice);
    expect(new Set(log.map((line) => line.ticket)).size).toBe(log.length);
    expect(run.sent).toEqual(need);
  });

  it('the poster is a picture of the video, and the checks found no error', () => {
    expect(probe(file('v1/poster.jpg'))).toMatchObject({ width: 720, height: 1280 });
    const quality = JSON.parse(said('v1/quality.json')) as Quality;
    expect(quality.stopped).toBeNull();
    expect(quality.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
