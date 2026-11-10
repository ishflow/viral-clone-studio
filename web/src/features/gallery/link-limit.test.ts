import { describe, expect, it } from 'vitest';
import { makeTemplate } from './fixtures';
import { linkRefusal, MAX_PREPARING_LINKS, MAX_PRIVATE_TEMPLATES, normalizeLink, rememberLink, resetLinkLimit, serialPerUser } from './link-limit';

const mine = (id: string, patch = {}) => makeTemplate({ id, status: 'private', ownerId: 'u1', preparation: 'ready', title: id, ...patch });

describe('normalizeLink', () => {
  it('gives one name to the same video in different link styles', () => {
    const same = ['https://youtu.be/abc123', 'https://www.youtube.com/watch?v=abc123&t=5s', 'https://m.youtube.com/watch?v=abc123', 'https://youtube.com/shorts/abc123/'];
    expect(new Set(same.map(normalizeLink)).size).toBe(1);
    expect(normalizeLink('https://www.tiktok.com/@a/video/1?is_from_webapp=1#x')).toBe(normalizeLink('https://tiktok.com/@a/video/1/'));
  });
  it('keeps different videos apart', () => {
    expect(normalizeLink('https://youtu.be/abc')).not.toBe(normalizeLink('https://youtu.be/abd'));
    expect(normalizeLink('https://www.tiktok.com/@a/video/1')).not.toBe(normalizeLink('https://www.tiktok.com/@a/video/2'));
  });
});

describe('linkRefusal', () => {
  it('lets a first link through', () => {
    resetLinkLimit();
    expect(linkRefusal('u1', 'https://youtu.be/abc', [])).toBeNull();
  });
  it('refuses the same link as an earlier one of the user, in any link style', () => {
    resetLinkLimit();
    rememberLink('u1', 'a', 'https://youtu.be/abc');
    expect(linkRefusal('u1', 'https://www.youtube.com/watch?v=abc', [mine('a')])).toBe('duplicate');
  });
  it('forgets the link of a template that is gone, and does not apply it to another user', () => {
    resetLinkLimit();
    rememberLink('u1', 'a', 'https://youtu.be/abc');
    expect(linkRefusal('u1', 'https://youtu.be/abc', [])).toBeNull();
    expect(linkRefusal('u2', 'https://youtu.be/abc', [mine('a', { ownerId: 'u2' })])).toBeNull();
  });
  it('sees a preparing template whose title is the link (the real engine before the template has a title)', () => {
    resetLinkLimit();
    expect(linkRefusal('u1', 'https://youtu.be/abc', [mine('a', { preparation: 'preparing', title: 'https://youtu.be/abc' })])).toBe('duplicate');
  });
  it(`refuses a link while ${MAX_PREPARING_LINKS} are preparing, not before`, () => {
    resetLinkLimit();
    const preparing = (n: number) => Array.from({ length: n }, (_, i) => mine(`p${i}`, { preparation: 'preparing' }));
    expect(linkRefusal('u1', 'https://youtu.be/x', preparing(MAX_PREPARING_LINKS - 1))).toBeNull();
    expect(linkRefusal('u1', 'https://youtu.be/x', preparing(MAX_PREPARING_LINKS))).toBe('too-many-preparing');
  });
  it(`refuses a link at ${MAX_PRIVATE_TEMPLATES} private templates; the catalog's published ones and other users' do not count`, () => {
    resetLinkLimit();
    const own = Array.from({ length: MAX_PRIVATE_TEMPLATES }, (_, i) => mine(`t${i}`));
    const noise = [makeTemplate({ id: 'pub', status: 'published', ownerId: null }), mine('other', { ownerId: 'u2' })];
    expect(linkRefusal('u1', 'https://youtu.be/x', [...own.slice(1), ...noise])).toBeNull();
    expect(linkRefusal('u1', 'https://youtu.be/x', [...own, ...noise])).toBe('limit');
  });
});

describe('serialPerUser', () => {
  it('runs the tasks of one user one after the other, and different users side by side', async () => {
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`${name}:end`);
    };
    await Promise.all([serialPerUser('a', task('a1', 20)), serialPerUser('a', task('a2', 1)), serialPerUser('b', task('b1', 1))]);
    expect(log.indexOf('a1:end')).toBeLessThan(log.indexOf('a2:start'));
    expect(log.indexOf('b1:start')).toBeLessThan(log.indexOf('a1:end'));
  });
  it('keeps going after a task that threw, and passes the error on', async () => {
    await expect(serialPerUser('c', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(serialPerUser('c', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('linkRefusal with a part of the video', () => {
  const part = { from: 30, to: 80 };
  it('the same link with the same range is a duplicate', () => {
    resetLinkLimit();
    rememberLink('u1', 'a', 'https://youtu.be/abc', part);
    expect(linkRefusal('u1', 'https://youtu.be/abc', [mine('a')], { ...part })).toBe('duplicate');
  });
  it('the same link with another range, or with a range after one without, is a new video', () => {
    resetLinkLimit();
    rememberLink('u1', 'a', 'https://youtu.be/abc', part);
    expect(linkRefusal('u1', 'https://youtu.be/abc', [mine('a')], { from: 90, to: 120 })).toBeNull();
    expect(linkRefusal('u1', 'https://youtu.be/abc', [mine('a')])).toBeNull();
    rememberLink('u1', 'b', 'https://youtu.be/xyz');
    expect(linkRefusal('u1', 'https://youtu.be/xyz', [mine('b')], part)).toBeNull();
  });
  it('a preparing template known only by its title does not block another part of the same link', () => {
    resetLinkLimit();
    const waiting = mine('a', { preparation: 'preparing', title: 'https://youtu.be/abc' });
    expect(linkRefusal('u1', 'https://youtu.be/abc', [waiting], part)).toBeNull();
    expect(linkRefusal('u1', 'https://youtu.be/abc', [waiting])).toBe('duplicate');
  });
});

describe('linkRefusal for a preparing template known only by its title, when its part is looked up (after a restart)', () => {
  const part = { from: 30, to: 80 };
  const waiting = mine('a', { preparation: 'preparing', title: 'https://youtu.be/abc' });
  const link = 'https://youtu.be/abc';
  it('the same link with the same part is a duplicate', () => {
    resetLinkLimit();
    expect(linkRefusal('u1', link, [waiting], { ...part }, new Map([['a', { ...part }]]))).toBe('duplicate');
  });
  it('the same link with another part is a new video', () => {
    resetLinkLimit();
    expect(linkRefusal('u1', link, [waiting], { from: 90, to: 120 }, new Map([['a', part]]))).toBeNull();
  });
  it('a part after a whole video, or a whole video after a part, is a new video; a whole video after a whole video is a duplicate', () => {
    resetLinkLimit();
    expect(linkRefusal('u1', link, [waiting], part, new Map([['a', null]]))).toBeNull();
    expect(linkRefusal('u1', link, [waiting], undefined, new Map([['a', part]]))).toBeNull();
    expect(linkRefusal('u1', link, [waiting], undefined, new Map([['a', null]]))).toBe('duplicate');
  });
  it('a template whose part is not looked up keeps the old rule: it blocks the link when no part is picked, not another part', () => {
    resetLinkLimit();
    expect(linkRefusal('u1', link, [waiting], undefined, new Map())).toBe('duplicate');
    expect(linkRefusal('u1', link, [waiting], part, new Map())).toBeNull();
  });
});
