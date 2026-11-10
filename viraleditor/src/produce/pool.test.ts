import { describe, expect, it } from 'vitest';
import { createPool } from './pool.ts';

/** A promise and the function that settles it. */
function gate<T>() {
  let open!: (value: T) => void, fail!: (error: Error) => void;
  const done = new Promise<T>((resolve, reject) => { open = resolve; fail = reject; });
  return { done, open, fail };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('pool', () => {
  it('runs at most `limit` tasks at a time, in the order they came', async () => {
    const pool = createPool(3);
    const gates = Array.from({ length: 7 }, () => gate<number>());
    const started: number[] = [];
    const results = gates.map((g, i) => pool.run(() => { started.push(i); return g.done; }));
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[1]!.open(11);
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    gates[0]!.open(10); gates[2]!.open(12);
    await tick();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    for (const [i, g] of gates.entries()) g.open(10 + i);
    expect(await Promise.all(results)).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('a task that fails frees its place and rejects only its own promise', async () => {
    const pool = createPool(1);
    const first = pool.run(async () => { throw new Error('no'); });
    const second = pool.run(async () => 'yes');
    await expect(first).rejects.toThrow('no');
    expect(await second).toBe('yes');
  });

  it('a task that throws before it returns a promise is a rejection too', async () => {
    const pool = createPool(1);
    await expect(pool.run((() => { throw new Error('early'); }) as () => Promise<never>)).rejects.toThrow('early');
    expect(await pool.run(async () => 1)).toBe(1);
  });
});
