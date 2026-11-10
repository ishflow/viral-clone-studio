// The produce handler with the in-memory fakes and a fake picture side (`deps.assemble`): nothing here needs a browser.
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeGenerator, FakeLlm, FakeMedia, FakeRenderer, FakeTranscriber } from '../adapters/fakes.ts';
import type { FakeGeneratorOptions, GeneratorCall } from '../adapters/fakes.ts';
import { refusalOf } from '../adapters/routes.ts';
import type { Paid, Step, StopReason } from '../contracts.ts';
import { asOwner, beginOperation, claim, endOperation, getRun, operation, release } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { writeSettings, readSettings } from '../db/settings.ts';
import { abs } from '../paths.ts';
import { MediaError } from '../adapters/media.ts';
import { GeneratorError, LlmInvalid } from '../ports.ts';
import type { GeneratorErrorCode } from '../ports.ts';
import type { Aligner, Generator, Measure, MediaFacts } from '../ports.ts';
import { paidFor } from '../template/estimate.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import type { Assemble, AssembleDeps, ProduceDeps } from './deps.ts';
import { openGate, waitLogged } from '../worker/gate.ts';
import { runWorker } from '../worker/loop.ts';
import { budgetSchema, consumeProvider, providerUnits, reserveProvider } from '../robust/provider-budget.ts';
import { settleUnknown } from '../robust/settle-unknown.ts';
import { creditsHold, holdCredits } from '../robust/provider-credits.ts';
import { produceHandler } from './index.ts';
import { needsOf } from './plan.ts';
import { operationsOf } from './rows.ts';
import { answerOf, golden, goldenWith, goldenWithParts, goldenWithPartsAndStill, goldenWithStill, inputOf, JPEG, MediaGenerator, probesOf, put, resumeRun, seed, startRun, WAV, workspace } from './testing.ts';
import { MEDIA } from './testing.ts';
import type { Delivery, ProduceInput } from './testing.ts';
import type { Assembled, VariantMedia } from './types.ts';

const ANSWERS = { image: {}, clip: {}, music: {}, voice: {} };
const MEDIA_BYTES = MEDIA;
const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const PAID_KINDS = ['image', 'clip', 'music', 'voice'];
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const measure = {} as Measure;                                  // the picture side's; the money side never calls it

interface World {
  db: DatabaseSync; clock: FakeClock; template: TemplateJson; fill: FillJson; run: RunRow;
  generator: FakeGenerator; llm: FakeLlm;
  assembled: VariantMedia[];                                    // what the picture side was given, in order
  given: AssembleDeps[];                                        // and the parts it was given with each
  media: FakeMedia;
  rendersAtOnce: () => number; inFlight: () => number;          // the most at one time
  snapshots: { at: string; steps: Step[] }[];                   // the steps as the database held them at each call
  flying: () => number;                                         // requests in flight now
  accepted: () => Paid;                                         // what the generator accepted: every onSubmitted that returned
  offRun: string[];                                             // paid calls made while the run was not running for this worker
  handle: (run?: RunRow) => Promise<RunRow>;
  handler: (run: RunRow) => Promise<void>;                       // the handler itself, for a worker loop to call
  /** A later call of the handler on the same data, with its own fakes. */
  again: (options?: Options) => World;
  paidCalls: () => GeneratorCall[];
}
interface Options {
  variants?: 1 | 2 | 3; approved?: Paid | null; input?: Partial<ProduceInput>;
  golden?: { template: TemplateJson; fill: FillJson };          // in place of the golden of that id
  generator?: FakeGeneratorOptions; realRefusals?: boolean;
  llm?: unknown[];
  assemble?: (media: VariantMedia) => Assembled | Promise<Assembled>;
  before?: (world: { db: DatabaseSync; clock: FakeClock; run: RunRow; template: TemplateJson }) => void;
  database?: (db: DatabaseSync) => DatabaseSync;                // what the handler is given in place of the database
  sample?: ProduceDeps['sample']; aligner?: Aligner;
  delivery?: Delivery;                                          // the files the generator delivers, when not what each kind says
  probes?: Record<string, MediaFacts | Error>;                  // what the probe says of a photograph (by its path under data/), when not "a picture of 1024 × 1024"
  gate?: ProduceDeps['paidGate'];                               // the gate the worker's runs share, when the handler is given one
  db?: DatabaseSync;                                            // the database of another world: a second run of the same worker
}

