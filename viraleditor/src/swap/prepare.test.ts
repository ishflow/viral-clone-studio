// The preparation of a person-swap template from the run to the folder on the disk, on real files: a video made on this machine,
// a downloader that copies it, a model that answers from a script, the real ffmpeg tools. Nothing here is paid or fetched.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { DownloadError } from '../adapters/downloader.ts';
import { FakeClock, FakeLlm } from '../adapters/fakes.ts';
import type { Scripted } from '../adapters/fakes.ts';
import { createFakeSwapper } from '../adapters/fake-swapper.ts';
import type { RunInput } from '../contracts.ts';
import { getRun } from '../db/runs.ts';
import { readSettings, writeSettings } from '../db/settings.ts';
import * as templates from '../db/templates.ts';
import { LlmInvalid } from '../ports.ts';
import type { Downloader, Media } from '../ports.ts';
import { UNIT_TAKEN } from '../prepare/index.ts';
import { operationsOf } from '../produce/rows.ts';
import { PHOTOGRAPH, put, workspace } from '../produce/testing.ts';
import { swapHandler } from './index.ts';
import { loadSwap } from './plan.ts';
import { swapPrepareHandler } from './prepare.ts';
import { beginPrepare, copying, ONE_PERSON, video } from './prepare.testing.ts';
import { BODY, FFMPEG, FFPROBE, finalOf, hasFfmpeg, inputOf, startSwap, tools } from './testing.ts';

const SLOW = 120_000;
const ID = 'swap-new';
const LINK = { kind: 'link', url: 'https://example.com/watch/1' } as const;
const UPLOAD = '11111111-2222-4333-8444-555555555555';
/** The person of a template the model said nothing about: the whole picture, and words that fit any video of one person. */
const UNKNOWN_PERSON = { slot: 1, box: { left: 0, top: 0, right: 100, bottom: 100 }, hint: 'the person in the video' };
type From = Extract<RunInput, { kind: 'prepare' }>['from'];

let db: DatabaseSync, dir: string, clock: FakeClock;
beforeEach(() => {
  ({ db, dir } = workspace());
  clock = new FakeClock('2026-10-07T10:00:00.000Z');
});
const folder = () => join(dir, 'templates', ID);
interface Options { answers?: Scripted<unknown>; from?: From; ownerId?: string | null; downloader?: Downloader & { calls: string[] }; media?: Media; before?: () => void }
/** Prepares the template from a link to `file` (unless told otherwise); the model answers from `answers`. */
async function prepare(file: string, options: Options = {}) {
  const llm = new FakeLlm(options.answers ?? [ONE_PERSON]), downloader = options.downloader ?? copying(file);
  const run = beginPrepare(db, clock, ID, options.from ?? LINK, options.ownerId ?? null);
  options.before?.();
  const handled = swapPrepareHandler({ db, dataDir: dir, llm, downloader, media: options.media ?? tools().media, clock })(run);
  const thrown = await handled.then(() => null, (error: Error) => error);
  return { run: getRun(db, run.id)!, row: templates.get(db, ID), llm, downloader, thrown };
}
/** How a preparation ended: the run's result and code, and what it left of the row and of the disk. */
const endOf = ({ run, row }: Awaited<ReturnType<typeof prepare>>) => ({
  result: run.result, detail: run.detail, row: row === null ? null : { state: row.state, note: row.note },
  template: existsSync(folder()), attempts: existsSync(join(dir, 'prepare-attempts', run.id)) ? readdirSync(join(dir, 'prepare-attempts', run.id)) : [],
});
const failedAs = (note: string, detail: string | null = null) => ({ result: { kind: 'prepare', state: 'failed', note }, detail, row: { state: 'failed', note }, template: false, attempts: [] });
/** A file an admin uploaded, as the site keeps it under uploads/: the file, its registry and the mark of who uploaded it. */
function upload(file: string, owner: string): From {
  const bytes = readFileSync(file), sha256 = createHash('sha256').update(bytes).digest('hex');
  put(`uploads/${UPLOAD}/source.mp4`, bytes);
  put(`uploads/${UPLOAD}/uploader`, owner);
  put(`uploads/${UPLOAD}/video.json`, JSON.stringify({ sha256, path: `uploads/${UPLOAD}/source.mp4`, bytes: bytes.length, name: 'dance.mp4' }));
  return { kind: 'upload', uploadId: UPLOAD, sha256 };
}

