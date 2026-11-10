import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeClock, FakeRenderer } from '../adapters/fakes.ts';
import { openDb } from '../db/open.ts';
import { buildParts } from './parts.ts';
import { gated, gateSize, gateSizeOr, openGate, waitLogged } from './gate.ts';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

describe('openGate', () => {
  it('lets at most 2 of 6 simultaneous calls inside, and all 6 finish', async () => {
    const gate = openGate(2);
    let inside = 0, most = 0, done = 0;
    await Promise.all(Array.from({ length: 6 }, () => gate(async () => {
      inside += 1; most = Math.max(most, inside);
      await tick(); await tick();
      inside -= 1; done += 1;
    })));
    expect(most).toBe(2);
    expect(done).toBe(6);
  });

  it('keeps the order of the calls', async () => {
    const gate = openGate(1);
    const started: number[] = [];
    await Promise.all([0, 1, 2, 3, 4].map((i) => gate(async () => { started.push(i); await tick(); })));
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not stay shut after a call throws, and passes the same error on', async () => {
    const gate = openGate(1);
    const boom = new Error('no');
    await expect(gate(async () => { throw boom; })).rejects.toBe(boom);
    await expect(gate(() => { throw boom; })).rejects.toBe(boom);
    await expect(gate(async () => 'ok')).resolves.toBe('ok');
  });

  it('refuses a size that is not a whole number of at least 1', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => openGate(bad)).toThrow();
  });
});

describe('gated', () => {
  it('gates only the named methods and leaves the rest and the answers alone', async () => {
    const gate = openGate(1);
    let inside = 0, most = 0;
    const port = gated({
      heavy: async (n: number) => { inside += 1; most = Math.max(most, inside); await tick(); inside -= 1; return n * 2; },
      light: (n: number) => n + 1,
      name: 'x',
    }, { heavy: gate });
    expect(port.name).toBe('x');
    expect(port.light(1)).toBe(2);
    expect(await Promise.all([port.heavy(1), port.heavy(2), port.heavy(3)])).toEqual([2, 4, 6]);
    expect(most).toBe(1);
  });

  it('keeps this for the port', async () => {
    const port = gated({ n: 7, heavy(this: { n: number }) { return Promise.resolve(this.n); } }, { heavy: openGate(1) });
    expect(await port.heavy()).toBe(7);
  });
});

describe('gated: the wait is written down (K4)', () => {
  it('a call that had to wait says so with its wait in ms, a call that went straight in says nothing, and no argument is written', async () => {
    let t = 1000; const lines: string[] = [];
    let open!: () => void; const hold = new Promise<void>((r) => { open = r; });
    const port = gated({ check: async (what: string) => { if (what === 'first') await hold; return what; } }, { check: openGate(1) }, 'renderer', (l) => lines.push(l), () => t);
    const first = port.check('first');
    const second = port.check('secret-second');
    await tick();
    expect(lines).toEqual([]);                          // nobody has waited out yet
    t += 250;
    open();
    expect(await Promise.all([first, second])).toEqual(['first', 'secret-second']);
    expect(lines).toEqual(['stage=gate.renderer.check wait_ms=250']);
  });

  it('without a name the line carries the method alone', async () => {
    let t = 0; const lines: string[] = [];
    let open!: () => void; const hold = new Promise<void>((r) => { open = r; });
    const port = gated({ words: async (n: number) => { if (n === 1) await hold; return n; } }, { words: openGate(1) }, undefined, (l) => lines.push(l), () => t);
    const calls = [port.words(1), port.words(2)];
    t += 40; open(); await Promise.all(calls);
    expect(lines).toEqual(['stage=gate.words wait_ms=40']);
  });
});

describe('waitLogged: a gate that is no port method writes its wait the same way', () => {
  it('a call that had to wait says so under the gate\'s name, a call that went straight in says nothing', async () => {
    let t = 500; const lines: string[] = [];
    let open!: () => void; const hold = new Promise<void>((r) => { open = r; });
    const gate = waitLogged(openGate(1), 'provider', (l) => lines.push(l), () => t);
    const first = gate(async () => { await hold; return 'first'; });
    const second = gate(async () => 'second');
    await tick();
    expect(lines).toEqual([]);
    t += 1200;
    open();
    expect(await Promise.all([first, second])).toEqual(['first', 'second']);
    expect(lines).toEqual(['stage=gate.provider wait_ms=1200']);
  });

  it('lets in as many as the gate it wraps, and passes an error on as it is', async () => {
    const gate = waitLogged(openGate(2), 'provider', () => {});
    let inside = 0, most = 0;
    await Promise.all(Array.from({ length: 5 }, () => gate(async () => { inside += 1; most = Math.max(most, inside); await tick(); inside -= 1; })));
    expect(most).toBe(2);
    const boom = new Error('no');
    await expect(gate(async () => { throw boom; })).rejects.toBe(boom);
  });
});