function world(id: 'layering-01' | 'lashly-01', options: Options = {}, earlier?: World): World {
  const { template, fill } = earlier ?? options.golden ?? golden(id);
  const db = earlier?.db ?? options.db ?? workspace().db;
  const clock = earlier?.clock ?? new FakeClock();
  const variants = options.variants ?? 1;
  if (!earlier) seed(template, fill);
  const run = earlier?.run ?? startRun(db, clock, template, inputOf(template, fill, variants, options.input), options.approved === undefined ? paidFor(template, variants) : options.approved);
  options.before?.({ db, clock, run, template });

  const snapshots: World['snapshots'] = [];
  const snap = (at: string) => { snapshots.push({ at, steps: getRun(db, run.id)!.steps }); };
  let flying = 0, mostFlying = 0;
  const accepted = { ...ZERO };
  const offRun: string[] = [];
  const generator = new MediaGenerator({
    answers: ANSWERS, ...options.generator,
    onCall: async (call) => {
      if (call.kind === 'refusal') return;
      const now = getRun(db, run.id)!;
      if (PAID_KINDS.includes(call.kind) && (now.state !== 'running' || now.claimedBy !== run.claimedBy)) offRun.push(`${call.kind}-${call.n}@${now.state}/${now.claimedBy}`);
      snap(`${call.kind}-${call.n}`);
      await options.generator?.onCall?.(call);
      await tick();                                             // the request is in flight for a while: others start meanwhile
    },
  }, options.delivery);
  if (options.realRefusals) generator.refusal = refusalOf;
  // every request counted from its call to its answer
  const counted: Generator = Object.create(generator) as Generator;
  for (const kind of [...PAID_KINDS, 'resume'] as const) {
    (counted as unknown as Record<string, unknown>)[kind] = async (...args: unknown[]) => {
      flying += 1; mostFlying = Math.max(mostFlying, flying);
      if (kind !== 'resume') {
        const onSubmitted = args[2] as (ticket: string) => void;
        args[2] = (ticket: string) => {
          onSubmitted(ticket);
          accepted[({ image: 'images', clip: 'clips', music: 'music', voice: 'voice' } as const)[kind as 'image']] += 1;
          if (kind === 'clip') accepted.clipSeconds += (args[0] as { seconds: number }).seconds;
        };
      }
      try { return await (generator as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[kind]!(...args); } finally { flying -= 1; }
    };
  }

  const llm = new FakeLlm(options.llm ?? (earlier ? [] : [answerOf(fill, variants)]));
  const assembled: VariantMedia[] = [];
  let rendering = 0, mostRendering = 0;
  const given: AssembleDeps[] = [];
  const assemble: Assemble = async (deps, _run, _template, media) => {
    assembled.push(media); given.push(deps);
    rendering += 1; mostRendering = Math.max(mostRendering, rendering);
    try {
      snap(`edit-${media.n}`);
      await tick();
      const out = await (options.assemble?.(media) ?? { ok: true, video: `${media.dir}/final.mp4`, image: `${media.dir}/poster.jpg` });
      if (out.ok || out.reason === 'render-failed') { deps.onRender?.(); snap(`render-${media.n}`); await tick(); }
      if (out.ok) put(out.video, 'a video');
      return out;
    } finally { rendering -= 1; }
  };
  const said = Object.fromEntries(Object.entries(options.probes ?? {}).map(([file, answer]) => [abs(file), answer]));
  const media = new FakeMedia({ probes: { by: { ...probesOf({ ...fill, products: run.input.kind === 'produce' ? run.input.products : [] } as FillJson), ...said } } });
  const handler = produceHandler({
    db: options.database?.(db) ?? db, clock, generator: counted, llm, measure, assemble,
    renderer: new FakeRenderer(), transcriber: new FakeTranscriber(), media,
    ...(options.sample ? { sample: options.sample } : {}), ...(options.aligner ? { aligner: options.aligner } : {}), ...(options.gate ? { paidGate: options.gate } : {}),
  });
  const self: World = {
    db, clock, template, fill, run, generator, llm, assembled, given, snapshots, media,
    rendersAtOnce: () => mostRendering, inFlight: () => mostFlying, flying: () => flying, accepted: () => ({ ...accepted }), offRun,
    handle: async (claimed = run) => { await handler(claimed); snap('end'); return getRun(db, run.id)!; },
    handler,
    again: (next = {}) => world(id, next, self),
    paidCalls: () => generator.calls.filter((call) => PAID_KINDS.includes(call.kind)),
  };
  return self;
}

const statuses = (steps: Step[]) => Object.fromEntries(steps.map((step) => [step.key, step.status]));
const counts = (steps: Step[]) => Object.fromEntries(steps.map((step) => [step.key, `${step.done}/${step.total}`]));
const at = (w: World, name: string) => statuses(w.snapshots.find((snapshot) => snapshot.at === name)!.steps);
const keysOf = (w: World, state?: string) => operationsOf(w.db, w.run.id).filter((row) => state === undefined || row.state === state).map((row) => row.key);

describe('a clean run', () => {
  it('beats, 1 variant: the steps go waiting → running → done in order, sent equals approved equals paidFor, the video is the result', async () => {
    const w = world('layering-01');
    expect(w.generator.calls).toEqual([]);                                                   // no request before the handler runs
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'done', reason: null, missing: null });
    expect(run.result).toEqual({ kind: 'produce', variants: [{ video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg` }] });
    expect(run.variants).toEqual([{ n: 1, status: 'done', video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg`, reason: null }]);
    expect(run.sent).toEqual(run.approved);
    expect(run.sent).toEqual(paidFor(w.template, 1));
    expect(run.sent).toEqual({ images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 });

    expect(run.steps.map((step) => step.key)).toEqual(['adaptation', 'images', 'clips', 'music', 'edit', 'render']);
    expect(counts(run.steps)).toEqual({ adaptation: '1/1', images: '5/5', clips: '5/5', music: '1/1', edit: '1/1', render: '1/1' });
    expect(at(w, 'image-1')).toEqual({ adaptation: 'done', images: 'running', clips: 'waiting', music: 'waiting', edit: 'waiting', render: 'waiting' });
    expect(at(w, 'clip-1')).toEqual({ adaptation: 'done', images: 'done', clips: 'running', music: 'waiting', edit: 'waiting', render: 'waiting' });
    expect(at(w, 'music-1')).toEqual({ adaptation: 'done', images: 'done', clips: 'done', music: 'running', edit: 'waiting', render: 'waiting' });
    expect(at(w, 'edit-1')).toEqual({ adaptation: 'done', images: 'done', clips: 'done', music: 'done', edit: 'running', render: 'waiting' });
    expect(at(w, 'render-1')).toEqual({ adaptation: 'done', images: 'done', clips: 'done', music: 'done', edit: 'done', render: 'running' });
    expect(new Set(Object.values(at(w, 'end')))).toEqual(new Set(['done']));
    const order = ['waiting', 'running', 'done'];
    for (const key of run.steps.map((step) => step.key)) {                                   // no step ever goes back
      const seen = w.snapshots.map((snapshot) => order.indexOf(statuses(snapshot.steps)[key]!));
      expect(seen).toEqual([...seen].sort((a, b) => a - b));
    }

    // the fill is on the disk, and the picture side gets it with every paid file
    expect(JSON.parse(readFileSync(abs(`jobs/${run.id}/v1/fill.json`), 'utf8'))).toEqual(w.fill);
    expect(JSON.parse(readFileSync(abs(`jobs/${run.id}/notes.json`), 'utf8'))).toEqual([]);
    const [media] = w.assembled;
    expect(media).toMatchObject({ n: 1, dir: `jobs/${run.id}/v1`, fill: w.fill, voice: null, music: `jobs/${run.id}/paid/v1/music.mp3` });
    expect(Object.keys(media!.images)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(media!.clips.s4).toBe(`jobs/${run.id}/paid/v1/clip-s4.mp4`);
    for (const file of [...Object.values(media!.images), ...Object.values(media!.clips), media!.music!]) expect(existsSync(abs(file))).toBe(true);
    expect(w.llm.calls).toHaveLength(1);
    expect((w.generator.calls.find((call) => call.kind === 'clip')!.request as { tier: unknown }).tier).toEqual(readSettings(w.db).tiers.fast);
  });

  it('3 variants: 15 images, 15 clips, 3 music; a row before each request; never more than 3 in flight; one render at a time', async () => {
    const problems: string[] = [];
    let w: World;
    w = world('layering-01', { variants: 3, generator: { onCall: (call) => {
      // at the moment of the call: the row of this very request is there, pending, without a ticket
      const need = [1, 2, 3].flatMap((n) => needsOf(w.template, w.run.id, n)).find((candidate) => abs(candidate.file) === call.to);
      const row = need && operation(w.db, w.run.id, need.key);
      if (!row || row.state !== 'pending' || row.externalId !== null || row.kind !== call.kind) problems.push(`${call.kind} ${call.n}: ${JSON.stringify(row)}`);
      if (operationsOf(w.db, w.run.id).filter((each) => each.kind === call.kind).length < call.n) problems.push(`${call.kind} ${call.n}: fewer rows than requests`);
    } } });
    const run = await w.handle();
    expect(problems).toEqual([]);
    expect(run.state).toBe('done');
    const kinds = w.paidCalls().map((call) => call.kind);
    expect([kinds.filter((kind) => kind === 'image').length, kinds.filter((kind) => kind === 'clip').length, kinds.filter((kind) => kind === 'music').length]).toEqual([15, 15, 3]);
    expect(kinds).toEqual([...Array<string>(15).fill('image'), ...Array<string>(15).fill('clip'), ...Array<string>(3).fill('music')]);
    expect(w.inFlight()).toBe(3);
    expect(w.rendersAtOnce()).toBe(1);
    expect(w.assembled.map((media) => media.n)).toEqual([1, 2, 3]);
    expect(run.sent).toEqual(paidFor(w.template, 3));
    expect(run.result).toMatchObject({ variants: [{ video: `jobs/${run.id}/v1/final.mp4` }, { video: `jobs/${run.id}/v2/final.mp4` }, { video: `jobs/${run.id}/v3/final.mp4` }] });
    expect(counts(run.steps)).toEqual({ adaptation: '3/3', images: '15/15', clips: '15/15', music: '3/3', edit: '3/3', render: '3/3' });
    expect(keysOf(w, 'done')).toHaveLength(33);
  });

  it('speech with stills: sent equals paidFor exactly; the voice is made before the talking clips; the picture side gets clips by segment', async () => {
    const w = world('lashly-01', { realRefusals: true, input: { quality: 'best' } });
    const run = await w.handle();
    expect(run.state).toBe('done');
    expect(run.sent).toEqual(paidFor(w.template, 1));
    expect(run.sent).toEqual({ images: 3, clips: 3, clipSeconds: 30, music: 1, voice: 1 });
    const kinds = w.paidCalls().map((call) => call.kind);
    expect(kinds.slice(0, 3)).toEqual(['image', 'image', 'image']);
    expect(kinds.slice(3, 5).sort()).toEqual(['music', 'voice']);
    expect(kinds.slice(5)).toEqual(['clip', 'clip', 'clip']);
    // the still made from another still is asked for after that one exists
    const images = w.paidCalls().filter((call) => call.kind === 'image').map((call) => call.to);
    expect(images.indexOf(abs(`jobs/${run.id}/paid/v1/image-proof-before.png`))).toBeLessThan(images.indexOf(abs(`jobs/${run.id}/paid/v1/image-proof-after.png`)));
    expect(counts(run.steps)).toMatchObject({ images: '3/3', clips: '3/3', music: '2/2' });
    const [media] = w.assembled;
    expect(Object.keys(media!.images)).toEqual(['presenter', 'proof-before', 'proof-after']);
    expect(Object.keys(media!.clips)).toEqual(['trial', 'formula', 'verdict']);
    expect(media).toMatchObject({ voice: `jobs/${run.id}/paid/v1/voice.mp3`, music: `jobs/${run.id}/paid/v1/music.mp3` });
    expect((w.generator.calls.find((call) => call.kind === 'clip')!.request as { tier: unknown }).tier).toEqual({ model: 'seedance-2.5-pro', resolution: '1080p' });
  });
});

describe('beats: a person who returns is one generated still, handed to every shot that names it', () => {
  // layering-01 with the still "lead": shots 2, 3 and 5 are made from it, shots 1 and 4 are not
  const lead = (run: RunRow, extension = 'png') => abs(`jobs/${run.id}/paid/v1/image-lead.${extension}`);
  /** What each image request of the generator's log was made from, by the name of its file. */
  const madeFrom = (w: World) => Object.fromEntries(w.paidCalls().filter((call) => call.kind === 'image').map((call) => [call.to.split('/').pop()!, (call.request as { references: string[] }).references]));
  const photograph = (w: World, n: number) => abs(w.fill.products[n - 1]!.images[0]!);

  it('the still is the first request, and its file is the first reference of the three shots that name it, before their photograph; sent equals the approval', async () => {
    const early: string[] = [];
    let w: World;
    w = world('layering-01', { golden: goldenWithStill(), realRefusals: true, generator: { onCall: (call) => {
      // a first frame that is made from the still is asked for when the still is paid for and on the disk
      if (call.kind === 'image' && (call.request as { references: string[] }).references.includes(lead(w.run)) && operation(w.db, w.run.id, 'v1:image:lead')?.state !== 'done') early.push(call.to);
    } } });
    const run = await w.handle();
    expect(run.state).toBe('done');
    expect(run.approved).toEqual({ images: 6, clips: 5, clipSeconds: 20, music: 1, voice: 0 });
    expect(run.sent).toEqual(run.approved);
    expect(w.paidCalls().map((call) => call.kind)).toEqual([...Array<string>(6).fill('image'), ...Array<string>(5).fill('clip'), 'music']);
    expect(w.paidCalls()[0]).toMatchObject({ kind: 'image', to: lead(run), request: { prompt: w.fill.stills!.lead!.prompt, references: [] } });
    expect(early).toEqual([]);
    expect(madeFrom(w)).toEqual({
      'image-lead.png': [],
      'image-s1.png': [1, 2, 3, 4].map((n) => photograph(w, n)),
      'image-s2.png': [lead(run), photograph(w, 1)],
      'image-s3.png': [lead(run), photograph(w, 2)],
      'image-s4.png': [photograph(w, 3)],
      'image-s5.png': [lead(run), photograph(w, 4)],
    });
    expect(counts(run.steps)).toEqual({ adaptation: '1/1', images: '6/6', clips: '5/5', music: '1/1', edit: '1/1', render: '1/1' });
    expect(keysOf(w, 'done')).toHaveLength(12);
    expect(w.assembled[0]!.images.lead).toBe(`jobs/${run.id}/paid/v1/image-lead.png`);
  });

  it('a worker that died after the still: the next one pays for the five first frames only, and they read the still that is there', async () => {
    const w = world('layering-01', { golden: goldenWithStill(), before: ({ db, clock, run }) => {
      put(`jobs/${run.id}/v1/fill.json`, JSON.stringify(goldenWithStill().fill));
      beginOperation(db, run.id, 'v1:image:lead', 'image', clock.now());
      endOperation(db, run.id, 'v1:image:lead', { state: 'done', externalId: 't-lead', output: `jobs/${run.id}/paid/v1/image-lead.jpg` }, clock.now());
      put(`jobs/${run.id}/paid/v1/image-lead.jpg`, JPEG);                                     // it had arrived as a JPEG and was named so
      db.prepare('UPDATE runs SET sent = ? WHERE id = ?').run(JSON.stringify({ ...ZERO, images: 1 }), run.id);
    }, llm: [] });
    const run = await w.handle();
    expect(run.state).toBe('done');
    expect(w.llm.calls).toEqual([]);
    const images = madeFrom(w);
    expect(Object.keys(images).sort()).toEqual(['image-s1.png', 'image-s2.png', 'image-s3.png', 'image-s4.png', 'image-s5.png']);
    expect(w.generator.calls.filter((call) => call.kind === 'resume')).toEqual([]);
    for (const [shot, product] of [['s2', 1], ['s3', 2], ['s5', 4]] as const) expect(images[`image-${shot}.png`]).toEqual([lead(run, 'jpg'), photograph(w, product)]);
    expect(run.sent).toEqual({ images: 6, clips: 5, clipSeconds: 20, music: 1, voice: 0 });
    expect(run.sent).toEqual(run.approved);
    expect(operation(w.db, run.id, 'v1:image:lead#2')).toBeNull();
    expect(counts(run.steps)).toMatchObject({ images: '6/6' });
  });

  it('a still that fails stops its variant: the shots that name it are never sent, and the resume makes the still again and then those shots', async () => {
    const w = world('layering-01', { golden: goldenWithStill(), generator: { errors: { image: { 1: 'task-failed' } } } });
    const stopped = await w.handle();
    expect(stopped).toMatchObject({ state: 'stopped', reason: 'images-failed' });
    // shots 1 and 4 were in flight beside the still and finished; nothing that reads the still was sent, and no clip
    expect(['lead', 's1', 's2', 's3', 's4', 's5'].map((id) => operation(w.db, stopped.id, `v1:image:${id}`)?.state ?? null)).toEqual(['failed', 'done', null, null, 'done', null]);
    expect(w.paidCalls().filter((call) => call.kind !== 'image')).toEqual([]);
    expect(stopped.sent).toEqual({ ...ZERO, images: 3 });
    expect(stopped.missing).toEqual({ ...ZERO, images: 1 });                                 // four images to send, three of them approved and unused

    const next = w.again();
    next.run = resumeRun(w.db, w.clock, stopped.id);
    const run = await next.handle(next.run);
    expect(run.state).toBe('done');
    expect(operation(w.db, run.id, 'v1:image:lead#2')).toMatchObject({ state: 'done' });
    expect(Object.keys(madeFrom(next))).toEqual(['image-lead.png', 'image-s2.png', 'image-s3.png', 'image-s5.png']);
    expect(madeFrom(next)['image-s5.png']).toEqual([lead(run), photograph(w, 4)]);
    expect(run.sent).toEqual({ images: 7, clips: 5, clipSeconds: 20, music: 1, voice: 0 });
    expect(run.sent).toEqual(run.approved);
  });
});

describe('beats: a shot that continues a clip is no request, it shows a part of the clip of the shot it names', () => {
  // layering-01 where s2 and s3 continue the clip of s1 (5 s): s1, s4 and s5 own a clip
  it('2 variants: an image and a clip for each shot that owns a clip, sent equals the approval, the picture side gets the owners\' files', async () => {
    const w = world('layering-01', { golden: goldenWithParts(), variants: 2, realRefusals: true });
    const run = await w.handle();
    expect(run.state).toBe('done');
    expect(run.approved).toEqual({ images: 6, clips: 6, clipSeconds: 26, music: 2, voice: 0 });
    expect(run.sent).toEqual(run.approved);
    expect(w.accepted()).toEqual(run.approved);
    const clips = w.paidCalls().filter((call) => call.kind === 'clip').map((call) => [call.to.split('/').slice(-2).join('/'), (call.request as { seconds: number }).seconds]);
    expect(clips.sort()).toEqual([['v1/clip-s1.mp4', 5], ['v1/clip-s4.mp4', 4], ['v1/clip-s5.mp4', 4], ['v2/clip-s1.mp4', 5], ['v2/clip-s4.mp4', 4], ['v2/clip-s5.mp4', 4]]);
    expect(w.paidCalls().filter((call) => call.kind === 'image')).toHaveLength(6);
    expect(counts(run.steps)).toEqual({ adaptation: '2/2', images: '6/6', clips: '6/6', music: '2/2', edit: '2/2', render: '2/2' });
    for (const media of w.assembled) {
      expect(Object.keys(media.clips).sort()).toEqual(['s1', 's4', 's5']);
      expect(Object.keys(media.images).sort()).toEqual(['s1', 's4', 's5']);
    }
  });
  it('with a still that two owners name: the still first, then an image and a clip for each owner only, sent equals the approval', async () => {
    const w = world('layering-01', { golden: goldenWithPartsAndStill(), realRefusals: true });
    const run = await w.handle();
    expect(run.state).toBe('done');
    expect(run.approved).toEqual({ images: 4, clips: 3, clipSeconds: 13, music: 1, voice: 0 });
    expect(run.sent).toEqual(run.approved);
    expect(w.accepted()).toEqual(run.approved);
    const lead = abs(`jobs/${run.id}/paid/v1/image-lead.png`);
    const images = w.paidCalls().filter((call) => call.kind === 'image');
    expect(images[0]!.to).toBe(lead);                                                       // the still goes out first; s5 does not wait for it
    expect(images.map((call) => call.to.split('/').pop()).sort()).toEqual(['image-lead.png', 'image-s1.png', 'image-s4.png', 'image-s5.png']);
    expect(Object.fromEntries(images.map((call) => [call.to.split('/').pop()!, (call.request as { references: string[] }).references.includes(lead)]))).toEqual({ 'image-lead.png': false, 'image-s1.png': true, 'image-s4.png': true, 'image-s5.png': false });
    expect(Object.keys(w.assembled[0]!.clips).sort()).toEqual(['s1', 's4', 's5']);
  });
  it('a faulty clip of the owner (that its parts show too): the resume makes that one clip again, at its 5 s', async () => {
    let asked = 0;
    const assemble = (media: VariantMedia): Assembled => ((asked += 1) === 1
      ? { ok: false, reason: 'clips-failed', detail: 'the clip of shot "s1" is shorter than its parts', faulty: [{ kind: 'clip', id: 's1' }] }
      : { ok: true, video: `${media.dir}/final.mp4`, image: `${media.dir}/poster.jpg` });
    const w = world('layering-01', { golden: goldenWithParts(), assemble });
    const stopped = await w.handle();
    expect(stopped).toMatchObject({ state: 'stopped', reason: 'clips-failed', missing: { images: 0, clips: 1, clipSeconds: 5, music: 0, voice: 0 } });
    expect(keysOf(w, 'failed')).toEqual(['v1:clip:s1']);
    const next = w.again({ assemble });
    next.run = resumeRun(w.db, w.clock, stopped.id);
    const run = await next.handle(next.run);
    expect(run.state).toBe('done');
    expect(next.paidCalls().map((call) => [call.kind, call.to])).toEqual([['clip', abs(`jobs/${run.id}/paid/v1/clip-s1.mp4`)]]);
    expect(run.sent).toEqual({ images: 3, clips: 4, clipSeconds: 18, music: 1, voice: 0 });
    expect(run.approved).toEqual(run.sent);
  });
});

describe('what is known before payment stops the run before anything is sent', () => {
  const nothingSent = (w: World, run: RunRow, reason: StopReason) => {
    expect(run).toMatchObject({ state: 'stopped', reason, sent: null });
    expect(w.paidCalls()).toEqual([]);
    expect(operationsOf(w.db, run.id)).toEqual([]);
    expect(w.assembled).toEqual([]);
    expect(run.variants.map((variant) => [variant.status, variant.reason])).toEqual(run.variants.map(() => ['stopped', reason]));
    expect(run.result).toEqual({ kind: 'produce', variants: [] });
  };

  it('the need is larger than what was approved: estimate-exceeded', async () => {
    const w = world('layering-01', { variants: 2, approved: { ...paidFor(golden('layering-01').template, 2), clipSeconds: 39 } });
    const run = await w.handle();
    nothingSent(w, run, 'estimate-exceeded');
    expect(run.missing).toEqual({ ...ZERO, clipSeconds: 1 });                                // what the approval lacks, not the whole need
    expect(w.llm.calls).toEqual([]);                                                         // the count comes before the question to the model
    expect(existsSync(abs(`jobs/${run.id}/v1/fill.json`))).toBe(false);
    expect((await world('layering-01', { approved: null }).handle()).reason).toBe('estimate-exceeded');
  });

  it('the model cannot write the fills (LlmInvalid): adaptation-failed, and no fill is kept', async () => {
    const w = world('layering-01', { llm: [new LlmInvalid('not JSON, twice')] });
    const run = await w.handle();
    nothingSent(w, run, 'adaptation-failed');
    expect(statuses(run.steps).adaptation).toBe('stopped');
    expect(existsSync(abs(`jobs/${run.id}/v1/fill.json`))).toBe(false);
  });

  it('a run with no product (the admin sample sends none): adaptation-failed with a detail code, the model is not asked', async () => {
    const w = world('layering-01', { input: { products: [], sample: true } });
    const run = await w.handle();
    nothingSent(w, run, 'adaptation-failed');
    expect(run.detail).toBe('no-products');
    expect(w.llm.calls).toEqual([]);
  });

  it('a run stopped before any paid request gives back its provider reservation; one that had paid keeps it', async () => {
    const reserved = (ref: string) => (w: { db: DatabaseSync }) => (w.db.prepare('SELECT reserved FROM provider_budget WHERE run_id = ?').get(ref) as { reserved: number }).reserved;
    for (const [consumed, left] of [[0, 0], [3, 30]] as const) {
      const w = world('layering-01', { llm: [new LlmInvalid('not JSON, twice')] });
      budgetSchema(w.db);
      const ref = w.run.ref;
      w.db.prepare('INSERT INTO provider_budget(run_id, day, reserved, consumed) VALUES (?, ?, 30, ?)').run(ref, '2026-10-05', consumed);
      expect((await w.handle()).state).toBe('stopped');
      expect(reserved(ref)(w)).toBe(left);
    }
  });

  it('the model cannot write the fills: the detail code says so', async () => {
    expect((await world('layering-01', { llm: [new LlmInvalid('not JSON, twice')] }).handle()).detail).toBe('fill-invalid');
  });

  it('a fill whose copy cannot fit its box: adaptation-failed', async () => {
    const { fill } = golden('layering-01');
    const long = structuredClone(fill);
    long.texts.hook = 'the most unbelievably long compliment-magnet scent layering combination that anybody has ever written on a screen '.repeat(2).trim().slice(0, 200);
    const w = world('layering-01', { variants: 2, llm: [{ fills: [answerOf(fill, 1).fills[0], answerOf(long, 1).fills[0]] }] });
    const run = await w.handle();
    nothingSent(w, run, 'adaptation-failed');
    expect(existsSync(abs(`jobs/${run.id}/v1/fill.json`))).toBe(false);                    // a later call asks the model again
    expect(JSON.parse(readFileSync(abs(`jobs/${run.id}/stop.json`), 'utf8'))).toMatchObject({ reason: 'adaptation-failed', detail: expect.stringContaining('variant 2') });
  });

  it('a fill that lost a mark of the script: adaptation-failed', async () => {
    const { fill } = golden('lashly-01');
    const lost = structuredClone(fill);
    lost.script!.formula = lost.script!.formula!.replace('[name]', '').replace('[/name]', '');
    const w = world('lashly-01', { llm: [answerOf(lost, 1)] });
    nothingSent(w, await w.handle(), 'adaptation-failed');
  });

  it('a request the generator would refuse: engine-error', async () => {
    const scripted = world('layering-01', { generator: { refusals: { clip: { 5: 'this model takes 4 to 15 whole seconds' } } } });
    nothingSent(scripted, await scripted.handle(), 'engine-error');
    expect(scripted.generator.calls.filter((call) => call.kind === 'refusal')).toHaveLength(10);   // asked in order: five images, then the fifth clip is refused
    // the real rules: a model that makes clips from a first frame only cannot make a talking clip
    const real = world('lashly-01', { realRefusals: true, before: ({ db }) => writeSettings(db, { ...readSettings(db), tiers: { fast: { model: 'kling-v3-pro', resolution: '1080p' }, best: { model: 'kling-v3-pro', resolution: '1080p' } } }) });
    nothingSent(real, await real.handle(), 'engine-error');
  });

  it('a photograph of the customer that is not on the disk: engine-error', async () => {
    const w = world('layering-01', { input: { products: golden('layering-01').fill.products.map((product, i) => ({ name: product.name, description: '', images: i === 1 ? ['uploads/gone.png'] : product.images })) } });
    nothingSent(w, await w.handle(), 'engine-error');
  });

  it('the template folder is gone: template-missing', async () => {
    const w = world('layering-01', { variants: 2, before: ({ template }) => renameSync(abs(`templates/${template.id}`), abs('templates/moved-away')) });
    const run = await w.handle();
    nothingSent(w, run, 'template-missing');
    expect(run.missing).toBeNull();
    expect(w.llm.calls).toEqual([]);
  });
});

describe('a request that fails for good stops its variant, the others are delivered', () => {
  // 3 variants of 5 shots: the clips are asked in the order v1 s1…s5, v2 s1…s5, v3 s1…s5; the 8th is the third clip of variant 2
  const stoppedRun = async () => {
    const w = world('layering-01', { variants: 3, generator: { errors: { clip: { 8: 'task-failed' } } } });
    return { w, run: await w.handle() };
  };

  it('the third clip of variant 2 fails: variants 1 and 3 are done with files, variant 2 and the run are stopped, missing counts variant 2 only', async () => {
    const { w, run } = await stoppedRun();
    expect(run).toMatchObject({ state: 'stopped', reason: 'clips-failed' });
    expect(run.variants).toEqual([
      { n: 1, status: 'done', video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg`, reason: null },
      { n: 2, status: 'stopped', video: null, image: null, reason: 'clips-failed' },
      { n: 3, status: 'done', video: `jobs/${run.id}/v3/final.mp4`, image: `jobs/${run.id}/v3/poster.jpg`, reason: null },
    ]);
    expect(run.result).toEqual({ kind: 'produce', variants: [
      { video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg` }, { video: `jobs/${run.id}/v3/final.mp4`, image: `jobs/${run.id}/v3/poster.jpg` },
    ] });
    expect(existsSync(abs(`jobs/${run.id}/v1/final.mp4`)) && existsSync(abs(`jobs/${run.id}/v3/final.mp4`))).toBe(true);
    expect(w.assembled.map((media) => media.n)).toEqual([1, 3]);
    expect(operation(w.db, run.id, 'v2:clip:s3')).toMatchObject({ state: 'failed' });

    // requests of variant 2 that were in flight finished; none started after the failure; no music for it
    const clips2 = operationsOf(w.db, run.id).filter((row) => row.key.startsWith('v2:clip:'));
    const done2 = clips2.filter((row) => row.state === 'done').length;
    expect(clips2.every((row) => row.state === 'done' || row.key === 'v2:clip:s3')).toBe(true);
    expect(operation(w.db, run.id, 'v2:music')).toBeNull();
    // to send: the retry of the failed clip, the clips never sent, the music. Approved and unused: those clips and the music. Missing: the retry.
    expect(clips2.length + (5 - done2)).toBe(6);
    expect(run.missing).toEqual({ images: 0, clips: 1, clipSeconds: 4, music: 0, voice: 0 });
    expect(keysOf(w).filter((key) => /^v[13]:/.test(key))).toHaveLength(22);

    const sent = run.sent!, approved = run.approved!, missing = run.missing!;
    expect(sent).toEqual({ images: 15, clips: 10 + clips2.length, clipSeconds: 4 * (10 + clips2.length), music: 2, voice: 0 });   // the failed clip was accepted, so it was sent
    const toSend = { images: 0, clips: 1 + (5 - clips2.length), clipSeconds: 4 * (1 + 5 - clips2.length), music: 1, voice: 0 };
    for (const field of ['images', 'clips', 'clipSeconds', 'music', 'voice'] as const) {
      expect(sent[field]).toBeLessThanOrEqual(approved[field]);
      expect(approved[field] + missing[field]).toBe(sent[field] + toSend[field]);            // once the resume approves `missing`, the approval is exactly what was sent and what is still to send
    }
    expect(statuses(run.steps)).toEqual({ adaptation: 'done', images: 'done', clips: 'stopped', music: 'waiting', edit: 'waiting', render: 'waiting' });
    expect(counts(run.steps)).toMatchObject({ clips: `${10 + done2}/15`, music: '2/3', edit: '2/3', render: '2/3' });
  });

  it('the resume sends only what variant 2 misses, the failed clip under #2, and renders neither variant 1 nor 3 again', async () => {
    const { w, run: stopped } = await stoppedRun();
    const before = keysOf(w);
    const next = w.again();
    next.run = resumeRun(w.db, w.clock, stopped.id);
    const run = await next.handle(next.run);
    expect(run).toMatchObject({ state: 'done', reason: null, missing: null });               // the earlier stop is cleared
    expect(next.llm.calls).toEqual([]);                                                      // the fills on the disk are used again
    expect(next.assembled.map((media) => media.n)).toEqual([2]);
    const added = keysOf(next).filter((key) => !before.includes(key));
    expect(added).toContain('v2:clip:s3#2');
    expect(added.every((key) => key.startsWith('v2:'))).toBe(true);
    expect(next.paidCalls()).toHaveLength(added.length);
    expect(run.sent).toEqual({ images: 15, clips: 16, clipSeconds: 64, music: 3, voice: 0 });   // the need, and the clip that was paid twice
    expect(run.approved).toEqual(run.sent);                                                  // the resume approved the retry and nothing else
    expect(run.result).toMatchObject({ variants: [{ video: `jobs/${run.id}/v1/final.mp4` }, { video: `jobs/${run.id}/v2/final.mp4` }, { video: `jobs/${run.id}/v3/final.mp4` }] });
    expect(run.variants.map((variant) => variant.status)).toEqual(['done', 'done', 'done']);
    expect(counts(run.steps)).toEqual({ adaptation: '3/3', images: '15/15', clips: '15/15', music: '3/3', edit: '3/3', render: '3/3' });
  });

  it('after the failure nothing new starts for that variant: what was in flight for it finishes, the rest is never sent', async () => {
    // the 6th clip is the first one of variant 2; its second and third are in flight with it, its fourth and fifth are still waiting
    const w = world('layering-01', { variants: 3, generator: { errors: { clip: { 6: 'task-failed' } } } });
    const run = await w.handle();
    expect(['v2:clip:s1', 'v2:clip:s2', 'v2:clip:s3', 'v2:clip:s4', 'v2:clip:s5'].map((key) => operation(w.db, run.id, key)?.state ?? null)).toEqual(['failed', 'done', 'done', null, null]);
    expect(run.missing).toEqual({ images: 0, clips: 1, clipSeconds: 4, music: 0, voice: 0 });   // three clips to send, two of them approved and unused
    expect(w.paidCalls().filter((call) => call.kind === 'clip')).toHaveLength(13);
    expect(run.variants.map((variant) => variant.status)).toEqual(['done', 'stopped', 'done']);
  });

  it('an image that fails: no clip of that variant is paid for', async () => {
    const w = world('layering-01', { variants: 2, generator: { errors: { image: { 7: 'empty-result' } } } });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'images-failed' });
    expect(run.variants.map((variant) => [variant.status, variant.reason])).toEqual([['done', null], ['stopped', 'images-failed']]);
    expect(keysOf(w).filter((key) => key.startsWith('v2:clip') || key === 'v2:music')).toEqual([]);
    expect(statuses(run.steps)).toMatchObject({ images: 'stopped', clips: 'waiting', music: 'waiting' });
  });

  it('timeout: the row stays pending with its ticket, and the resume asks for it with resume, not with a paid method', async () => {
    const w = world('layering-01', { generator: { errors: { clip: { 2: 'timeout' } } } });
    const stopped = await w.handle();
    expect(stopped).toMatchObject({ state: 'stopped', reason: 'clips-failed' });
    expect(operation(w.db, stopped.id, 'v1:clip:s2')).toMatchObject({ state: 'pending', externalId: 'fake-ticket-clip-2' });
    expect(stopped.missing).toEqual(ZERO);                                                   // the clip at the provider is asked for again, free; the rest is approved already

    const next = w.again({ generator: { resumes: { 'fake-ticket-clip-2': {} } } });
    next.run = resumeRun(w.db, w.clock, stopped.id);
    const run = await next.handle(next.run);
    expect(run.state).toBe('done');
    expect(next.generator.calls.filter((call) => call.kind === 'resume').map((call) => call.ticket)).toEqual(['fake-ticket-clip-2']);
    expect(operation(w.db, run.id, 'v1:clip:s2')).toMatchObject({ state: 'done' });
    expect(operation(w.db, run.id, 'v1:clip:s2#2')).toBeNull();
    expect(run.sent).toEqual(paidFor(w.template, 1));
  });

  it('what the picture side refuses stops the variant with its reason, in the step where it stood', async () => {
    const speech = world('lashly-01', { assemble: () => ({ ok: false, reason: 'clips-failed' }) });   // the clip does not speak its lines
    const a = await speech.handle();
    expect(a).toMatchObject({ state: 'stopped', reason: 'clips-failed', missing: ZERO, result: { variants: [] } });
    expect(statuses(a.steps)).toMatchObject({ music: 'done', edit: 'stopped', render: 'waiting' });
    const quality = world('layering-01', { variants: 2, assemble: (media) => (media.n === 1 ? { ok: false, reason: 'render-failed' } : { ok: true, video: `${media.dir}/final.mp4`, image: `${media.dir}/poster.jpg` }) });
    const b = await quality.handle();
    expect(b).toMatchObject({ state: 'stopped', reason: 'render-failed', missing: ZERO });
    expect(b.variants.map((variant) => [variant.status, variant.reason])).toEqual([['stopped', 'render-failed'], ['done', null]]);
    expect(statuses(b.steps)).toMatchObject({ edit: 'done', render: 'stopped' });
    expect(existsSync(abs(`jobs/${b.id}/v1/final.mp4`))).toBe(false);
    const broken = world('layering-01', { assemble: () => { throw new Error('assemble broke'); } });
    const c = await broken.handle();
    expect(c).toMatchObject({ state: 'stopped', reason: 'engine-error', variants: [{ status: 'stopped', reason: 'engine-error' }] });
    expect(JSON.parse(readFileSync(abs(`jobs/${c.id}/stop.json`), 'utf8'))).toMatchObject({ reason: 'engine-error', detail: 'variant 1: engine-error (assemble broke)' });
  });
});

