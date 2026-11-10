// The engine from a queued run to a finished video (`VE_RENDER=1`): the worker is a child process, the generator is the fake one,
// the language model is scripted, HyperFrames renders for real. Nothing is requested from anyone.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { readBar } from '../adapters/framebar.ts';
import { available, decode, probe, readShot, showsExpected } from '../compose/golden-helpers.ts';
import type { Timeline } from '../edit/timeline.ts';
import { operationsOf } from './ops.ts';
import { cleanUp, endWorker, finished, logOf, makeWorld, produceInput, queue, release, runOf, startWorker, until } from './world.ts';
import type { LogLine, World } from './world.ts';

const MIN = 60_000;
const count = (log: LogLine[]) => ({ image: 0, clip: 0, music: 0, voice: 0, ...Object.fromEntries(['image', 'clip', 'music', 'voice'].map((k) => [k, log.filter((l) => l.kind === k).length])) });
const wayIn = (shot: World['template']['shots'][number]): number => (shot.in as { frames?: number } | undefined)?.frames ?? 0;

describe.skipIf(!available)('engine end to end: layering-01, fake generator, scripted model, real render', () => {
  afterEach(cleanUp);
  afterAll(cleanUp);

  it('1. a produce run finishes: exact frames, cuts on the template\'s frames, the log counts the approved requests', async () => {
    const t0 = Date.now();
    const w = await makeWorld();
    const id = queue(w, false);
    const worker = startWorker(w);
    const run = await until(`run done (worker: ${worker.output()})`, 20 * MIN, () => { const r = runOf(w, id); return finished(r) ? r : null; }, 1000);
    const say = (name: string) => { const f = join(w.dir, 'jobs', id, name); return existsSync(f) ? readFileSync(f, 'utf8') : `no ${name}`; };
    expect(run.state, `${say('stop.json')}\n${worker.output()}`).toBe('done');
    const video = join(w.dir, 'jobs', id, 'v1', 'final.mp4');
    expect(existsSync(video)).toBe(true);
    const template = w.template;
    const frames = Math.max(...template.shots.map((shot) => shot.at! + shot.for!));
    expect(probe(video)).toMatchObject({ width: 720, height: 1280, frames });

    // cuts: the frame bar of each clip, read through the frame table (as produce.render.test.ts does)
    const timeline = JSON.parse(readFileSync(join(w.dir, 'jobs', id, 'v1', 'timeline.json'), 'utf8')) as Timeline;
    const wanted = template.shots.slice(1).flatMap((shot) => Array.from({ length: wayIn(shot) + 2 }, (_, i) => shot.at! - 1 + i));
    const pictures = decode(video, template.canvas.width, template.canvas.height, wanted);
    const byTemplate: Timeline = { ...timeline, shots: timeline.shots.map((shot, i) => ({ ...shot, at: template.shots[i]!.at!, for: template.shots[i]!.for!, from: 0 })) };
    const shows = (index: number, f: number, what: string) => {
      const reading = readShot(byTemplate, pictures.get(f)!, index, f);
      expect(reading?.units ?? null, `${what}: units unreadable`).not.toBeNull();
      expect(reading?.thirties ?? null, `${what}: thirties unreadable`).not.toBeNull();
      expect(showsExpected(reading), `${what}: ${JSON.stringify(reading)}`).toBe(true);
    };
    template.shots.slice(1).forEach((shot, k) => {
      const cut = shot.at!, before = template.shots[k]!;
      shows(k, cut - 1, `${before.id} on its last frame ${cut - 1}`);
      shows(k + 1, cut + wayIn(shot), `${shot.id} on frame ${cut + wayIn(shot)}`);
    });
    const plain: [string, number, number | null][] = [];
    for (const shot of template.shots.slice(1, -1)) {
      if (shot.motion !== undefined) continue;
      for (const f of [shot.at! + wayIn(shot), shot.at! + shot.for! - 1]) {
        const p = pictures.get(f)!;
        plain.push([shot.id, f, readBar(p.rgb, p.width, p.height)]);
      }
    }
    expect(plain.every(([, f, n]) => n === f - template.shots.find((s) => s.id === plain.find((x) => x[1] === f)![0])!.at!)).toBe(true);

    const log = logOf(w);
    const need = produceInput(w).approved;
    expect(count(log)).toEqual({ image: need.images, clip: need.clips, music: need.music, voice: need.voice });
    expect(new Set(log.map((l) => l.ticket)).size).toBe(log.length);
    expect(run.sent).toEqual(need);
    console.log(`[e2e 1] frames=${frames} cuts=${template.shots.slice(1).map((s) => s.at).join(',')} log=${JSON.stringify(count(log))} seconds=${Math.round((Date.now() - t0) / 1000)}`);
  }, 25 * MIN);

  it('2a. nothing queued: the generator log stays absent or empty for 10 s', async () => {
    const w = await makeWorld();
    startWorker(w);
    await new Promise((r) => setTimeout(r, 10_000));
    expect(logOf(w)).toEqual([]);
    console.log('[e2e 2a] log lines after 10 s: 0');
  }, 2 * MIN);

  it('2b. a held run is not worked on; released, it runs', async () => {
    const w = await makeWorld();
    const id = queue(w, true);
    const worker = startWorker(w);
    await new Promise((r) => setTimeout(r, 10_000));
    expect(logOf(w)).toEqual([]);
    expect(runOf(w, id).state).toBe('held');
    release(w);
    await until(`released run asks for its first image (worker: ${worker.output()})`, 5 * MIN, () => logOf(w).length > 0, 500);
    expect(runOf(w, id).state).toBe('running');
    console.log(`[e2e 2b] held: 0 lines after 10 s; released: ${logOf(w).length}+ lines, state running`);
    await endWorker(worker);
  }, 8 * MIN);

  it('3. a killed worker loses nothing and asks for nothing twice', async () => {
    const t0 = Date.now();
    const w = await makeWorld();
    const id = queue(w, false);
    const first = startWorker(w, { VC_FAKE_DELAY_MS: '3000' });
    await until(`first clip line (worker: ${first.output()})`, 15 * MIN, () => logOf(w).some((l) => l.kind === 'clip'), 200);
    const midway = runOf(w, id);
    expect(midway.state).toBe('running');
    expect(midway.steps.find((s) => s.key === 'clips')?.status).toBe('running');
    const linesAtKill = logOf(w).length;
    first.child.kill('SIGKILL');
    await first.exited;
    const second = startWorker(w, { VC_FAKE_DELAY_MS: '500' });
    const run = await until(`run finished after takeover (worker: ${second.output()})`, 25 * MIN, () => { const r = runOf(w, id); return finished(r) ? r : null; }, 1000);
    const log = logOf(w);
    const need = produceInput(w).approved;
    // the log keeps only the first words of a prompt, so two shots can read alike: a request is one ticket, and each operation of the run is one line
    expect(new Set(log.map((l) => l.ticket)).size, 'the same ticket twice').toBe(log.length);
    expect(log.length).toBeLessThanOrEqual(need.images + need.clips + need.music + need.voice);
    const ops = operationsOf(w.db, id);
    expect(count(log), 'one log line per operation of the run, per kind').toEqual({ image: 0, clip: 0, music: 0, voice: 0, ...Object.fromEntries(['image', 'clip', 'music', 'voice'].map((k) => [k, ops.filter((o) => o.kind === k).length])) });
    console.log(`[e2e 3] killed at ${linesAtKill} lines; end state=${run.state} reason=${run.reason}; lines=${log.length}/${need.images + need.clips + need.music + need.voice}; unknown ops=${ops.filter((o) => o.state === 'unknown').length}; seconds=${Math.round((Date.now() - t0) / 1000)}`);
    expect(['done', 'stopped']).toContain(run.state);
    if (run.state === 'stopped') expect(run.reason).toBe('submission-unknown');
  }, 40 * MIN);
});
