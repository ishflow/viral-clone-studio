// Offline release evidence: real local MP4 -> SQLite prepare -> existing produce handler -> rendered MP4.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeLlm, FakeTranscriber } from '../adapters/fakes.ts';
import { createFakeGenerator } from '../adapters/fake-generator.ts';
import { createMeasure } from '../adapters/measure.ts';
import { createMedia } from '../adapters/media.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { available } from '../compose/golden-helpers.ts';
import { getRun } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { prepareHandler } from '../prepare/index.ts';
import { localPlaceholders } from '../prepare/placeholders.ts';
import { world } from '../prepare/testing.ts';
import { produceHandler } from '../produce/index.ts';
import { answerOf, golden, inputOf, PHOTOGRAPH, put, startRun } from '../produce/testing.ts';
import { Template } from '../template/schema.ts';
const BIN = resolve(import.meta.dirname, '../../node_modules/.bin/hyperframes');
const FFMPEG = '/opt/homebrew/bin/ffmpeg', FFPROBE = '/opt/homebrew/bin/ffprobe';

describe.skipIf(!available)('uploaded video through the real local media and render pipeline', () => {
  it('is ready, privately owned, never downloaded and can generate an existing golden recipe', async () => {
    const { template, fill } = golden('layering-01');
    const w = world({ llm: [{ score: 88, notes: ['Public local fixture'], unsupported: null, mode: 'beats', brands: [] }, template], words: [] });
    process.env.VC_DATA_DIR = w.dataDir;
    const id = randomUUID(), folder = join(w.dataDir, 'uploads', id);
    mkdirSync(folder, { recursive: true });
    const video = join(folder, 'source.mp4');
    const colors = ['red', 'blue', 'white', 'black', 'lime'];
    const args = ['-v', 'error'];
    template.shots.forEach((shot, index) => args.push('-f', 'lavfi', '-i', `color=c=${colors[index]}:s=90x160:r=30:d=${shot.for! / 30}`));
    const filter = template.shots.map((shot, i) => `[${i}:v]trim=end_frame=${shot.for},setpts=PTS-STARTPTS[v${i}]`).join(';')
      + ';' + template.shots.map((_, i) => `[v${i}]`).join('') + `concat=n=${template.shots.length}:v=1:a=0[out]`;
    execFileSync(FFMPEG, [...args, '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const bytes = readFileSync(video), sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(folder, 'uploader'), 'upload-owner');
    writeFileSync(join(folder, 'video.json'), JSON.stringify({ path: `uploads/${id}/source.mp4`, sha256, bytes: bytes.length, seconds: 8, width: 90, height: 160 }));
    templates.upsert(w.db, { id: 'uploaded-recipe', state: 'preparing', owner: 'upload-owner', sourceKind: 'upload', sourceUrl: null, note: null,
      card: { title: 'Uploaded video', category: '', format: 'no-talking', seconds: 8, referenceViews: '', image: null, video: null, products: 4, shots: [], description: '', tags: [] }, estimate: null, minutes: null }, w.clock.now());
    const media = createMedia(FFMPEG, FFPROBE), measure = createMeasure(FFMPEG, FFPROBE);
    const renderer = createRenderer({ bin: BIN, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure });
    const prepare = w.run({ kind: 'prepare', templateId: 'uploaded-recipe', ownerId: 'upload-owner', from: { kind: 'upload', uploadId: id, sha256 } });
    await prepareHandler({ ...w, media, renderer, placeholders: localPlaceholders({ ffmpeg: FFMPEG }) })(prepare);
    expect(getRun(w.db, prepare.id)?.result).toEqual({ kind: 'prepare', state: 'ready', note: null });
    expect(templates.get(w.db, 'uploaded-recipe')).toMatchObject({ state: 'ready', owner: 'upload-owner', sourceKind: 'upload' });
    expect(w.downloader.calls).toHaveLength(0);
    const prepared = Template.parse(JSON.parse(readFileSync(join(w.dataDir, 'templates', 'uploaded-recipe', 'template.json'), 'utf8')));
    for (const product of fill.products) for (const image of product.images) put(image, PHOTOGRAPH);
    const run = startRun(w.db, w.clock, prepared, inputOf(prepared, fill, 1));
    await produceHandler({ db: w.db, clock: w.clock, media, measure, renderer, llm: new FakeLlm([answerOf(fill, 1)]),
      generator: createFakeGenerator({ ffmpeg: FFMPEG, clock: w.clock, log: join(w.dataDir, 'fake-generator.log') }), transcriber: new FakeTranscriber() })(run);
    const done = getRun(w.db, run.id)!;
    expect(done.state, done.detail ?? '').toBe('done');
    const final = join(w.dataDir, done.variants[0]!.video!);
    expect(existsSync(final)).toBe(true);
    expect((await media.probe(final)).frames).toBeGreaterThan(0);
    w.db.close();
  }, 1_000_000);
});
