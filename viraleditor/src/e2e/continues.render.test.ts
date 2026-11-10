// Shots that continue a clip, through the whole produce handler with the real pieces (`VE_RENDER=1`): layering-01 where shots
// 2 and 3 continue the clip of shot 1. The fake generator makes real clips that carry a frame bar, the real ffmpeg normalises
// and measures them, HyperFrames renders, the real quality checks read the result. Nothing is requested from anyone. The data
// folder is a temp dir under the run's temp root (testing/global-setup.ts), which is removed when the run ends.
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
import type { Quality } from '../produce/assemble.ts';
import { produceHandler } from '../produce/index.ts';
import { answerOf, goldenWithParts, inputOf, seed, startRun, workspace } from '../produce/testing.ts';
import { paidFor } from '../template/estimate.ts';
import type { TemplateJson } from '../template/schema.ts';

const BIN = resolve(import.meta.dirname, '../../node_modules/.bin/hyperframes');
const find = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find((path) => existsSync(path)) ?? name;
const FFMPEG = find('ffmpeg');
const FFPROBE = find('ffprobe');
const SLOW = 1_000_000;                                      // the machine is shared: nothing here is judged by the clock

interface LogLine { kind: 'image' | 'clip' | 'music' | 'voice'; seconds: number | null; ticket: string }

/**
 * Where each shot's part lies in its clip, worked out by hand (not by the engine): the clip of s1 is asked for 5 s, 150 frames;
 * its parts show 39 + 48 + 38 = 125 of them, so 25 frames are unused, split 13 and 12 into the two gaps. s4 and s5 own their clips.
 */
const FROM: Record<string, number> = { s1: 0, s2: 39 + 13, s3: 39 + 13 + 48 + 12, s4: 0, s5: 0 };

describe.skipIf(!available)('produce with the real pieces: shots 2 and 3 continue the clip of shot 1', () => {
  let template: TemplateJson;
  let dataDir: string;
  let run: RunRow;
  let log: LogLine[];
  let timeline: Timeline;
  let pictures: Map<number, Picture>;
  const file = (name: string) => join(dataDir, 'jobs', run.id, name);
  const said = (name: string) => (existsSync(file(name)) ? readFileSync(file(name), 'utf8') : `no ${name}`);
  const shot = (id: string) => template.shots.find((each) => each.id === id)!;

  beforeAll(async () => {
    const { dir, db } = workspace();
    const { template: parts, fill } = goldenWithParts();
    template = parts;
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
    // the first and the last frame of every shot but the last (s5 comes in by a crossfade and moves)
    const wanted = template.shots.slice(0, -1).flatMap((each) => [each.at!, each.at! + each.for! - 1]);
    pictures = decode(file('v1/final.mp4'), template.canvas.width, template.canvas.height, wanted);
  }, SLOW);

  it('the run is done, and the requests are 3 images, 3 clips and the music: sent is what was approved', () => {
    expect(run.state, `${said('stop.json')}\n${said('v1/quality.json')}`).toBe('done');
    const need = paidFor(template, 1);
    expect(need).toEqual({ images: 3, clips: 3, clipSeconds: 13, music: 1, voice: 0 });
    const of = (kind: LogLine['kind']) => log.filter((line) => line.kind === kind);
    expect({
      images: of('image').length, clips: of('clip').length, clipSeconds: of('clip').reduce((sum, line) => sum + (line.seconds ?? 0), 0),
      music: of('music').length, voice: of('voice').length,
    }).toEqual(need);
    expect(new Set(log.map((line) => line.ticket)).size).toBe(log.length);
    expect(run.approved).toEqual(need);
    expect(run.sent).toEqual(run.approved);
  });

  it('the frame bars: shot 1 shows its clip from frame 0, shot 3 ends on the clip\'s last frame, shot 2 lies evenly between', () => {
    expect(probe(file('v1/final.mp4'))).toMatchObject({ width: 720, height: 1280, fps: '30/1', frames: 240 });
    expect(probe(file('v1/clips/s1.mp4')).frames).toBe(150);                   // the clip of s1 as it came, normalised: frames 0 … 149
    // The plain reader of the bar knows nothing of any table: it reads the source frame off the picture, where a clip is alone and not scaled
    const bar = (f: number) => { const picture = pictures.get(f)!; return readBar(picture.rgb, picture.width, picture.height); };
    expect(['s2', 's3', 's4'].map((id) => [id, bar(shot(id).at!), bar(shot(id).at! + shot(id).for! - 1)])).toEqual([
      ['s2', 52, 99],                                                          // 13 frames after the 39 of s1
      ['s3', 112, 149],                                                        // 12 frames after s2, up to the last frame of the clip
      ['s4', 0, 44],                                                           // a clip of its own, from its start
    ]);
    // s1 pushes in: its bar is read through the frame table, with the source frames worked out by hand
    const byHand: Timeline = { ...timeline, shots: timeline.shots.map((each) => ({ ...each, from: FROM[each.id]! })) };
    for (const f of [0, shot('s1').for! - 1]) {
      const reading = readShot(byHand, pictures.get(f)!, 0, f);
      expect(reading?.source).toBe(f);
      expect(showsExpected(reading), `s1 on frame ${f}: ${JSON.stringify(reading)}`).toBe(true);
    }
    // and the frame table the run wrote says the same: s1, s2 and s3 show one file
    expect(timeline.shots.map((each) => [each.id, each.at, each.for, each.from])).toEqual(template.shots.map((each) => [each.id, each.at, each.for, FROM[each.id]]));
    expect(new Set(timeline.shots.slice(0, 3).map((each) => each.media)).size).toBe(1);
  });

  it('the checks of the video found no issue', () => {
    const quality = JSON.parse(said('v1/quality.json')) as Quality;
    expect(quality.stopped).toBeNull();
    expect(quality.issues).toEqual([]);
  });
});