describe('what stops the whole run', () => {
  it('submission-unknown on any request: nothing more is sent, and a resume stops again at once', async () => {
    const w = world('layering-01', { variants: 3, generator: { errors: { image: { 4: 'submission-unknown' } } } });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    expect(operation(w.db, run.id, 'v1:image:s4')).toMatchObject({ state: 'unknown' });
    expect(w.paidCalls().length).toBeLessThanOrEqual(6);                                     // the 4th, and at most the two that were in flight with it
    expect(w.paidCalls().every((call) => call.kind === 'image')).toBe(true);
    expect(w.assembled).toEqual([]);
    expect(run.variants.map((variant) => variant.status)).toEqual(['stopped', 'stopped', 'stopped']);
    expect(run.variants[0]!.reason).toBe('submission-unknown');
    expect(run.missing).toEqual(ZERO);                                                       // approving more cannot continue this run

    const next = w.again();
    next.run = resumeRun(w.db, w.clock, run.id);
    const again = await next.handle(next.run);
    expect(again).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    expect(next.generator.calls).toEqual([]);
    expect(next.llm.calls).toEqual([]);
    expect(keysOf(next)).toEqual(keysOf(w));
  });

  it('an unknown answer writes one produce-unknown line with the run and the request key, and no request body', async () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, 'error').mockImplementation((...said: unknown[]) => { lines.push(said.join(' ')); });
    const unknownLines = () => lines.filter((line) => line.startsWith('produce-unknown'));
    const unknownKey = (w: World) => operationsOf(w.db, w.run.id).find((row) => row.state === 'unknown')!.key;
    try {
      // the adapter's words name the address and may quote what was asked: the line keeps the status and nothing else of them
      const said = 'POST https://api.provider.test/v1/ai/image-to-video?key=SECRET answered HTTP 502 without a task: "a prompt nobody should read"';
      const noTask = world('layering-01', { generator: { errors: { image: { 2: new GeneratorError('submission-unknown', said) } } } });
      expect(await noTask.handle()).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
      expect(unknownLines()).toEqual([`produce-unknown: run ${noTask.run.id} ${unknownKey(noTask)} http-502 no-ticket`]);
      expect(operation(noTask.db, noTask.run.id, unknownKey(noTask))!.error).toContain('HTTP 502 without a task');   // the words stay where they were: in the row

      // the resume stops again at once without sending anything: no second line for the same request
      const again = noTask.again();
      again.run = resumeRun(noTask.db, noTask.clock, noTask.run.id);
      expect(await again.handle(again.run)).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
      expect(unknownLines()).toHaveLength(1);

      // no status in the words: the error's code. With a ticket the provider took it: the line says so, and not the ticket (an address)
      lines.length = 0;
      const silent = world('layering-01', { generator: { errors: { clip: { 1: 'submission-unknown' } } } });
      await silent.handle();
      const ticketed = world('layering-01', { generator: { errors: { image: { 2: new GeneratorError('submission-unknown', 'accepted, ticket not recorded', '/v1/ai/x/t-9') } } } });
      await ticketed.handle();
      expect(unknownLines()).toEqual([
        `produce-unknown: run ${silent.run.id} ${unknownKey(silent)} submission-unknown no-ticket`,
        `produce-unknown: run ${ticketed.run.id} ${unknownKey(ticketed)} submission-unknown ticket`,
      ]);

      // an error that is not the generator's, before any ticket: unknown as well, and it has no code
      lines.length = 0;
      const broke = world('layering-01', { generator: { onCall: (call) => { if (call.kind === 'image') throw new Error('socket hang up at https://api.provider.test/v1'); } } });
      expect(await broke.handle()).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
      expect(unknownLines().length).toBeGreaterThan(0);
      for (const line of unknownLines()) expect(line).toMatch(new RegExp(`^produce-unknown: run ${broke.run.id} v1:image:s\\d+ no-code no-ticket$`));
    } finally {
      log.mockRestore();
    }
  });

  describe('settled by the operator (the request never reached the provider)', () => {
    const settleAll = (w: World, by = 'admin Ayşe') => settleUnknown(w.db, null, { runId: w.run.id, by, at: w.clock.now() });

    it('an unknown row says the units its POST consumed (an image 1, a clip its seconds); one with a ticket does not', async () => {
      const image = world('layering-01', { generator: { errors: { image: { 2: 'submission-unknown' } } } });
      await image.handle();
      const unknownImage = operationsOf(image.db, image.run.id).find((row) => row.state === 'unknown')!;
      expect(operation(image.db, image.run.id, unknownImage.key)!.error).toMatch(/\[units:1\]$/);
      const clip = world('layering-01', { generator: { errors: { clip: { 1: 'submission-unknown' } } } });
      await clip.handle();
      const unknownClip = operationsOf(clip.db, clip.run.id).find((row) => row.state === 'unknown')!;
      const seconds = needsOf(clip.template, clip.run.id, 1).find((need) => need.key === unknownClip.key)!.seconds;
      expect(operation(clip.db, clip.run.id, unknownClip.key)!.error).toMatch(new RegExp(`\\[units:${seconds}\\]$`));
      const ticketed = world('layering-01', { generator: { errors: { image: { 2: new GeneratorError('submission-unknown', 'accepted, ticket not recorded', '/v1/ai/x/t-9') } } } });
      await ticketed.handle();
      const row = operationsOf(ticketed.db, ticketed.run.id).find((r) => r.state === 'unknown')!;
      expect(operation(ticketed.db, ticketed.run.id, row.key)).toMatchObject({ externalId: '/v1/ai/x/t-9', error: '/v1/ai/x/t-9' });
    });

    it('an unknown request that has its ticket is not a lock: the next call asks for it by the ticket and the run goes on, nothing is POSTed twice', async () => {
      const w = world('layering-01', { generator: { errors: { image: { 2: new GeneratorError('submission-unknown', 'accepted, ticket not recorded', '/v1/ai/x/t-9') } } } });
      const stopped = await w.handle();
      expect(stopped).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
      const key = operationsOf(w.db, w.run.id).find((row) => row.state === 'unknown')!.key;
      expect(() => settleUnknown(w.db, null, { runId: w.run.id, by: 'a', at: w.clock.now() })).toThrow('has-ticket');
      const posted = keysOf(w).length;
      const next = w.again({ generator: { resumes: { '/v1/ai/x/t-9': {} } } });
      next.run = resumeRun(w.db, w.clock, w.run.id);
      const run = await next.handle(next.run);
      expect(run).toMatchObject({ state: 'done', reason: null });
      expect(next.generator.calls.filter((call) => call.kind === 'resume').map((call) => call.ticket)).toEqual(['/v1/ai/x/t-9']);
      expect(operation(w.db, w.run.id, key)).toMatchObject({ state: 'done', externalId: '/v1/ai/x/t-9' });
      expect(operation(w.db, w.run.id, `${key}#2`)).toBeNull();
      expect(next.paidCalls()).toHaveLength(paidFor(w.template, 1).images + paidFor(w.template, 1).clips + paidFor(w.template, 1).music - posted);
      expect(run.sent).toEqual(paidFor(w.template, 1));
    });

    it('unknown → settled → resume → done: the settled request is sent once more, everything else exactly once', async () => {
      const w = world('layering-01', { variants: 2, generator: { errors: { image: { 4: 'submission-unknown' } } } });
      const stopped = await w.handle();
      expect(stopped).toMatchObject({ state: 'stopped', reason: 'submission-unknown', missing: ZERO });
      const unknownKey = operationsOf(w.db, w.run.id).find((row) => row.state === 'unknown')!.key;
      const done = settleAll(w);
      expect(done.keys).toEqual([unknownKey]);
      expect(operation(w.db, w.run.id, unknownKey)).toMatchObject({ state: 'failed', externalId: null });
      expect(getRun(w.db, w.run.id)).toMatchObject({ state: 'stopped', reason: 'engine-error', missing: ZERO });   // approving nothing more is enough

      const madeBefore = keysOf(w, 'done').length;
      const next = w.again();
      next.run = resumeRun(w.db, w.clock, w.run.id);
      const run = await next.handle(next.run);
      expect(run.state).toBe('done');
      expect(run.sent).toEqual(paidFor(w.template, 2));
      const planned = paidFor(w.template, 2);
      const total = planned.images + planned.clips + planned.music + planned.voice;
      expect(next.paidCalls()).toHaveLength(total - madeBefore);                              // only what was never made: the settled request once, the others not at all
      expect(next.paidCalls().filter((call) => call.kind === 'image' && call.to.endsWith(`${unknownKey.split(':')[2]}.png`) && call.to.includes('/v1/'))).toHaveLength(1);
      expect(operation(w.db, w.run.id, `${unknownKey}#2`)).toMatchObject({ state: 'done' });
      expect(operationsOf(w.db, w.run.id).filter((row) => row.externalId !== null)).toHaveLength(total);   // every request of the plan has exactly one ticket
    });

    it('a row that is not unknown cannot be settled; the run stays stopped for good', async () => {
      const w = world('layering-01', { generator: { errors: { image: { 4: 'submission-unknown' } } } });
      await w.handle();
      const done = operationsOf(w.db, w.run.id).find((row) => row.state === 'done')!.key;
      expect(() => settleUnknown(w.db, null, { runId: w.run.id, by: 'a', at: w.clock.now(), keys: [done] })).toThrow('not-unknown');
      const next = w.again();
      next.run = resumeRun(w.db, w.clock, w.run.id);
      expect(await next.handle(next.run)).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
      expect(next.generator.calls).toEqual([]);
    });
  });

  it('rejected: engine-error, the row is failed, nothing more is sent', async () => {
    const w = world('layering-01', { variants: 2, generator: { errors: { clip: { 1: 'rejected' } } } });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'engine-error' });
    expect(operation(w.db, run.id, 'v1:clip:s1')).toMatchObject({ state: 'failed', externalId: null });
    expect(w.paidCalls().filter((call) => call.kind === 'clip').length).toBeLessThanOrEqual(3);
    expect(w.paidCalls().filter((call) => call.kind === 'music')).toEqual([]);
    expect(run.sent!.clips).toBe(keysOf(w).filter((key) => key.includes(':clip:')).length - 1);   // the refused one was never sent
    expect(run.variants.map((variant) => variant.reason)).toEqual(['engine-error', 'engine-error']);
    expect(w.assembled).toEqual([]);
  });

  it('a pending row without a ticket at the start (a worker died while sending): unknown, submission-unknown, nothing sent', async () => {
    const w = world('layering-01', { before: ({ db, clock, run }) => { beginOperation(db, run.id, 'v1:image:s2', 'image', clock.now()); put(`jobs/${run.id}/v1/fill.json`, JSON.stringify(golden('layering-01').fill)); } });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    expect(operation(w.db, run.id, 'v1:image:s2')).toMatchObject({ state: 'unknown' });
    expect(w.generator.calls).toEqual([]);
    expect(w.llm.calls).toEqual([]);
  });

  it('a pending row without a ticket at the start writes the same produce-unknown line as an unknown answer, once: the run, the request key, worker-stopped, no ticket', async () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, 'error').mockImplementation((...said: unknown[]) => { lines.push(said.join(' ')); });
    const unknownLines = () => lines.filter((line) => line.startsWith('produce-unknown'));
    try {
      const w = world('layering-01', { before: ({ db, clock, run }) => { beginOperation(db, run.id, 'v1:image:s2', 'image', clock.now()); put(`jobs/${run.id}/v1/fill.json`, JSON.stringify(golden('layering-01').fill)); } });
      expect(await w.handle()).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
      expect(unknownLines()).toEqual([`produce-unknown: run ${w.run.id} v1:image:s2 worker-stopped no-ticket`]);

      // the resume finds the row unknown already and stops again at once: no second line for the same request
      const again = w.again();
      again.run = resumeRun(w.db, w.clock, w.run.id);
      expect(await again.handle(again.run)).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
      expect(unknownLines()).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });

  it('a done row whose file is gone: engine-error, nothing sent, and it is not paid for again', async () => {
    const w = world('layering-01', { before: ({ db, clock, run }) => {
      beginOperation(db, run.id, 'v1:image:s1', 'image', clock.now());
      endOperation(db, run.id, 'v1:image:s1', { state: 'done', externalId: 't-1', output: `jobs/${run.id}/paid/v1/image-s1.png` }, clock.now());
      put(`jobs/${run.id}/v1/fill.json`, JSON.stringify(golden('layering-01').fill));
    } });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'engine-error' });
    expect(w.generator.calls).toEqual([]);
    expect(keysOf(w)).toEqual(['v1:image:s1']);
    expect(run.missing).toEqual(ZERO);                                                       // nothing more to approve: the image is paid, and is not paid again
  });

  it('requests were sent, but the fills are gone: engine-error, the model is not asked for other fills', async () => {
    const w = world('layering-01', { before: ({ db, clock, run }) => {
      beginOperation(db, run.id, 'v1:image:s1', 'image', clock.now());
      endOperation(db, run.id, 'v1:image:s1', { state: 'done', externalId: 't-1', output: `jobs/${run.id}/paid/v1/image-s1.png` }, clock.now());
      put(`jobs/${run.id}/paid/v1/image-s1.png`, 'an image');
    } });
    expect(await w.handle()).toMatchObject({ state: 'stopped', reason: 'engine-error' });
    expect(w.generator.calls).toEqual([]);
    expect(w.llm.calls).toEqual([]);
  });
});