describe('gateSizeOr: a gate with its own default and its own ceiling', () => {
  it('is the default when the variable is not set or is empty, whatever the machine', () => {
    expect(gateSizeOr({}, 'VC_GATE_PROVIDER', 3, 12)).toBe(3);
    expect(gateSizeOr({ VC_GATE_PROVIDER: '' }, 'VC_GATE_PROVIDER', 3, 12)).toBe(3);
    expect(gateSizeOr({}, 'VC_GATE_RENDER', 1, 4)).toBe(1);
  });
  it('is the asked number from 1 to the ceiling', () => {
    expect(gateSizeOr({ VC_GATE_PROVIDER: '1' }, 'VC_GATE_PROVIDER', 3, 12)).toBe(1);
    expect(gateSizeOr({ VC_GATE_PROVIDER: '12' }, 'VC_GATE_PROVIDER', 3, 12)).toBe(12);
    expect(gateSizeOr({ VC_GATE_RENDER: '4' }, 'VC_GATE_RENDER', 1, 4)).toBe(4);
  });
  it.each(['0', '13', '-1', '1.5', 'abc', '1e1', ' 2 ', '04', '+3'])('%j is refused, naming the variable and what it may be', (raw) => {
    expect(() => gateSizeOr({ VC_GATE_PROVIDER: raw }, 'VC_GATE_PROVIDER', 3, 12)).toThrow(`VC_GATE_PROVIDER must be a whole number from 1 to 12, got "${raw}"`);
  });
  it('the ceiling is the gate\'s own: 5 renders are refused where 5 provider requests are not', () => {
    expect(() => gateSizeOr({ VC_GATE_RENDER: '5' }, 'VC_GATE_RENDER', 1, 4)).toThrow('VC_GATE_RENDER must be a whole number from 1 to 4, got "5"');
    expect(gateSizeOr({ VC_GATE_PROVIDER: '5' }, 'VC_GATE_PROVIDER', 3, 12)).toBe(5);
  });
});

describe('gateSize', () => {
  it('is the asked number when the variable is set', () => {
    expect(gateSize({ VC_GATE_CHROME: '3' }, 'VC_GATE_CHROME', 10)).toBe(3);
  });
  it('is a quarter of the cores, at least 1, when it is not set', () => {
    expect(gateSize({}, 'VC_GATE_CHROME', 10)).toBe(2);
    expect(gateSize({ VC_GATE_CHROME: '' }, 'VC_GATE_CHROME', 16)).toBe(4);
    expect(gateSize({}, 'VC_GATE_CHROME', 2)).toBe(1);
  });
  it('refuses a value that is not a whole number of at least 1', () => {
    for (const bad of ['0', '-2', '1.5', 'abc']) expect(() => gateSize({ VC_GATE_CHROME: bad }, 'VC_GATE_CHROME', 8)).toThrow(/VC_GATE_CHROME/);
  });
  it.each(['1e1', '1e3', ' 2 ', '2 ', '04', '+3', '0x4', '17', '400'])('%j is refused as strictly as VC_WORKER_PREPARE would (K6)', (raw) => {
    expect(() => gateSize({ VC_GATE_CHROME: raw }, 'VC_GATE_CHROME', 8)).toThrow(`VC_GATE_CHROME must be a whole number from 1 to 16, got "${raw}"`);
  });
  it('1 and 16 are the ends of what is accepted (K6)', () => {
    expect(gateSize({ VC_GATE_CHROME: '1' }, 'VC_GATE_CHROME', 8)).toBe(1);
    expect(gateSize({ VC_GATE_CHROME: '16' }, 'VC_GATE_CHROME', 8)).toBe(16);
  });
});

describe('the gates of the worker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vc-gate-'));
  const build = (env: Record<string, string>) => buildParts({ VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up', ...env }, openDb(join(dir, 'db.sqlite')), new FakeClock('2026-10-04T10:00:00.000Z'), { renderer: new FakeRenderer({ ready: { ready: true, note: null } }) });

  it('start with no setting at all, and with a good one', () => {
    expect(() => build({})).not.toThrow();
    expect(() => build({ VC_GATE_TRANSCRIBE: '2', VC_GATE_CHROME: '3' })).not.toThrow();
  });

  it('name the variable when its value is not usable', () => {
    for (const name of ['VC_GATE_TRANSCRIBE', 'VC_GATE_CHROME']) expect(() => build({ [name]: '0' })).toThrow(name);
  });
});