describe.skipIf(!hasFfmpeg)('the preparation of a person-swap template', () => {
  it('writes the video, its parts ending at its cut, a still and swap.json with the people the model saw, and makes the row ready', async () => {
    const prepared = await prepare(video(12, 5));
    const { run, llm } = prepared, row = prepared.row!;
    expect(run.state).toBe('done');
    expect(endOf(prepared)).toMatchObject({ detail: null, attempts: [] });
    expect(run.result).toEqual({ kind: 'prepare', state: 'ready', note: null });

    const swap = loadSwap(ID)!;
    expect(swap).toEqual({
      people: 1, persons: [{ slot: 1, ...ONE_PERSON.persons[0] }], sound: true,
      parts: [{ n: 1, from: 0, to: 5 }, { n: 2, from: 5, to: 12 }],
    });
    expect(readdirSync(folder()).sort()).toEqual(['parts', 'poster.jpg', 'source.mp4', 'swap.json']);
    expect(readdirSync(join(folder(), 'parts'))).toEqual(['p01.mp4', 'p02.mp4']);
    const { media } = tools();
    const source = await media.probe(join(folder(), 'source.mp4'));
    const parts = await Promise.all([1, 2].map((n) => media.probe(join(folder(), 'parts', `p0${n}.mp4`))));
    expect(parts.map((part) => part.frames)).toEqual([150, 210]);
    expect(source).toMatchObject({ frames: 360, audio: true });

    expect(row).toMatchObject({ state: 'ready', note: null, estimate: { images: 0, clips: 2, clipSeconds: 12, music: 0, voice: 0 } });
    expect(row.card).toMatchObject({
      title: 'a dance in the kitchen', seconds: 12, shots: [], products: 0, swap,
      image: `templates/${ID}/poster.jpg`, video: `templates/${ID}/source.mp4`, referenceImage: `templates/${ID}/poster.jpg`, referenceVideo: `templates/${ID}/source.mp4`,
    });
    // the model was given two pictures of the video and nothing else of it
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.files.map((file) => file.split('/').at(-1))).toEqual(['still.jpg', 'sheet.jpg']);
    // a person-swap template is no product template: the folder holds none
    expect(existsSync(join(folder(), 'template.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(folder(), 'swap.json'), 'utf8'))).toEqual(swap);
  }, SLOW);

  it('the template it wrote is made into a video by the person-swap handler, and the preparation itself asked no provider for anything', async () => {
    const { run } = await prepare(video(12, 5));
    const log = join(dir, 'fake-swapper.log');
    expect(existsSync(log)).toBe(false);
    expect(existsSync(join(dir, 'fake-generator.log'))).toBe(false);
    expect(operationsOf(db, run.id)).toEqual([]);
    expect(run.sent).toBeNull();

    put(BODY, PHOTOGRAPH);
    const made = startSwap(db, clock, loadSwap(ID)!, undefined, inputOf({ templateId: ID }));
    const tiers = { fast: { model: 'fake-swap', resolution: '720p' }, best: { model: 'fake-swap', resolution: '1080p' } };
    await swapHandler({ db, swapper: createFakeSwapper({ log, ffmpeg: FFMPEG, ffprobe: FFPROBE }), ...tools(), clock, tiers })(made);
    const done = getRun(db, made.id)!;
    expect({ state: done.state, reason: done.reason }).toEqual({ state: 'done', reason: null });
    expect(done.result).toEqual({ kind: 'produce', variants: [{ video: `jobs/${made.id}/v1/final.mp4`, image: `jobs/${made.id}/v1/poster.jpg` }] });
    expect(done.sent).toMatchObject({ clips: 2, clipSeconds: 12 });
    const final = await tools().media.probe(finalOf(made.id));
    expect(final).toMatchObject({ frames: 360, audio: true });
  }, SLOW);

  it('a part of a longer video that the admin picked is the template', async () => {
    const prepared = await prepare(video(31), { from: { ...LINK, range: { from: 2, to: 14 } } });
    expect(prepared.run.result).toEqual({ kind: 'prepare', state: 'ready', note: null });
    expect(loadSwap(ID)!.parts).toEqual([{ n: 1, from: 0, to: 6 }, { n: 2, from: 6, to: 12 }]);
    expect((await tools().media.probe(join(folder(), 'source.mp4'))).frames).toBe(360);
  }, SLOW);

  it('a file the admin uploaded is prepared like a link, from the disk, under the name the site gave it', async () => {
    const downloader = copying(video(12, 5));
    const prepared = await prepare(video(12, 5), { from: upload(video(12, 5), 'admin-1'), ownerId: 'admin-1', downloader });
    expect(endOf(prepared)).toMatchObject({ result: { kind: 'prepare', state: 'ready', note: null }, row: { state: 'ready', note: null }, template: true, attempts: [] });
    expect(downloader.calls).toEqual([]);
    expect(prepared.row!.card.title).toBe('Uploaded video');
    expect(loadSwap(ID)!.parts).toHaveLength(2);
  }, SLOW);
});

describe.skipIf(!hasFfmpeg)('the people of a person-swap template', () => {
  it.each([
    ['refuses to answer', new LlmInvalid('no answer', 'no-json'), 'no-suggestion:llm-invalid'],
    ['names more people than a swap takes', { people: 3, persons: [] }, 'no-suggestion:llm-invalid'],
    ['is not there', new Error('claude: command not found'), 'no-suggestion:llm-error'],
  ])('when the model %s the template is ready all the same, with one person the admin has to describe', async (_, answer, detail) => {
    const prepared = await prepare(video(12, 5), { answers: [answer] });
    expect(endOf(prepared)).toEqual({ result: { kind: 'prepare', state: 'ready', note: null }, detail, row: { state: 'ready', note: null }, template: true, attempts: [] });
    expect(loadSwap(ID)).toMatchObject({ people: 1, persons: [UNKNOWN_PERSON] });
    expect(prepared.row!.card.swap).toMatchObject({ people: 1, persons: [UNKNOWN_PERSON] });
  }, SLOW);

  it('the model is asked within the templates of the day: one unit a template, and none is left, it is not asked', async () => {
    const first = await prepare(video(12, 5));
    expect(first.llm.calls).toHaveLength(1);
    expect(db.prepare("SELECT kind, count FROM usage").all()).toEqual([{ kind: 'prepare', count: 1 }]);

    ({ db, dir } = workspace());
    writeSettings(db, { ...readSettings(db), dailyTemplates: 0 });
    const second = await prepare(video(12, 5));
    expect(second.llm.calls).toHaveLength(0);
    expect(endOf(second)).toMatchObject({ result: { kind: 'prepare', state: 'ready', note: null }, detail: 'no-suggestion:daily-cap', template: true });
    expect(loadSwap(ID)!.persons).toEqual([UNKNOWN_PERSON]);
  }, SLOW);

  it('a run that is taken over does not take the unit of its template again', async () => {
    writeSettings(db, { ...readSettings(db), dailyTemplates: 0 });
    const prepared = await prepare(video(12, 5), { before: () => templates.setState(db, ID, 'preparing', UNIT_TAKEN, clock.now()) });
    expect(prepared.llm.calls).toHaveLength(1);
    expect(db.prepare("SELECT kind, count FROM usage").all()).toEqual([]);
    expect(loadSwap(ID)!.persons).toEqual([{ slot: 1, ...ONE_PERSON.persons[0] }]);
  }, SLOW);

  it('two people are numbered in the order the model names them', async () => {
    const two = { people: 2, persons: [{ box: { left: 5, top: 30, right: 45, bottom: 95 }, hint: 'the man on the left in a white shirt' }, { box: { left: 55, top: 30, right: 95, bottom: 95 }, hint: 'the woman on the right in a red dress' }] };
    await prepare(video(12, 5), { answers: [two] });
    expect(loadSwap(ID)).toMatchObject({ people: 2, persons: [{ slot: 1, ...two.persons[0] }, { slot: 2, ...two.persons[1] }] });
  }, SLOW);

  it('a video the model sees no person in is no person-swap template', async () => {
    expect(endOf(await prepare(video(12, 5), { answers: [{ people: 0, persons: [] }] }))).toEqual(failedAs('unsupported', 'no-person'));
  }, SLOW);
});

describe.skipIf(!hasFfmpeg)('a video that cannot be a person-swap template leaves a failed row, a reason and no folder', () => {
  it('longer than 30 seconds: too long, and the model is not asked', async () => {
    const prepared = await prepare(video(31));
    expect(endOf(prepared)).toEqual(failedAs('too-long'));
    expect(prepared.llm.calls).toHaveLength(0);
  }, SLOW);

  it('shorter than 3 seconds: unsupported, as too short', async () => {
    expect(endOf(await prepare(video(2)))).toEqual(failedAs('unsupported', 'too-short'));
  }, SLOW);

  it('a file that is no video: the source is unavailable', async () => {
    const file = join(dir, 'not-a-video.mp4');
    writeFileSync(file, 'these bytes are no video');
    expect(endOf(await prepare(file))).toEqual(failedAs('source-unavailable'));
  }, SLOW);

  it('a file with sound and no picture: the source is unavailable', async () => {
    const file = join(dir, 'sound.m4a');
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:a', 'aac', file]);
    expect(endOf(await prepare(file))).toEqual(failedAs('source-unavailable'));
  }, SLOW);

  it.each([
    ['could not fetch it', new DownloadError('tool-failed', 'yt-dlp failed'), 'source-unavailable'],
    ['refused it for its length', new DownloadError('rejected', 'longer than the limit'), 'too-long'],
  ])('a link whose download %s', async (_, error, note) => {
    const downloader = { calls: [] as string[], video: async () => { throw error; } };
    expect(endOf(await prepare('', { downloader }))).toEqual(failedAs(note));
  });

  it('a range that is no range: bad range', async () => {
    expect(endOf(await prepare(video(12, 5), { from: { ...LINK, range: { from: 4, to: 20 } } }))).toEqual(failedAs('bad-range'));
  }, SLOW);

  it('an uploaded file that is not the one the site registered: the source is unavailable', async () => {
    const from = upload(video(12, 5), 'someone-else');
    expect(endOf(await prepare('', { from, ownerId: 'admin-1' }))).toEqual(failedAs('source-unavailable'));
  }, SLOW);

  it('a candidate of a scan: unsupported, and nothing is fetched', async () => {
    const prepared = await prepare(video(12, 5), { from: { kind: 'candidate', candidateId: 'c1', force: true } });
    expect(endOf(prepared)).toEqual(failedAs('unsupported'));
    expect(prepared.downloader.calls).toEqual([]);
  });

  it('parts that do not add up to the video: the check failed, before any run could pay for them', async () => {
    const real = tools().media;
    const media: Media = { ...real, trim: (file, from, to, out) => real.trim(file, from, to - (from === 0 ? 0.5 : 0), out) };
    expect(endOf(await prepare(video(12, 5), { media }))).toEqual(failedAs('check-failed', 'parts-frames'));
  }, SLOW);

  it('a tool that does not run stops the run as an engine error', async () => {
    const media: Media = { ...tools().media, cuts: async () => { throw new Error('ffmpeg is not there'); } };
    const prepared = await prepare(video(12, 5), { media });
    expect(prepared.thrown?.message).toBe('ffmpeg is not there');
    expect({ row: prepared.row!.state, note: prepared.row!.note, template: existsSync(folder()), run: prepared.run.state }).toEqual({ row: 'failed', note: 'engine-error', template: false, run: 'running' });
    expect(endOf(prepared).attempts).toEqual([]);
  }, SLOW);
});

describe.skipIf(!hasFfmpeg)('a person-swap preparation and what happens around it', () => {
  it.each(['published', 'hidden', 'ready', 'failed'] as const)('a row that is %s already is left as it is, and nothing is fetched', async (state) => {
    const prepared = await prepare(video(12, 5), { before: () => templates.setState(db, ID, state, state === 'failed' ? 'too-long' : null, clock.now()) });
    expect(prepared.downloader.calls).toEqual([]);
    expect(endOf(prepared)).toMatchObject({ result: { kind: 'prepare', state: state === 'failed' ? 'failed' : 'ready', note: state === 'failed' ? 'too-long' : null }, row: { state }, template: false });
  });

  it('a row that was deleted is not brought back', async () => {
    const prepared = await prepare(video(12, 5), { before: () => { db.prepare('DELETE FROM templates WHERE id = ?').run(ID); } });
    expect(endOf(prepared)).toMatchObject({ result: { kind: 'prepare', state: 'failed', note: 'unsupported' }, row: null, template: false });
  });

  it('a row that is deleted while the video is cut gets no folder', async () => {
    const real = tools().media;
    const media: Media = { ...real, cuts: async (file) => { db.prepare('DELETE FROM templates WHERE id = ?').run(ID); return real.cuts(file); } };
    expect(endOf(await prepare(video(12, 5), { media }))).toMatchObject({ result: { kind: 'prepare', state: 'failed', note: 'unsupported' }, row: null, template: false, attempts: [] });
  }, SLOW);

  it('a worker that lost the run while it worked writes nothing: no folder, the row and the run as the other worker has them', async () => {
    const real = tools().media;
    const media: Media = { ...real, cuts: async (file) => { db.prepare("UPDATE runs SET claimed_by = 'another-worker'").run(); return real.cuts(file); } };
    const prepared = await prepare(video(12, 5), { media });
    expect(prepared.thrown).toBeNull();
    expect({ ...endOf(prepared), run: prepared.run.state }).toEqual({ result: null, detail: null, row: { state: 'preparing', note: null }, template: false, attempts: [], run: 'running' });
  }, SLOW);

  it('what an earlier attempt left in the folder of the row is replaced by the whole template', async () => {
    const prepared = await prepare(video(12, 5), { before: () => { put(`templates/${ID}/parts/p09.mp4`, 'a part of an attempt that died'); put(`templates/${ID}/answer.json`, '{}'); } });
    expect(prepared.run.result).toEqual({ kind: 'prepare', state: 'ready', note: null });
    expect(readdirSync(folder()).sort()).toEqual(['parts', 'poster.jpg', 'source.mp4', 'swap.json']);
    expect(readdirSync(join(folder(), 'parts'))).toEqual(['p01.mp4', 'p02.mp4']);
  }, SLOW);

  it('is not for a run that does not say mode swap', async () => {
    const run = beginPrepare(db, clock, ID, LINK);
    const handler = swapPrepareHandler({ db, dataDir: dir, llm: new FakeLlm([]), downloader: copying(video(12, 5)), media: tools().media, clock });
    await expect(handler({ ...run, input: { kind: 'prepare', templateId: ID, ownerId: null, from: LINK } })).rejects.toThrow('not one');
    expect(existsSync(folder())).toBe(false);
  });
});
