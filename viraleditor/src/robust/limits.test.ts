// C6 case 7: every child an adapter starts ends when its limit passes, and a tool that floods its output does not take this process down.
// The tools are fakes that sleep (their pid in a file). media and measure have a fixed 10 min limit: the clock is faked for them.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureTimeline } from '../adapters/fixtures/composition.ts';
import { createMeasure } from '../adapters/measure.ts';
import { MediaError, createMedia } from '../adapters/media.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { createTranscriber } from '../adapters/transcriber.ts';
import { RenderError } from '../ports.ts';

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Polls `check` for up to `ms` of real time; setImmediate and Date.now are never faked here (only setTimeout / clearTimeout are), so it works under the fake clock too. */
async function spin(check: () => boolean, ms = 30_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return true; await new Promise<void>((r) => setImmediate(r)); }
  return check();
}

/** A tool that writes its pid (and the pid of a child it starts, `sleep`) and then sleeps. */
function sleeper() {
  const dir = mkdtempSync(join(tmpdir(), 've-robust-limit-'));
  const pids = join(dir, 'pids');
  const bin = join(dir, 'tool');
  writeFileSync(bin, `#!/bin/sh\nsleep 60 &\necho "$$ $!" > '${pids}'\nwait\n`);
  chmodSync(bin, 0o755);
  const read = (): number[] => (existsSync(pids) ? readFileSync(pids, 'utf8').trim().split(' ').filter(Boolean).map(Number) : []);
  return { dir, bin, read, started: () => read().length === 2 };
}
/** Ends what a test started and is still there; returns those pids. */
function reap(pids: number[]): number[] {
  const left = pids.filter(alive);
  for (const pid of left) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  return left;
}

describe('every child an adapter starts ends at its limit (C6 case 7)', () => {
  afterEach(() => { vi.useRealTimers(); });

  const tenMinutes = async (s: ReturnType<typeof sleeper>, work: () => Promise<unknown>) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = work().then(() => null, (e: unknown) => e);
    try {
      expect(await spin(s.started)).toBe(true);                                        // the shell started and wrote both pids (up to 30 s: slow under load)
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    } catch (e) {
      vi.useRealTimers();
      reap(s.read());                                                                   // never leave the fake behind; its faked limit would not fire
      throw e;
    }
    vi.useRealTimers();
    return result;
  };

  it('media.probe and measure.streams: the fake ffprobe is killed after 10 minutes, a MediaError tool-failed (the tool itself; its own child is not ours to see)', { timeout: 30_000 }, async () => {
    for (const run of [(bin: string, file: string) => createMedia('/opt/homebrew/bin/ffmpeg', bin).probe(file), (bin: string, file: string) => createMeasure('/opt/homebrew/bin/ffmpeg', bin).streams(file)]) {
      const s = sleeper();
      const file = join(s.dir, 'a.mp4');
      writeFileSync(file, 'x');
      try {
        const e = await tenMinutes(s, () => run(s.bin, file));
        expect(e).toBeInstanceOf(MediaError);
        expect((e as MediaError).code).toBe('tool-failed');
        const [tool] = s.read() as [number, number];
        expect(await spin(() => !alive(tool))).toBe(true);
      } finally {
        reap(s.read());                                                                 // ffprobe starts no child; the fake's `sleep` would be a leak of the fake only
      }
    }
  });

  /** A limit long enough for the fake shell to start and write both pids even under load (asserted, so the test is never vacuous). */
  const LIMIT = 5000;
  it('transcriber: at its limit the CLI and what it started are gone', { timeout: 60_000 }, async () => {
    const s = sleeper();
    try {
      const source = join(s.dir, 'source.mp4');
      writeFileSync(source, Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109, 109, 112, 52, 50]));
      const e = await createTranscriber(s.bin, { timeoutMs: LIMIT }).words(source, 'en').catch((x: unknown) => x);
      expect(e).toMatchObject({ code: 'timeout' });
      expect(s.started()).toBe(true);
      expect(await spin(() => s.read().every((pid) => !alive(pid)))).toBe(true);
    } finally {
      expect(reap(s.read())).toEqual([]);
    }
  });

  it('renderer.check and renderer.render: at their limits the CLI and what it started are gone; RenderError', { timeout: 60_000 }, async () => {
    for (const work of ['check', 'render'] as const) {
      const s = sleeper();
      const comp = mkdtempSync(join(tmpdir(), 've-robust-comp-'));
      writeFileSync(join(comp, 'timeline.json'), JSON.stringify(fixtureTimeline(null)));
      const r = createRenderer({ bin: s.bin, ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe', measure: createMeasure('/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe'), timeoutMs: LIMIT, checkTimeoutMs: LIMIT });
      try {
        const e = await (work === 'check' ? r.check(comp) : r.render(comp, join(comp, 'out', 'v.mp4'), () => {})).catch((x: unknown) => x);
        expect(e, work).toBeInstanceOf(RenderError);
        expect((e as Error).message, work).toMatch(/did not finish within 5000 ms/);
        expect(s.started(), work).toBe(true);
        expect(await spin(() => s.read().every((pid) => !alive(pid))), work).toBe(true);
      } finally {
        expect(reap(s.read()), work).toEqual([]);
      }
    }
  });

  it('a tool that floods stdout with 400 MB: media.probe ends in a MediaError tool-failed, the heap stays bounded (the cap holds 64 MB; without it this run holds 400)', { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-robust-flood-'));
    const bin = join(dir, 'ffprobe');
    writeFileSync(bin, `#!${process.execPath}\nconst b=Buffer.alloc(1<<20,120);let n=0;const w=()=>{while(n<400){n++;if(!process.stdout.write(b))return process.stdout.once('drain',w);}};w();\n`);
    chmodSync(bin, 0o755);
    writeFileSync(join(dir, 'a.mp4'), 'x');
    const before = process.memoryUsage().heapUsed;
    const e = await createMedia('/opt/homebrew/bin/ffmpeg', bin).probe(join(dir, 'a.mp4')).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 'tool-failed' });
    expect((e as Error).message).toMatch(/more than \d+ characters/);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(160 * 1024 * 1024);      // 64 MB held by the cap, 96 MB of room; the uncapped 400 MB is far above
  });
});
