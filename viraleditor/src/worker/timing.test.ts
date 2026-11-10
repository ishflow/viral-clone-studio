import { describe, expect, it } from 'vitest';
import { timed } from './timing.ts';

const lines = (): { out: string[]; log: (line: string) => void } => { const out: string[] = []; return { out, log: (line) => { out.push(line); } }; };

describe('timed', () => {
  it('writes one stage line with the port and method name and the milliseconds a call took', async () => {
    const { out, log } = lines();
    let now = 1000;
    const port = timed('media', { probe: async (file: string) => { now += 250; return file.length; } }, log, () => now);
    expect(await port.probe('a.mp4')).toBe(5);
    expect(out).toEqual(['stage=media.probe ms=250']);
  });

  it('writes the time of a call that throws and passes the same error on', async () => {
    const { out, log } = lines();
    let now = 0;
    const boom = new Error('no');
    const port = timed('llm', { ask: async () => { now += 40; throw boom; } }, log, () => now);
    await expect(port.ask()).rejects.toBe(boom);
    expect(out).toEqual(['stage=llm.ask ms=40']);
  });

  it('writes the time of a call that answers at once and keeps its answer', () => {
    const { out, log } = lines();
    const port = timed('renderer', { name: 'x', count: () => 3 }, log, () => 0);
    expect(port.name).toBe('x');
    expect(port.count()).toBe(3);
    expect(out).toEqual(['stage=renderer.count ms=0']);
  });

  it('keeps `this` of the port and writes nothing about the arguments or answers', async () => {
    const { out, log } = lines();
    const port = timed('downloader', { secret: 'https://x.test/?key=1', get() { return Promise.resolve(this.secret); } }, log, () => 0);
    expect(await port.get()).toBe('https://x.test/?key=1');
    expect(out.join('')).not.toContain('key');
  });
});
