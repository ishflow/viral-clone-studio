import { describe, expect, it } from 'vitest';
import { createLimiter, LIMITS, rulesFor } from './rate-limit';

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
};
const rule = (key: string, max = 3, windowMs = 60_000) => ({ key, max, windowMs });

describe('createLimiter', () => {
  it('lets `max` attempts through and refuses the next one', () => {
    const c = clock();
    const limiter = createLimiter(c.now);
    expect([1, 2, 3, 4].map(() => limiter.allow([rule('a')]))).toEqual([true, true, true, false]);
  });
  it('the window slides: a hit counts again only once it is older than the window', () => {
    const c = clock();
    const limiter = createLimiter(c.now);
    limiter.allow([rule('a')]);
    c.advance(30_000);
    limiter.allow([rule('a')]);
    limiter.allow([rule('a')]);
    expect(limiter.allow([rule('a')])).toBe(false);
    c.advance(30_001); // the first hit is out of the window, the other two are not
    expect(limiter.allow([rule('a')])).toBe(true);
    expect(limiter.allow([rule('a')])).toBe(false);
    c.advance(60_000);
    expect(limiter.allow([rule('a')])).toBe(true);
  });
  it('a refused attempt is not recorded, so it does not extend the lock', () => {
    const c = clock();
    const limiter = createLimiter(c.now);
    for (let i = 0; i < 3; i++) limiter.allow([rule('a')]);
    for (let i = 0; i < 20; i++) expect(limiter.allow([rule('a')])).toBe(false);
    c.advance(60_001);
    expect(limiter.allow([rule('a')])).toBe(true);
  });
  it('another key is not affected', () => {
    const limiter = createLimiter(clock().now);
    for (let i = 0; i < 3; i++) limiter.allow([rule('a')]);
    expect(limiter.allow([rule('a')])).toBe(false);
    expect(limiter.allow([rule('b')])).toBe(true);
  });
  it('rules go together: one that is full refuses the attempt and the others record nothing', () => {
    const limiter = createLimiter(clock().now);
    for (let i = 0; i < 3; i++) limiter.allow([rule('email')]);
    expect(limiter.allow([rule('key', 1), rule('email')])).toBe(false);
    expect(limiter.allow([rule('key', 1)])).toBe(true); // 'key' was not used by the refused attempt
  });
  it('the map does not grow without bound: old keys are swept, and a hard cap drops the oldest', () => {
    const c = clock();
    const limiter = createLimiter(c.now);
    for (let i = 0; i < 500; i++) limiter.allow([rule(`old-${i}`)]);
    expect(limiter.size()).toBe(500);
    c.advance(61_000);
    for (let i = 0; i < 200; i++) limiter.allow([rule(`new-${i}`)]); // 200 calls trigger a sweep
    expect(limiter.size()).toBeLessThanOrEqual(200);
    const capped = createLimiter(c.now);
    for (let i = 0; i < 10_500; i++) capped.allow([rule(`k-${i}`, 3, 3_600_000)]);
    expect(capped.size()).toBeLessThanOrEqual(10_000);
  });
  it('a pinned rule (a count of the whole site) is not dropped by the hard cap; the other keys still are, and the cap holds', () => {
    const c = clock();
    const limiter = createLimiter(c.now);
    const all = { ...rule('all', 3, 3_600_000), pinned: true };
    for (let i = 0; i < 3; i++) limiter.allow([all]);
    limiter.allow([rule('first-caller', 3, 3_600_000)]);
    for (let i = 0; i < 10_500; i++) limiter.allow([rule(`k-${i}`, 3, 3_600_000)]);
    expect(limiter.size()).toBeLessThanOrEqual(10_000);
    expect(limiter.keys()).not.toContain('first-caller');
    expect(limiter.allow([all])).toBe(false);
    c.advance(3_600_001); // its window is over: it counts from nothing again, as any key does
    expect(limiter.allow([all])).toBe(true);
  });
});

describe('rulesFor', () => {
  it('names the caller and the normalised address (trimmed, lower case); no address, no address rule', () => {
    expect(rulesFor('logIn', '1.2.3.4', '  Me@Example.COM ').map((r) => r.key)).toEqual(['logIn:key:1.2.3.4', 'logIn:email:me@example.com']);
    expect(rulesFor('logIn', '1.2.3.4').map((r) => r.key)).toEqual(['logIn:key:1.2.3.4']);
    expect(rulesFor('logIn', '1.2.3.4', 'a+tag@Example.com').map((r) => r.key)[1]).toBe('logIn:email:a@example.com');
    expect(rulesFor('signUp', 'local', 'x@y.co').map((r) => r.key)).toEqual(['signUp:key:local']);
  });
  it('carries the numbers of the brief', () => {
    expect(LIMITS.signUp.key).toEqual({ max: 5, windowMs: 3_600_000 });
    expect(LIMITS.logIn).toEqual({ key: { max: 10, windowMs: 600_000 }, email: { max: 10, windowMs: 600_000 } });
    expect(LIMITS.reset).toEqual({ key: { max: 10, windowMs: 3_600_000 }, email: { max: 3, windowMs: 600_000 } });
    expect(LIMITS.resend.email.max).toBe(3);
  });
});