describe('a handler called again', () => {
  it('on a finished run changes nothing', async () => {
    const w = world('layering-01');
    const done = await w.handle();
    const next = w.again();
    expect(await next.handle(done)).toEqual(done);
    expect(next.generator.calls).toEqual([]);
    expect(next.llm.calls).toEqual([]);
    expect(next.assembled).toEqual([]);
  });

  it('on a run a dead worker left running: goes on from the rows, sends only what has no row, asks the model nothing', async () => {
    // the first worker dies in the picture side of the only variant: every request is done
    const w = world('layering-01', { assemble: () => { throw new Error('killed'); } });
    await w.handle();
    w.db.prepare(`UPDATE runs SET state = 'running', reason = NULL WHERE id = ?`).run(w.run.id);   // as if the stop had never been written
    const next = w.again();
    const run = await next.handle(getRun(w.db, w.run.id)!);
    expect(run.state).toBe('done');
    expect(next.generator.calls).toEqual([]);
    expect(next.llm.calls).toEqual([]);
    expect(next.assembled.map((media) => media.n)).toEqual([1]);
    expect(run.sent).toEqual(paidFor(w.template, 1));
  });
});

describe('a stop is a stop: once the run is stopping, nothing that has not started is started', () => {
  /** The database with one statement that throws once, from the moment `armed()` says so. */
  const flaky = (statement: RegExp, armed: () => boolean) => (db: DatabaseSync): DatabaseSync => {
    let thrown = false;
    return new Proxy(db, { get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (property === 'prepare') return (sql: string) => {
        if (!thrown && armed() && statement.test(sql)) { thrown = true; throw new Error('database is locked'); }
        return target.prepare(sql);
      };
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    } });
  };
  const settle = async () => { for (let i = 0; i < 60; i += 1) await tick(); };

  it('a write of the steps fails while clips are in flight: what is in flight finishes and is counted, nothing else is sent, also not later', async () => {
    let armed = false;
    const w = world('layering-01', { variants: 3, database: flaky(/UPDATE runs SET steps/, () => armed), generator: { onCall: (call) => { if (call.kind === 'clip' && call.n === 2) armed = true; } } });
    const run = await w.handle();
    const calls = w.paidCalls().length;
    expect(run).toMatchObject({ state: 'stopped', reason: 'engine-error' });
    expect(w.flying()).toBe(0);                                                              // the handler waited for them
    expect(run.sent).toEqual(w.accepted());
    expect(operationsOf(w.db, run.id).filter((row) => row.state === 'pending')).toEqual([]);
    expect(w.paidCalls().filter((call) => call.kind === 'clip').length).toBeLessThanOrEqual(4);
    await settle();
    expect(w.paidCalls().length).toBe(calls);
    expect(w.offRun).toEqual([]);
    expect(getRun(w.db, run.id)!.sent).toEqual(w.accepted());
  });

  it('another worker takes the run over: this one starts no request for it any more and does not write its end', async () => {
    const w = world('layering-01', { variants: 2, generator: { onCall: (call) => {
      if (call.kind === 'clip' && call.n === 2) w.db.prepare(`UPDATE runs SET claimed_by = 'worker-2' WHERE id = ?`).run(w.run.id);
    } } });
    const run = await w.handle();
    await settle();
    expect(w.offRun.filter((call) => !call.startsWith('clip-2@'))).toEqual([]);              // the second clip was called in the instant of the takeover
    expect(w.paidCalls().filter((call) => call.kind === 'clip').length).toBeLessThanOrEqual(4);   // those in flight with the second one
    expect(w.flying()).toBe(0);
    expect(run).toMatchObject({ state: 'running', claimedBy: 'worker-2', reason: null, missing: null, result: null });
    expect(run.variants.map((variant) => variant.status)).not.toContain('stopped');          // the run is the other worker's to end
    expect(run.sent).toEqual(w.accepted());                                                  // what the provider accepted is counted, whoever owns the run
    expect(w.assembled).toEqual([]);
  });

  it('the run is stopped by someone else while requests are in flight: they finish in their rows, nothing new starts', async () => {
    const w = world('layering-01', { variants: 2, generator: { onCall: (call) => {
      if (call.kind === 'image' && call.n === 4) w.db.prepare(`UPDATE runs SET state = 'stopped', reason = 'engine-error' WHERE id = ?`).run(w.run.id);
    } } });
    const run = await w.handle();
    await settle();
    expect(w.offRun.filter((call) => !call.startsWith('image-4@'))).toEqual([]);
    expect(w.paidCalls().length).toBeLessThanOrEqual(6);
    expect(operationsOf(w.db, run.id).map((row) => `${row.key} ${row.state}`).filter((row) => !row.endsWith(' done'))).toEqual([]);
    expect(w.assembled).toEqual([]);
    expect(w.llm.calls).toHaveLength(1);
  });
});

/** A dead worker's run: the stop was never written, and nobody approved anything more. */
const takeover = (w: World, options?: Options): World => {
  w.db.prepare(`UPDATE runs SET state = 'running', reason = NULL, missing = NULL WHERE id = ?`).run(w.run.id);
  const next = w.again(options);
  next.run = getRun(w.db, w.run.id)!;
  return next;
};

describe('the count before the first request of a later call', () => {
  it('what the rows have used and what is to send do not fit the approval: nothing is sent, not even what would fit', async () => {
    // 2 variants, one image more approved than needed. Variant 2 loses an image, variant 1 a clip: both were accepted, so both are used up.
    const { template } = golden('layering-01');
    const w = world('layering-01', { variants: 2, approved: { ...paidFor(template, 2), images: 11 }, generator: { errors: { image: { 7: 'task-failed' }, clip: { 3: 'task-failed' } } } });
    expect(await w.handle()).toMatchObject({ state: 'stopped', variants: [{ reason: 'clips-failed' }, { reason: 'images-failed' }] });
    // the retried image of variant 2 fits (11 approved); its five clips and the retried clip of variant 1 do not (5 used + 6 > 10)
    const next = takeover(w);
    const run = await next.handle(next.run);
    expect(run).toMatchObject({ state: 'stopped', reason: 'estimate-exceeded' });
    expect(next.paidCalls()).toEqual([]);                                                    // not the image either: the run would stop half-way
    expect(run.missing).toMatchObject({ images: 0, clips: 1, clipSeconds: 4 });
  });
});

describe('ids that look like a retry', () => {

  it.each(['s', 'r'])('shot ids that begin with %s: a retried clip bills its seconds, under a key that is read back exactly', async (letter) => {
    const renamed = goldenWith('layering-01', (json) => json.replace(/"s([1-5])"/g, `"${letter}$1"`));
    const need = paidFor(renamed.template, 1);
    // room for two more clips by count, for one more by seconds
    const w = world('layering-01', { golden: renamed, approved: { ...need, clips: 7, clipSeconds: 24 }, generator: { errors: { clip: { 3: 'task-failed' } } } });
    expect((await w.handle()).reason).toBe('clips-failed');
    expect(keysOf(w).filter((key) => key.includes(':clip:'))).toEqual([1, 2, 3, 4, 5].map((n) => `v1:clip:${letter}${n}`));

    const second = takeover(w, { generator: { errors: { clip: { 1: 'task-failed' } } } });       // the retry fails too
    expect(await second.handle(second.run)).toMatchObject({ state: 'stopped', reason: 'clips-failed', sent: { clips: 6, clipSeconds: 24 } });
    expect(second.paidCalls().map((call) => call.kind)).toEqual(['clip']);
    expect(operation(w.db, w.run.id, `v1:clip:${letter}3#2`)).toMatchObject({ state: 'failed', kind: 'clip' });

    const third = takeover(second);                                                              // a third attempt would be 28 seconds of 24
    const run = await third.handle(third.run);
    expect(run).toMatchObject({ state: 'stopped', reason: 'estimate-exceeded', sent: { clips: 6, clipSeconds: 24 } });
    expect(third.paidCalls()).toEqual([]);
    expect(run.sent!.clipSeconds).toBeLessThanOrEqual(run.approved!.clipSeconds);
    expect(operation(w.db, w.run.id, `v1:clip:${letter}3#3`)).toBeNull();
  });

  it('a speech template with the segment r2 and the shots r1 … r3: a clean run, the clips by segment', async () => {
    const renamed = goldenWith('lashly-01', (json) => json.replace(/"formula"/g, '"r2"').replace(/"s([1-3])"/g, '"r$1"'));
    const w = world('lashly-01', { golden: renamed });
    const run = await w.handle();
    expect(run.state).toBe('done');
    expect(run.sent).toEqual(paidFor(renamed.template, 1));
    expect(Object.keys(w.assembled[0]!.clips)).toEqual(['trial', 'r2', 'verdict']);
    expect(keysOf(w).filter((key) => key.includes(':clip:'))).toEqual(['v1:clip:r1', 'v1:clip:r2', 'v1:clip:r3']);
  });
});

describe('missing: a resume approves only what is not approved yet', () => {
  const resumed = async (earlier: World, options?: Options): Promise<{ w: World; run: RunRow }> => {
    const w = earlier.again(options);
    w.run = resumeRun(earlier.db, earlier.clock, earlier.run.id);
    return { w, run: await w.handle(w.run) };
  };

  it('a clip that times out for good: three resumes send what was never sent and approve nothing', async () => {
    const first = world('layering-01', { generator: { errors: { clip: { 2: 'timeout' } } } });
    const need = paidFor(first.template, 1);
    let run = await first.handle(), w = first;
    expect(run.missing).toEqual(ZERO);
    for (let i = 0; i < 3; i += 1) {
      ({ w, run } = await resumed(w, { generator: { resumes: { 'fake-ticket-clip-2': 'timeout' } } }));
      expect(run).toMatchObject({ state: 'stopped', reason: 'clips-failed', missing: ZERO });
      expect(run.approved).toEqual(need);                                                    // not one request more than the customer confirmed first
    }
    expect(run.sent).toEqual({ ...need, music: 0 });                                         // every clip was sent once; the music never
  });

  it('an unknown submission: every resume stops at once, and the approval stays what it was', async () => {
    const first = world('layering-01', { generator: { errors: { image: { 4: 'submission-unknown' } } } });
    let run = await first.handle(), w = first;
    for (let i = 0; i < 3; i += 1) {
      ({ w, run } = await resumed(w));
      expect(run).toMatchObject({ state: 'stopped', reason: 'submission-unknown', missing: ZERO });
      expect(w.paidCalls()).toEqual([]);
    }
    expect(run.approved).toEqual(paidFor(first.template, 1));
  });

  it('a request that fails on every attempt: each resume approves that one retry, and the approval is what was sent and is to send', async () => {
    const first = world('layering-01', { generator: { errors: { music: { 1: 'task-failed' } } } });
    let run = await first.handle(), w = first;
    expect(run.missing).toEqual({ ...ZERO, music: 1 });
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      ({ w, run } = await resumed(w, { generator: { errors: { music: { 1: 'task-failed' } } } }));
      expect(run).toMatchObject({ state: 'stopped', reason: 'audio-failed', missing: { ...ZERO, music: 1 }, sent: { music: attempt }, approved: { music: attempt } });
      expect(w.paidCalls().map((call) => call.kind)).toEqual(['music']);
    }
    ({ run } = await resumed(w));
    expect(run).toMatchObject({ state: 'done', sent: { images: 5, clips: 5, music: 4 }, approved: { images: 5, clips: 5, clipSeconds: 20, music: 4 } });
  });

  it('a request the provider refused was never started: the resume finishes the run inside the first approval', async () => {
    const first = world('layering-01', { variants: 2, generator: { errors: { clip: { 1: 'rejected' } } } });
    const stopped = await first.handle();
    expect(stopped).toMatchObject({ state: 'stopped', reason: 'engine-error', missing: ZERO });
    const { run } = await resumed(first);
    expect(run.state).toBe('done');
    expect(run.approved).toEqual(paidFor(first.template, 2));
    expect(run.sent).toEqual(run.approved);
    expect(operation(first.db, run.id, 'v1:clip:s1#2')).toMatchObject({ state: 'done' });
  });
});

describe('the provider has no credits left (HTTP 402)', () => {
  const noCredits = () => new GeneratorError('rejected', 'POST /v1/ai/text-to-image/nano-banana-pro was refused: HTTP 402: Insufficient credits', null, 402);

  it('the stop says why (detail provider-credits), and "Try again" pays only for what was never made', async () => {
    const first = world('layering-01', { variants: 2, generator: { errors: { image: { 4: noCredits() } } } });
    const stopped = await first.handle();
    expect(stopped).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: 'provider-credits', missing: ZERO });
    const made = keysOf(first, 'done').filter((key) => key.includes(':image:'));
    expect(made.length).toBeGreaterThan(0);
    const again = first.again();
    again.run = resumeRun(first.db, first.clock, first.run.id);
    const run = await again.handle(again.run);
    expect(run.state).toBe('done');
    expect(run.sent).toEqual(paidFor(first.template, 2));                                   // every request was sent once: nothing was paid twice
    const sentAgain = again.paidCalls().filter((call) => call.kind === 'image').length;
    expect(sentAgain).toBe(paidFor(first.template, 2).images - made.length);                // the images that were made are not asked for again
    for (const key of made) expect(operation(again.db, run.id, key)).toMatchObject({ state: 'done' });
  });

  it('a provider that refuses every request is asked once per request in a call, and once more per "Try again": the refusal never loops', async () => {
    const always = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, noCredits()]));
    const first = world('layering-01', { generator: { errors: { image: always } } });
    expect((await first.handle()).detail).toBe('provider-credits');
    const callsFirst = first.paidCalls().length;
    expect(callsFirst).toBeGreaterThan(0);
    expect(callsFirst).toBeLessThanOrEqual(5);                                              // at most one POST per image of the plan, none repeated inside the call
    const keys = first.paidCalls().map((call) => call.to);
    expect(new Set(keys).size).toBe(keys.length);
    const again = first.again({ generator: { errors: { image: always } } });
    again.run = resumeRun(first.db, first.clock, first.run.id);
    expect((await again.handle(again.run)).detail).toBe('provider-credits');
    expect(again.paidCalls().length).toBeLessThanOrEqual(5);                                // the next call is the owner's "Try again", not an automatic loop
    expect(again.paidCalls().length).toBeGreaterThan(0);
  });

  it('the refusal puts the provider on hold, and the run tried again lifts it with its first accepted request', async () => {
    const first = world('layering-01', { variants: 2, generator: { errors: { image: { 4: noCredits() } } } });
    await first.handle();
    expect(creditsHold(first.db)).toMatchObject({ runId: first.run.id });
    const again = first.again();
    again.run = resumeRun(first.db, first.clock, first.run.id);
    expect((await again.handle(again.run)).state).toBe('done');
    expect(creditsHold(first.db)).toBeNull();
  });

  it('while the hold stands a new run does not start: the model is not asked, nothing is sent, and the stop says why; tried again, it is the question to the provider and lifts the hold', async () => {
    const w = world('layering-01', { before: ({ db, clock }) => holdCredits(db, 'another-run', 'v1:clip:s2', clock.now()) });
    const stopped = await w.handle();
    expect(stopped).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: 'provider-credits', missing: ZERO });
    expect(w.llm.calls).toEqual([]);
    expect(w.paidCalls()).toEqual([]);
    expect(operationsOf(w.db, w.run.id)).toEqual([]);
    expect(creditsHold(w.db)).toMatchObject({ runId: 'another-run' });

    const again = w.again({ llm: [answerOf(w.fill, 1)] });
    again.run = resumeRun(w.db, w.clock, w.run.id);
    expect((await again.handle(again.run)).state).toBe('done');
    expect(creditsHold(w.db)).toBeNull();
  });

  it('a second run of the worker that is under way when the first one is refused sends nothing more and stops for the same reason', async () => {
    const first = world('layering-01', { generator: { errors: { image: { 1: noCredits() } } } });
    let sentByThen = -1;                                                                     // what the second run had sent when the first one was refused and stopped
    const second = world('layering-01', { db: first.db, generator: { onCall: async () => {
      if (sentByThen >= 0) return;
      sentByThen = 0;
      await first.handle();
      sentByThen = second.paidCalls().length;
    } } });
    const stopped = await second.handle();
    expect(getRun(first.db, first.run.id)).toMatchObject({ state: 'stopped', detail: 'provider-credits' });
    expect(stopped).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: 'provider-credits' });
    expect(second.paidCalls()).toHaveLength(sentByThen);                                     // nothing after the refusal
    expect(sentByThen).toBeLessThan(11);                                                     // of 5 images, 5 clips and the music
    expect(creditsHold(first.db)).toMatchObject({ runId: first.run.id });                   // the second run's accepted requests were sent before the refusal: they lift nothing
  });

  it('a run with nothing left to send goes on to its render while the hold stands', async () => {
    const first = world('layering-01', { assemble: () => ({ ok: false, reason: 'render-failed' }) });
    expect((await first.handle()).reason).toBe('render-failed');
    holdCredits(first.db, 'another-run', 'v1:clip:s2', first.clock.now());
    const again = first.again();
    again.run = resumeRun(first.db, first.clock, first.run.id);
    expect((await again.handle(again.run)).state).toBe('done');
    expect(again.paidCalls()).toEqual([]);
    expect(creditsHold(first.db)).toMatchObject({ runId: 'another-run' });
  });

  it('other refusals get their own codes: a cap, any other 4xx', async () => {
    const cap = new GeneratorError('rejected', 'provider-cap');
    expect((await world('layering-01', { generator: { errors: { image: { 1: cap } } } }).handle()).detail).toBe('provider-cap');
    const other = new GeneratorError('rejected', 'POST was refused: HTTP 400: bad reference', null, 400);
    expect((await world('layering-01', { generator: { errors: { image: { 1: other } } } }).handle()).detail).toBe('provider-refused');
  });
});

describe('the end of a run', () => {
  const stopFile = (run: RunRow) => JSON.parse(readFileSync(abs(`jobs/${run.id}/stop.json`), 'utf8')) as { reason: string; detail: string };

  it('stop.json cannot be written: the run still stops with its reason, its result and what is missing', async () => {
    const w = world('layering-01', { variants: 2, generator: { errors: { clip: { 8: 'task-failed' } } }, before: ({ run }) => mkdirSync(abs(`jobs/${run.id}/stop.json`), { recursive: true }) });
    const run = await w.handle();                                                            // does not throw
    expect(run).toMatchObject({ state: 'stopped', reason: 'clips-failed', missing: { clips: 1, clipSeconds: 4 } });
    expect(run.result).toEqual({ kind: 'produce', variants: [{ video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg` }] });
  });

  it('what the picture side says about a stopped variant is kept for the admin', async () => {
    const w = world('layering-01', { assemble: () => ({ ok: false, reason: 'render-failed', detail: 'text-overflow: the text "hook" leaves its box on frame 12' }) });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'render-failed' });
    expect(stopFile(run)).toEqual({ reason: 'render-failed', detail: 'variant 1: render-failed (text-overflow: the text "hook" leaves its box on frame 12)', at: expect.any(String) });
  });

  it('the aligner of the machine is handed to the picture side with the other parts', async () => {
    const aligner: Aligner = { align: async () => [], ready: async () => ({ ready: false, note: 'not installed' }) };
    const w = world('layering-01', { aligner });
    await w.handle();
    expect(w.given[0]!.aligner).toBe(aligner);
    expect(w.given[0]).toHaveProperty('renderer');
    expect(w.given[0]).not.toHaveProperty('assemble');
    const without = world('layering-01');
    await without.handle();
    expect(without.given[0]!.aligner).toBeUndefined();
  });
});

describe('sample: the first variant of a sample run becomes the template\'s own video', () => {
  const recorder = () => {
    const calls: { run: string; variant: unknown; parts: string[] }[] = [];
    const sample: NonNullable<ProduceDeps['sample']> = (deps, run, variant) => { calls.push({ run: run.id, variant, parts: Object.keys(deps).sort() }); };
    return { calls, sample };
  };

  it('is written once, after the last variant, with the video and the poster of variant 1', async () => {
    const { calls, sample } = recorder();
    const w = world('layering-01', { variants: 2, input: { sample: true }, sample, generator: { errors: { clip: { 8: 'task-failed' } } } });
    const stopped = await w.handle();                                                        // variant 2 stops, variant 1 is delivered
    expect(stopped.state).toBe('stopped');
    expect(calls).toEqual([{ run: stopped.id, variant: { video: `jobs/${stopped.id}/v1/final.mp4`, image: `jobs/${stopped.id}/v1/poster.jpg` }, parts: ['clock', 'db'] }]);
    expect(w.assembled.map((media) => media.n)).toEqual([1]);
    const next = w.again({ sample });
    next.run = resumeRun(w.db, w.clock, stopped.id);
    expect((await next.handle(next.run)).state).toBe('done');
    expect(calls).toHaveLength(1);                                                           // variant 1 was finished by the earlier call: not written again
  });

  it('is not written when the run did not ask for one, or when variant 1 stopped', async () => {
    const plain = recorder();
    expect((await world('layering-01', { sample: plain.sample }).handle()).state).toBe('done');
    const failed = recorder();
    await world('layering-01', { input: { sample: true }, sample: failed.sample, assemble: () => ({ ok: false, reason: 'render-failed' }) }).handle();
    expect([plain.calls, failed.calls]).toEqual([[], []]);
  });

  it('a sample that cannot be written is noted and changes nothing of the run', async () => {
    const w = world('lashly-01', { input: { sample: true }, sample: () => { throw new Error('the template folder is read-only'); },
      golden: (() => { const g = golden('lashly-01'); g.fill.products[0]!.images = [g.fill.products[0]!.images[0]!]; return g; })() });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'done', reason: null, variants: [{ status: 'done' }] });
    const notes = JSON.parse(readFileSync(abs(`jobs/${run.id}/notes.json`), 'utf8')) as { code: string; message?: string }[];
    expect(notes.map((note) => note.code)).toEqual(['left-out', 'left-out', 'sample-failed']);  // the notes of the adaptation stay
    expect(notes.at(-1)).toEqual({ code: 'sample-failed', message: 'the template folder is read-only' });
  });
});

describe('sent follows the rows', () => {
  it('a worker died between storing a ticket and counting it: the next call counts what the rows say was accepted', async () => {
    const w = world('layering-01', { before: ({ db, clock, run, template }) => {
      put(`jobs/${run.id}/v1/fill.json`, JSON.stringify(golden('layering-01').fill));
      for (const need of needsOf(template, run.id, 1).filter((each) => each.kind === 'image')) {
        beginOperation(db, run.id, need.key, 'image', clock.now());
        endOperation(db, run.id, need.key, { state: 'done', externalId: `t-${need.id}`, output: need.file }, clock.now());
        put(need.file, 'an image');
      }
      beginOperation(db, run.id, 'v1:clip:s1', 'clip', clock.now());
      endOperation(db, run.id, 'v1:clip:s1', { externalId: 'ticket-clip-s1' }, clock.now());                 // accepted, the worker died here
      db.prepare('UPDATE runs SET sent = ? WHERE id = ?').run(JSON.stringify({ ...ZERO, images: 5 }), run.id);   // the clip was never counted
    }, generator: { resumes: { 'ticket-clip-s1': {} }, onCall: (call) => {
      // put right before anything is asked or sent
      if (call.kind === 'resume') seen.push(getRun(w.db, w.run.id)!.sent);
    } } });
    const seen: unknown[] = [];
    const run = await w.handle();
    expect(seen).toEqual([{ images: 5, clips: 1, clipSeconds: 4, music: 0, voice: 0 }]);
    expect(run.state).toBe('done');
    expect(run.sent).toEqual(paidFor(w.template, 1));
    expect(w.paidCalls().map((call) => call.kind)).toEqual(['clip', 'clip', 'clip', 'clip', 'music']);
  });
});

describe('a generated file is named by what it is, and the next request reads it by that name', () => {
  it('beats: an image that arrives as a JPEG is the first frame of its clip under its real name', async () => {
    const w = world('layering-01', { delivery: (kind, n) => (kind === 'image' && n === 3 ? JPEG : kind === 'image' ? MEDIA_BYTES.image : kind === 'clip' ? MEDIA_BYTES.clip : MEDIA_BYTES.music) });
    const run = await w.handle();
    expect(run.state).toBe('done');
    const real = `jobs/${run.id}/paid/v1/image-s3.jpg`;
    expect(operation(w.db, run.id, 'v1:image:s3')).toMatchObject({ state: 'done', output: real });
    const frames = w.paidCalls().filter((call) => call.kind === 'clip').map((call) => (call.request as { firstFrame: string }).firstFrame);
    expect(frames).toEqual([1, 2, 3, 4, 5].map((n) => abs(`jobs/${run.id}/paid/v1/image-s${n}.${n === 3 ? 'jpg' : 'png'}`)));
    expect(w.assembled[0]!.images.s3).toBe(real);
    expect(existsSync(abs(real))).toBe(true);
  });

  it('speech: a voice that arrives as a WAV is what the talking clips are made from; a still under another name is the reference of the next', async () => {
    const w = world('lashly-01', { delivery: (kind, n) => (kind === 'voice' ? WAV : kind === 'image' && n === 2 ? JPEG : kind === 'image' ? MEDIA_BYTES.image : kind === 'clip' ? MEDIA_BYTES.clip : MEDIA_BYTES.music) });
    const run = await w.handle();
    expect(run.state).toBe('done');
    const clips = w.paidCalls().filter((call) => call.kind === 'clip').map((call) => call.request as { voice: string; presenter: string });
    expect(new Set(clips.map((clip) => clip.voice))).toEqual(new Set([abs(`jobs/${run.id}/paid/v1/voice.wav`)]));
    expect(new Set(clips.map((clip) => clip.presenter))).toEqual(new Set([abs(`jobs/${run.id}/paid/v1/image-presenter.png`)]));
    const after = w.paidCalls().find((call) => call.to.endsWith('image-proof-after.png'))!.request as { references: string[] };
    expect(after.references).toEqual([abs(`jobs/${run.id}/paid/v1/image-proof-before.jpg`)]);
    expect(w.assembled[0]).toMatchObject({ voice: `jobs/${run.id}/paid/v1/voice.wav`, images: { 'proof-before': `jobs/${run.id}/paid/v1/image-proof-before.jpg` } });
  });

  it('a file that is no picture stops its variant like an empty result, and no clip is paid for it', async () => {
    const w = world('layering-01', { delivery: (kind, n) => (kind === 'image' && n === 2 ? '{"error":"expired"}' : kind === 'image' ? MEDIA_BYTES.image : MEDIA_BYTES.clip) });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'images-failed', missing: { images: 1 } });
    expect(operation(w.db, run.id, 'v1:image:s2')).toMatchObject({ state: 'failed' });
    expect(w.paidCalls().filter((call) => call.kind !== 'image')).toEqual([]);
  });
});

describe('the customer\'s photographs are read before anything is paid', () => {
  it('every photograph the run uses is probed: the references of paid requests, and what a card or a window shows', async () => {
    const speech = world('lashly-01');
    await speech.handle();
    expect(speech.media.calls.map((call) => call.kind === 'probe' && call.file)).toEqual(speech.fill.products[0]!.images.map((image) => abs(image)));   // product:1 for the presenter and two cards, 1.2 and 1.3 for a card each
    const beats = world('layering-01');
    await beats.handle();
    expect(new Set(beats.media.calls.map((call) => call.kind === 'probe' && call.file))).toEqual(new Set(beats.fill.products.map((product) => abs(product.images[0]!))));
  });

  it('a photograph that only a card shows cannot be read: the run stops with images-failed, and nothing is sent', async () => {
    const { fill } = golden('lashly-01');
    const onlyOnACard = fill.products[0]!.images[1]!;                                        // product:1.2: no paid request reads it
    const w = world('lashly-01', { probes: { [onlyOnACard]: new MediaError('not-media', 'tube-open-applicator.png is not a picture') } });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'images-failed', sent: null, variants: [{ status: 'stopped', reason: 'images-failed' }] });
    expect(w.paidCalls()).toEqual([]);
    expect(operationsOf(w.db, run.id)).toEqual([]);
    const { detail } = JSON.parse(readFileSync(abs(`jobs/${run.id}/stop.json`), 'utf8')) as { detail: string };
    expect(detail).toContain('product 1');
    expect(detail).toContain(fill.products[0]!.name);
    expect(detail).toContain(onlyOnACard);
    expect(detail).toContain('is not a picture');
  });

  it('a picture without a size is not a picture; a tool that fails is the engine\'s fault: nothing is sent either way', async () => {
    const { fill } = golden('layering-01');
    const flat = world('layering-01', { probes: { [fill.products[2]!.images[0]!]: { width: 0, height: 0, fps: 0, frames: 0, seconds: 0, audio: false } } });
    expect(await flat.handle()).toMatchObject({ state: 'stopped', reason: 'images-failed' });
    const broken = world('layering-01', { probes: { [fill.products[0]!.images[0]!]: new MediaError('tool-failed', 'ffprobe does not run') } });
    expect(await broken.handle()).toMatchObject({ state: 'stopped', reason: 'engine-error' });
    expect([flat.paidCalls(), broken.paidCalls()]).toEqual([[], []]);
  });
});

describe('a paid file the picture side refuses is made again, and nothing else', () => {
  const refusing = (faulty: { kind: 'image' | 'clip' | 'music' | 'voice'; id?: string }[], reason: StopReason = 'clips-failed') => {
    let asked = 0;
    return (media: VariantMedia): Assembled => ((asked += 1) === 1
      ? { ok: false, reason, detail: 'the clip is 2.1 s, its shot needs 3.2 s', faulty }
      : { ok: true, video: `${media.dir}/final.mp4`, image: `${media.dir}/poster.jpg` });
  };

  it('a faulty clip: its row is failed, one clip and its seconds are missing, the resume sends that one request under #2 and assembles again', async () => {
    const assemble = refusing([{ kind: 'clip', id: 's2' }]);
    const w = world('layering-01', { assemble });
    const stopped = await w.handle();
    expect(stopped).toMatchObject({ state: 'stopped', reason: 'clips-failed', missing: { images: 0, clips: 1, clipSeconds: 4, music: 0, voice: 0 } });
    expect(operation(w.db, stopped.id, 'v1:clip:s2')).toMatchObject({ state: 'failed', externalId: 'fake-ticket-clip-2', error: 'refused-by-assemble: the clip is 2.1 s, its shot needs 3.2 s' });
    expect(existsSync(abs(`jobs/${stopped.id}/paid/v1/clip-s2.mp4`))).toBe(true);            // the file stays
    expect(keysOf(w, 'done')).toHaveLength(10);
    expect(counts(stopped.steps)).toMatchObject({ clips: '4/5', edit: '0/1' });
    expect(stopped.sent).toEqual(paidFor(w.template, 1));                                    // it was paid

    const next = w.again({ assemble });
    next.run = resumeRun(w.db, w.clock, stopped.id);
    const run = await next.handle(next.run);
    expect(run.state).toBe('done');
    expect(next.paidCalls().map((call) => [call.kind, call.to])).toEqual([['clip', abs(`jobs/${run.id}/paid/v1/clip-s2.mp4`)]]);
    expect(operation(w.db, run.id, 'v1:clip:s2#2')).toMatchObject({ state: 'done' });
    expect(next.assembled.map((media) => media.n)).toEqual([1]);
    expect(run.sent).toEqual({ ...paidFor(w.template, 1), clips: 6, clipSeconds: 24 });
    expect(run.approved).toEqual(run.sent);
  });

  it('speech: a clip is named by its segment, the voice and the music by their kind', async () => {
    const w = world('lashly-01', { assemble: refusing([{ kind: 'clip', id: 'formula' }, { kind: 'voice' }, { kind: 'music' }, { kind: 'image', id: 'proof-after' }], 'audio-failed') });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'audio-failed', missing: { images: 1, clips: 1, clipSeconds: 9, music: 1, voice: 1 } });
    expect(keysOf(w, 'failed')).toEqual(['v1:clip:s2', 'v1:image:proof-after', 'v1:music', 'v1:voice']);
  });

  it('a faulty file the variant has no row for is ignored with a note, never a throw', async () => {
    const w = world('layering-01', { assemble: refusing([{ kind: 'clip', id: 'nope' }, { kind: 'voice' }, { kind: 'image' }]) });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'clips-failed', missing: ZERO });
    expect(keysOf(w, 'failed')).toEqual([]);
    const notes = JSON.parse(readFileSync(abs(`jobs/${run.id}/notes.json`), 'utf8')) as { code: string; message: string }[];
    expect(notes.map((note) => note.code)).toEqual(['faulty-unknown', 'faulty-unknown', 'faulty-unknown']);
    expect(notes[0]!.message).toContain('clip "nope"');
  });
});

describe('SIGTERM with a paid request in flight (C6b review)', () => {
  it('the worker is handed back after the ticket is stored: the next worker resumes by the ticket, sends no second request, and `sent` is right', async () => {
    const w = world('layering-01');
    const original = w.generator.clip.bind(w.generator);
    let asked = 0;
    // the 2nd clip is accepted (ticket stored, counted); then the signal: the run is handed back and the request dies with the process
    w.generator.clip = async (request, to, onSubmitted) => {
      asked += 1;
      if (asked !== 2) return original(request, to, onSubmitted);
      await original(request, to, (ticket) => { onSubmitted(ticket); release(w.db, w.run.id, w.run.claimedBy!, w.clock.now()); });
      throw new GeneratorError('timeout', 'the render process was killed', 'fake-ticket-clip-2');
    };
    const first = await asOwner({ runId: w.run.id, workerId: w.run.claimedBy!, refused: null }, () => w.handle());
    expect(first).toMatchObject({ state: 'running', claimedBy: null, reason: null });          // nothing the dying worker wrote after the hand-back reached the run
    expect(operation(w.db, w.run.id, 'v1:clip:s2')).toMatchObject({ state: 'pending', externalId: 'fake-ticket-clip-2', error: null });
    const sentBefore = first.sent;

    // the other requests of the pool were in flight too: each is pending with its ticket (the ticket of a lost worker's request is still recorded), none done by the dead worker
    const inFlight = operationsOf(w.db, w.run.id).filter((row) => row.state === 'pending');
    expect(inFlight.map((row) => row.key)).toContain('v1:clip:s2');
    expect(inFlight.every((row) => row.externalId !== null)).toBe(true);
    const resumes = Object.fromEntries(inFlight.map((row) => [row.externalId!, {}]));
    const claimed = claim(w.db, 'worker-2', w.clock.now())!;                                     // the next worker takes it at once
    expect(claimed.id).toBe(w.run.id);
    const next = w.again({ generator: { resumes } });
    next.run = claimed;
    const run = await asOwner({ runId: claimed.id, workerId: 'worker-2', refused: null }, () => next.handle(claimed));
    expect(run, JSON.stringify([run.reason, existsSync(abs(`jobs/${run.id}/stop.json`)) ? readFileSync(abs(`jobs/${run.id}/stop.json`), 'utf8') : null])).toMatchObject({ state: 'done' });
    expect(next.generator.calls.filter((call) => call.kind === 'resume').map((call) => call.ticket).sort()).toEqual(inFlight.map((row) => row.externalId!).sort());
    // a clip is sent once: the dead worker's calls and this worker's together are one per clip of the plan, none of them a retry
    const clipCalls = [...w.paidCalls(), ...next.paidCalls()].filter((call) => call.kind === 'clip').length;
    expect(clipCalls).toBe(paidFor(w.template, 1).clips);
    expect(keysOf(w).filter((key) => key.includes('#'))).toEqual([]);
    expect(operation(w.db, run.id, 'v1:clip:s2')).toMatchObject({ state: 'done' });
    expect(operation(w.db, run.id, 'v1:clip:s2#2')).toBeNull();
    expect(run.sent).toEqual(paidFor(w.template, 1));
    expect(sentBefore!.clips).toBeLessThanOrEqual(run.sent!.clips);                              // never counted twice
  });
});

// The steps after the images, through the handler with the fake generator: what each failure of a paid request does to the run, to the
// money (the budget the site keeps, a request counted at its POST as the Magnific client counts it) and to a resume.
describe('failures after the images: clips and music × a refusal (402, 429), a POST with no answer (5xx), a task that never finishes, a finished file that cannot be fetched', () => {
  const CAPS = { daily: 1000, job: 1000 };
  const unitsOf = (call: GeneratorCall) => (call.kind === 'clip' ? (call.request as { seconds: number }).seconds : 1);
  /** The site's budget: reserved when the job starts, every paid POST consumed at its call; a resume reserves what it approves (`false`: it does, and it is nothing here). */
  function metered(options: Options = {}, reserve = true): Options {
    let held: { db: DatabaseSync; run: RunRow; clock: FakeClock } | null = null;
    return {
      ...options,
      before: (w) => {
        held = w; budgetSchema(w.db);
        if (reserve) reserveProvider(w.db, CAPS, w.run.ref, providerUnits(paidFor(w.template, options.variants ?? 1)), w.clock.now());
        options.before?.(w);
      },
      generator: { ...options.generator, onCall: (call) => {
        if (PAID_KINDS.includes(call.kind)) consumeProvider(held!.db, CAPS, held!.run.ref, unitsOf(call), held!.clock.now());
        return options.generator?.onCall?.(call);
      } },
    };
  }
  const budgetOf = (w: World) => w.db.prepare('SELECT reserved, consumed FROM provider_budget WHERE run_id = ?').get(w.run.ref) as { reserved: number; consumed: number };
  const unitsSent = (...worlds: World[]) => worlds.flatMap((w) => w.paidCalls()).reduce((sum, call) => sum + unitsOf(call), 0);

  const refused = (status: number, text: string) => new GeneratorError('rejected', `POST /v1/ai/x was refused: HTTP ${status}: ${text}`, null, status);
  const FAILURES = [
    { name: '402 no credits', error: () => refused(402, 'Insufficient credits'), halts: true, reason: () => 'engine-error', detail: 'provider-credits', ticket: false, resumable: true },
    { name: '429 too many requests', error: () => refused(429, 'Too many requests'), halts: true, reason: () => 'engine-error', detail: 'provider-refused', ticket: false, resumable: true },
    { name: '5xx with no task in the answer', error: () => new GeneratorError('submission-unknown', 'POST /v1/ai/x answered HTTP 503 without a task: the request may exist, do not send it again'), halts: true, reason: () => 'submission-unknown', detail: null, ticket: false, resumable: false },
    { name: 'a task that never finishes (timeout)', error: () => 'timeout' as GeneratorErrorCode, halts: false, reason: (kind: string) => (kind === 'clip' ? 'clips-failed' : 'audio-failed'), detail: null, ticket: true, resumable: true },
    { name: 'a finished task whose file cannot be fetched', error: () => 'download-failed' as GeneratorErrorCode, halts: false, reason: (kind: string) => (kind === 'clip' ? 'clips-failed' : 'audio-failed'), detail: null, ticket: true, resumable: true },
  ];
  // two variants: the images are calls 1–10, then the clips (variant 1: 1–5, variant 2: 6–10), then the music (variant 1: 1, variant 2: 2)
  const STEPS = [{ kind: 'clip' as const, n: 7, key: 'v2:clip:s2', step: 'clips' }, { kind: 'music' as const, n: 2, key: 'v2:music', step: 'music' }];

  it('a run that finishes gives back what it reserved and did not consume, and keeps what it consumed', async () => {
    const w = world('layering-01', metered({ before: ({ db, run, clock }) => { reserveProvider(db, CAPS, run.ref, 30, clock.now()); } }));   // 30 more than the run needs
    const run = await w.handle();
    expect(run.state).toBe('done');
    expect(budgetOf(w)).toEqual({ reserved: unitsSent(w), consumed: unitsSent(w) });
    expect(unitsSent(w)).toBe(providerUnits(paidFor(w.template, 1)));
  });

  for (const step of STEPS) {
    describe(`at the ${step.kind} of variant 2`, () => {
      it.each(FAILURES)(`$name: the stop, the steps, the variants, the count and the budget`, async (failure) => {
        const w = world('layering-01', metered({ variants: 2, generator: { errors: { [step.kind]: { [step.n]: failure.error() } } } }));
        const stopped = await w.handle();
        expect(stopped).toMatchObject({ state: 'stopped', reason: failure.reason(step.kind), detail: failure.detail, missing: ZERO });
        const row = operation(w.db, stopped.id, step.key)!;
        expect(row.state).toBe(failure.ticket ? 'pending' : failure.resumable ? 'failed' : 'unknown');
        expect(row.externalId !== null).toBe(failure.ticket);
        expect(statuses(stopped.steps)[step.step]).toBe('stopped');
        // what was accepted is counted, what was refused or not answered is not
        const accepted = operationsOf(w.db, stopped.id).filter((each) => each.externalId !== null).length;
        expect(Object.values({ ...stopped.sent!, clipSeconds: 0 }).reduce((sum, n) => sum + n, 0)).toBe(accepted);
        // a variant that stopped on its own does not take the other one with it; a refusal of the provider stops the whole run before any picture work
        if (failure.halts) {
          expect(w.assembled).toEqual([]);
          expect(stopped.variants.map((variant) => variant.status)).toEqual(['stopped', 'stopped']);
        } else {
          expect(stopped.variants.map((variant) => variant.status)).toEqual(['done', 'stopped']);
          expect(stopped.result).toEqual({ kind: 'produce', variants: [{ video: `jobs/${stopped.id}/v1/final.mp4`, image: `jobs/${stopped.id}/v1/poster.jpg` }] });
          expect(existsSync(abs(`jobs/${stopped.id}/v1/final.mp4`))).toBe(true);
        }
        // the money: every POST was consumed (a refusal too: nothing is known to be free), the reservation of a run that may be resumed stays
        expect(budgetOf(w).consumed).toBe(unitsSent(w));
        expect(budgetOf(w).reserved).toBe(providerUnits(paidFor(w.template, 2)));
      });

      it.each(FAILURES)(`$name: the resume`, async (failure) => {
        const w = world('layering-01', metered({ variants: 2, generator: { errors: { [step.kind]: { [step.n]: failure.error() } } } }));
        const stopped = await w.handle();
        const ticket = operation(w.db, stopped.id, step.key)!.externalId;
        const ticketed = operationsOf(w.db, stopped.id).filter((row) => row.externalId !== null).length;
        const next = w.again(metered({ generator: ticket === null ? {} : { resumes: { [ticket]: {} } } }, false));
        next.run = resumeRun(w.db, w.clock, stopped.id);
        const run = await next.handle(next.run);
        if (!failure.resumable) {
          // an unknown submission is settled by hand: nothing is asked, nothing is sent, the stop stays
          expect(run).toMatchObject({ state: 'stopped', reason: 'submission-unknown', missing: ZERO });
          expect(next.generator.calls).toEqual([]);
          expect(budgetOf(w)).toEqual({ reserved: providerUnits(paidFor(w.template, 2)), consumed: unitsSent(w) });
          return;
        }
        expect(run).toMatchObject({ state: 'done', reason: null, missing: null, detail: null });
        expect(run.variants.map((variant) => variant.status)).toEqual(['done', 'done']);
        expect(run.sent).toEqual(paidFor(w.template, 2));                                       // each of the 22 requests was accepted once
        expect(run.approved).toEqual(paidFor(w.template, 2));                                   // and the resume approved nothing more
        // no request twice: every row is one POST, a request that has a ticket has exactly one, and the ticket of a task that was started is asked for, never paid for again
        const rows = operationsOf(w.db, run.id);
        expect(rows.filter((row) => row.externalId !== null)).toHaveLength(22);
        expect([...w.paidCalls(), ...next.paidCalls()]).toHaveLength(rows.length);
        expect(next.generator.calls.filter((call) => call.kind === 'resume').map((call) => call.ticket)).toEqual(ticket === null ? [] : [ticket]);
        expect(next.paidCalls()).toHaveLength(22 - ticketed);                                    // exactly the requests the provider had not accepted, each POSTed once now
        expect(next.assembled.map((media) => media.n)).toEqual(failure.halts ? [1, 2] : [2]);   // the delivered variant is not rendered again
        expect(run.result).toMatchObject({ variants: [{ video: `jobs/${run.id}/v1/final.mp4` }, { video: `jobs/${run.id}/v2/final.mp4` }] });
        // done: nothing more can be spent, the reservation shrinks to what was consumed, and what was consumed is every POST of both calls
        expect(budgetOf(w)).toEqual({ reserved: unitsSent(w, next), consumed: unitsSent(w, next) });
      });
    });
  }
});

describe('failures in the picture side (edit, render): paid files are kept, a resume pays for nothing', () => {
  const ok = (media: VariantMedia): Assembled => ({ ok: true, video: `${media.dir}/final.mp4`, image: `${media.dir}/poster.jpg` });
  const FAILS: { name: string; first: (media: VariantMedia) => Assembled | Promise<Assembled>; reason: StopReason; step: 'edit' | 'render' }[] = [
    { name: 'the picture side refuses the edit', first: () => ({ ok: false, reason: 'clips-failed', detail: 'a clip does not speak its lines' }), reason: 'clips-failed', step: 'edit' },
    { name: 'the render fails', first: () => ({ ok: false, reason: 'render-failed', detail: 'the renderer ran out of time' }), reason: 'render-failed', step: 'render' },
    { name: 'the picture side throws', first: () => { throw new Error('assemble broke'); }, reason: 'engine-error', step: 'edit' },
  ];

  it.each(FAILS)('$name: variant 1 stops, variant 2 is delivered, and the resume assembles variant 1 alone without one paid request', async (fail) => {
    const w = world('layering-01', { variants: 2, assemble: (media) => (media.n === 1 ? fail.first(media) : ok(media)) });
    const stopped = await w.handle();
    expect(stopped).toMatchObject({ state: 'stopped', reason: fail.reason, missing: ZERO, sent: paidFor(w.template, 2) });
    expect(stopped.variants.map((variant) => [variant.n, variant.status])).toEqual([[1, 'stopped'], [2, 'done']]);
    expect(stopped.result).toEqual({ kind: 'produce', variants: [{ video: `jobs/${stopped.id}/v2/final.mp4`, image: `jobs/${stopped.id}/v2/poster.jpg` }] });   // the finished variant is delivered although the run stopped
    expect(statuses(stopped.steps)).toMatchObject({ images: 'done', clips: 'done', music: 'done', [fail.step]: 'stopped' });
    expect(keysOf(w, 'done')).toHaveLength(22);                                                                // every paid file is kept
    expect(existsSync(abs(`jobs/${stopped.id}/v1/final.mp4`))).toBe(false);

    const next = w.again();
    next.run = resumeRun(w.db, w.clock, stopped.id);
    const run = await next.handle(next.run);
    expect(run).toMatchObject({ state: 'done', reason: null, missing: null, detail: null, sent: paidFor(w.template, 2), approved: paidFor(w.template, 2) });
    expect(next.generator.calls).toEqual([]);                                                                  // nothing was asked of the provider, nothing paid
    expect(next.llm.calls).toEqual([]);
    expect(next.assembled.map((media) => media.n)).toEqual([1]);                                               // the delivered variant is not made again
    expect(run.result).toMatchObject({ variants: [{ video: `jobs/${run.id}/v1/final.mp4` }, { video: `jobs/${run.id}/v2/final.mp4` }] });
    expect(counts(run.steps)).toEqual({ adaptation: '2/2', images: '10/10', clips: '10/10', music: '2/2', edit: '2/2', render: '2/2' });
  });

  it('a variant that stops again on every resume stops each time with the same reason, and no resume pays for anything', async () => {
    const failing = (media: VariantMedia): Assembled => (media.n === 1 ? { ok: false, reason: 'render-failed' } : ok(media));
    let w = world('layering-01', { variants: 2, assemble: failing });
    let run = await w.handle();
    for (let i = 0; i < 3; i += 1) {
      w = w.again({ assemble: failing }); w.run = resumeRun(w.db, w.clock, run.id);
      run = await w.handle(w.run);
      expect(run).toMatchObject({ state: 'stopped', reason: 'render-failed', missing: ZERO, sent: paidFor(w.template, 2), approved: paidFor(w.template, 2) });
      expect(w.generator.calls).toEqual([]);
      expect(w.assembled.map((media) => media.n)).toEqual([1]);
    }
  });
});

// The same lifecycle through the worker loop: the run is queued, the loop claims it, the handler runs `asOwner`, the site's resume queues it again.
describe('through the worker loop: stop → resume → done', () => {
  const idle = async () => {};
  async function settled(w: World, id: string): Promise<RunRow> {
    const worker = runWorker({ db: w.db, clock: w.clock, workerId: 'worker-loop', idleMs: 5, health: async () => ({ provider: 'fake', renderer: 'ready', note: null }),
      handlers: { produce: w.handler, scan: idle, prepare: idle, edit: idle } });
    try {
      for (const end = Date.now() + 10_000; Date.now() < end;) {
        const state = getRun(w.db, id)!.state;
        if (state !== 'queued' && state !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } finally { await worker.stop(); }
    return getRun(w.db, id)!;
  }
  /** What the site does on "Try again" (here with nothing more to approve), and what queues the first run: no claim, the worker's loop claims it. */
  const queueAgain = (w: World, id: string) => w.db.prepare("UPDATE runs SET state = 'queued', claimed_by = NULL, heartbeat = NULL WHERE id = ?").run(id);

  it.each([
    { name: 'HTTP 402 at a clip', generator: { errors: { clip: { 3: new GeneratorError('rejected', 'POST was refused: HTTP 402: Insufficient credits', null, 402) } } }, detail: 'provider-credits' },
    { name: 'a clip task that never finishes', generator: { errors: { clip: { 3: 'timeout' as GeneratorErrorCode } } }, detail: null },
    { name: 'a music file that cannot be fetched', generator: { errors: { music: { 1: 'download-failed' as GeneratorErrorCode } } }, detail: null },
  ])('$name: the loop stops the run with its reason, the resume finishes it, no request is paid twice', async ({ generator, detail }) => {
    const w = world('layering-01', { generator });
    queueAgain(w, w.run.id);
    const stopped = await settled(w, w.run.id);
    expect(stopped).toMatchObject({ state: 'stopped', detail, claimedBy: 'worker-loop', missing: ZERO });
    expect(stopped.reason).not.toBeNull();
    const ticket = operationsOf(w.db, stopped.id).find((row) => row.state === 'pending')?.externalId ?? null;
    const next = w.again({ generator: ticket === null ? {} : { resumes: { [ticket]: {} } } });
    queueAgain(next, stopped.id);
    const run = await settled(next, stopped.id);
    expect(run).toMatchObject({ state: 'done', reason: null, detail: null, missing: null, sent: paidFor(w.template, 1) });
    expect(operationsOf(w.db, run.id).filter((row) => row.externalId !== null)).toHaveLength(11);               // 5 images, 5 clips, 1 music: each accepted once
    expect([...w.paidCalls(), ...next.paidCalls()]).toHaveLength(operationsOf(w.db, run.id).length);            // and every POST is a row
  });
});

// Several runs at once: every paid request of every run takes a place of one gate, around the request and never inside it.
describe('the gate the runs of a worker share', () => {
  const noTicket = (w: World) => operationsOf(w.db, w.run.id).filter((row) => row.state === 'pending' && row.externalId === null).length;
  const asTheWorkerBuildsIt = (size: number) => waitLogged(openGate(size), 'provider', () => {});

  it('a request that waits at the gate has no row yet: with a gate of 1 the only row without an answer is the request being sent', async () => {
    const open: number[] = [];
    let w: World;
    w = world('layering-01', { gate: openGate(1), generator: { onCall: () => { open.push(noTicket(w)); } } });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'done', sent: paidFor(w.template, 1) });
    expect(w.inFlight()).toBe(1);
    expect(open).toEqual(Array<number>(11).fill(1));                                         // 5 images, 5 clips, 1 music: each alone at its call
  });

  it('two runs at once: never more than the gate\'s 3 requests in flight over both, the gate goes round between them, both finish and every request is sent once', async () => {
    const gate = openGate(3);
    let a: World, b: World, most = 0, sentByAAtFirstOfB = -1;
    const seen = () => {
      most = Math.max(most, a.flying() + b.flying());
      if (sentByAAtFirstOfB < 0 && b.paidCalls().length > 0) sentByAAtFirstOfB = a.paidCalls().length;
    };
    a = world('layering-01', { gate, generator: { onCall: seen } });
    b = world('layering-01', { gate, db: a.db, generator: { onCall: seen } });
    const [first, second] = await Promise.all([a.handle(), b.handle()]);
    expect(most).toBe(3);
    expect([a.inFlight(), b.inFlight()].every((n) => n <= 3)).toBe(true);
    expect(sentByAAtFirstOfB).toBeLessThan(11);                                              // the second run did not wait for the first to end
    for (const [w, run] of [[a, first], [b, second]] as const) {
      expect(run).toMatchObject({ state: 'done', sent: paidFor(w.template, 1) });
      expect(w.paidCalls()).toHaveLength(11);
      expect(keysOf(w, 'done')).toHaveLength(11);
      expect(w.offRun).toEqual([]);
    }
    expect(new Set([...a.paidCalls(), ...b.paidCalls()].map((call) => call.to)).size).toBe(22);   // no file was asked for twice
  });

  it('a run that stops while its requests wait at the gate sends none of them: an unknown answer is followed by nothing, and what waited left no row', async () => {
    const w = world('layering-01', { gate: asTheWorkerBuildsIt(1), generator: { errors: { image: { 1: 'submission-unknown' } } } });
    const run = await w.handle();
    expect(run).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    expect(w.paidCalls().map((call) => `${call.kind}-${call.n}`)).toEqual(['image-1']);
    expect(operationsOf(w.db, run.id).map((row) => `${row.key} ${row.state}`)).toEqual(['v1:image:s1 unknown']);
    expect(w.flying()).toBe(0);
  });

  it('a request that fails for good while others of its variant wait at the gate: nothing new starts for that variant, the other variant is delivered', async () => {
    const w = world('layering-01', { variants: 2, gate: asTheWorkerBuildsIt(1), generator: { errors: { image: { 1: 'task-failed' } } } });
    const run = await w.handle();
    expect(run.variants.map((variant) => variant.status)).toEqual(['stopped', 'done']);
    expect(keysOf(w).filter((key) => key.startsWith('v1:'))).toEqual(['v1:image:s1']);       // the two that waited behind it at the gate were never sent
    expect(w.paidCalls()).toHaveLength(1 + 11);
  });

  it('the unknown answer of one run does not stop the other run of the gate, and no request of either is sent twice', async () => {
    const gate = openGate(3);
    const a = world('layering-01', { gate, generator: { errors: { clip: { 2: 'submission-unknown' } } } });
    const b = world('layering-01', { gate, db: a.db });
    const [first, second] = await Promise.all([a.handle(), b.handle()]);
    expect(first).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    expect(second).toMatchObject({ state: 'done', sent: paidFor(b.template, 1) });
    expect(b.paidCalls()).toHaveLength(11);
    const sent = [...a.paidCalls(), ...b.paidCalls()].map((call) => call.to);
    expect(new Set(sent).size).toBe(sent.length);
    expect(sent).toHaveLength(operationsOf(a.db, first.id).length + operationsOf(b.db, second.id).length);   // every request is a row, every row one request
  });

  it('through the worker loop: a run whose requests wait at the gate keeps its beat for minutes, is not there for another worker to take, and finishes when the gate opens', async () => {
    const gate = openGate(1);
    let free!: () => void;
    const taken = gate(() => new Promise<void>((resolve) => { free = resolve; }));           // another run holds the only place
    let asked = 0;
    const w = world('layering-01', { gate: (call) => { asked += 1; return gate(call); } });
    w.db.prepare("UPDATE runs SET state = 'queued', claimed_by = NULL, heartbeat = NULL WHERE id = ?").run(w.run.id);
    const idle = async () => {};
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const worker = runWorker({ db: w.db, clock: w.clock, workerId: 'worker-loop', idleMs: 5, health: async () => ({ provider: 'fake', renderer: 'ready', note: null }),
      handlers: { produce: w.handler, scan: idle, prepare: idle, edit: idle } });
    try {
      for (let i = 0; i < 200 && asked < 3; i += 1) await tick();
      expect(asked).toBe(3);                                                                 // the run's pool of 3 stands at the gate
      for (let beat = 0; beat < 20; beat += 1) { w.clock.advance(15_000); await vi.advanceTimersByTimeAsync(15_000); }   // five minutes
      const waiting = getRun(w.db, w.run.id)!;
      expect(waiting).toMatchObject({ state: 'running', claimedBy: 'worker-loop', takeovers: 0, heartbeat: w.clock.now().toISOString() });
      expect(claim(w.db, 'worker-other', w.clock.now())).toBeNull();
      expect(w.paidCalls()).toEqual([]);
      expect(operationsOf(w.db, w.run.id)).toEqual([]);                                      // nothing written, nothing to settle if the worker died here
      free(); await taken;
      for (let i = 0; i < 2000 && getRun(w.db, w.run.id)!.state === 'running'; i += 1) await tick();
    } finally { await worker.stop(); vi.useRealTimers(); }
    expect(getRun(w.db, w.run.id)).toMatchObject({ state: 'done', claimedBy: 'worker-loop', takeovers: 0, sent: paidFor(w.template, 1) });
    expect(w.paidCalls()).toHaveLength(11);
  });

  it('another worker takes the run over while its requests wait at the gate: none of them is sent', async () => {
    const w = world('layering-01', { gate: openGate(1), generator: { onCall: (call) => {
      if (call.kind === 'image' && call.n === 1) w.db.prepare(`UPDATE runs SET claimed_by = 'worker-2' WHERE id = ?`).run(w.run.id);
    } } });
    const run = await w.handle();
    expect(w.paidCalls().map((call) => `${call.kind}-${call.n}`)).toEqual(['image-1']);
    expect(run).toMatchObject({ state: 'running', claimedBy: 'worker-2', reason: null });
    expect(operationsOf(w.db, run.id).map((row) => `${row.key} ${row.state}`)).toEqual(['v1:image:s1 done']);
  });
});
