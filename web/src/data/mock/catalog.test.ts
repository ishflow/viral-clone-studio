// @vitest-environment node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { NotFoundError } from '../ports';
import { getStore, resetStore } from './store';

const LINK = 'https://www.tiktok.com/@someone/video/1';
const titles = (templates: { title: string }[]) => templates.map((template) => template.title);
const ids = (templates: { id: string }[]) => templates.map((template) => template.id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('the templates of the gallery', () => {
  it('supplies reference likes and admits unknown shot counts without inventing them', async () => {
    expect((await data.catalog.get('tpl-layering'))?.referenceLikes).toBe('10.1%');
    expect(await data.catalog.checkSource('usr-demo', { kind: 'link', url: LINK }))
      .toEqual({ ok: true, seconds: null, format: null, shots: null });
  });

  it('holds the six templates of the canvas, word for word', async () => {
    const templates = await data.catalog.list({});
    expect(templates.map(({ id, title, category, format, seconds, referenceViews }) => [id, title, category, format, seconds, referenceViews])).toEqual([
      ['tpl-layering', 'Fragrance layering recipe', 'Fragrance', 'no-talking', 8, '1.9M'],
      ['tpl-eye', 'Eye close-up with a day counter', 'Lashes', 'no-talking', 13, '19.8M'],
      ['tpl-story', '"I tried it for 4 weeks" presenter story', 'Lashes', 'talking', 30, '8.9M'],
      ['tpl-stop', 'Dupe comparison', 'Fragrance', 'no-talking', 17, '1.9M'],
      ['tpl-shower', 'Shower routine: problem, result, how to use', 'Hair', 'no-talking', 15, '12.7M'],
      ['tpl-refused', '"I refused to accept it" story and routine', 'Hair', 'no-talking', 9, '17.1M'],
    ]);
    expect(templates.every((template) => template.preparation === null && template.preparationNote === null)).toBe(true);
  });

  it('every published template has a description of its structure and at most one tag', async () => {
    const allowed = ['Hands and product', 'Face close-up', 'Presenter', 'On-screen text'];
    const templates = await data.catalog.list({});
    for (const template of templates) {
      expect(template.description.trim()).not.toBe('');
      expect(template.description).not.toMatch(/\d/);
      expect(template.tags.length).toBeLessThanOrEqual(1);
      expect(template.tags.every((tag) => allowed.includes(tag))).toBe(true);
    }
    expect(templates[0]).toMatchObject({
      id: 'tpl-layering',
      description: 'First the products side by side with the hook text in the middle. Then, on every beat, one product in hand with a small label. No face, no talking, just music.',
      tags: ['Hands and product'],
    });
  });

  it('every template has 5 shots that divide its length evenly', async () => {
    for (const template of await data.catalog.list({})) {
      expect(template.shots.map((shot) => shot.n)).toEqual([1, 2, 3, 4, 5]);
      const length = template.seconds / 5;
      template.shots.forEach((shot, index) => {
        expect(shot.from).toBeCloseTo(index * length, 5);
        expect(shot.to).toBeCloseTo((index + 1) * length, 5);
        expect(shot.action).not.toBe('');
        expect(shot.product === null || (shot.product >= 1 && shot.product <= template.products)).toBe(true);
      });
      expect(template.shots[0]?.from).toBe(0);
      expect(template.shots[4]?.to).toBe(template.seconds);
    }
  });

  it('the sample media of every template is in public/samples; two templates have a video', async () => {
    const templates = await data.catalog.list({});
    for (const template of templates) {
      expect(template.image).toMatch(/^\/samples\/[0-9a-f]{32}\.jpg$/);
      expect(existsSync(join(process.cwd(), 'public', template.image))).toBe(true);
      if (template.video) expect(existsSync(join(process.cwd(), 'public', template.video))).toBe(true);
    }
    expect(Object.fromEntries(templates.map((template) => [template.id, template.video]))).toEqual({
      'tpl-layering': '/samples/layering.mp4', 'tpl-eye': null, 'tpl-story': '/samples/lashly.mp4',
      'tpl-stop': null, 'tpl-shower': null, 'tpl-refused': null,
    });
  });

  it('list without viewer returns only published', async () => {
    await data.catalog.addFromLink('usr-demo', LINK);
    await data.admin.updateTemplate('tpl-eye', { status: 'hidden' });
    await data.admin.updateTemplate('tpl-shower', { status: 'waiting' });
    const templates = await data.catalog.list({});
    expect(templates).toHaveLength(4);
    expect(templates.every((template) => template.status === 'published')).toBe(true);
  });

  it('with viewerId also that viewer\'s private templates', async () => {
    const mine = await data.catalog.addFromLink('usr-paying', LINK);
    await data.catalog.addFromLink('usr-free', LINK);
    const templates = await data.catalog.list({ viewerId: 'usr-paying' });
    expect(templates).toHaveLength(7);
    expect(ids(templates.filter((template) => template.status === 'private'))).toEqual([mine.id]);
    expect(ids(await data.catalog.list({ viewerId: 'usr-demo' })).slice(6)).toEqual(['tpl-own-ready', 'tpl-own-failed']);
    expect(await data.catalog.list({ viewerId: 'usr-new' })).toHaveLength(6);
  });

  it('search matches title and category case-insensitively', async () => {
    expect(titles(await data.catalog.list({ search: 'DUPE' }))).toEqual(['Dupe comparison']);
    expect(titles(await data.catalog.list({ search: 'fragrance' }))).toEqual(['Fragrance layering recipe', 'Dupe comparison']);
    expect(titles(await data.catalog.list({ search: 'hair' }))).toEqual(['Shower routine: problem, result, how to use', '"I refused to accept it" story and routine']);
    expect(titles(await data.catalog.list({ search: '  routine ' }))).toHaveLength(2);
    expect(await data.catalog.list({ search: 'no such template' })).toEqual([]);
  });

  it('search also matches the description, case-insensitively', async () => {
    expect(titles(await data.catalog.list({ search: 'JUST MUSIC' }))).toEqual(['Fragrance layering recipe']);
    expect(titles(await data.catalog.list({ search: 'speaks to the camera' }))).toEqual(['"I tried it for 4 weeks" presenter story']);
    await data.admin.updateTemplate('tpl-eye', { description: 'A quiet morning scene.' });
    expect(titles(await data.catalog.list({ search: 'quiet MORNING' }))).toEqual(['Eye close-up with a day counter']);
  });

  it('filters by category and by format, together with the search', async () => {
    expect(titles(await data.catalog.list({ category: 'Lashes' }))).toEqual(['Eye close-up with a day counter', '"I tried it for 4 weeks" presenter story']);
    expect(titles(await data.catalog.list({ format: 'talking' }))).toEqual(['"I tried it for 4 weeks" presenter story']);
    expect(titles(await data.catalog.list({ category: 'Lashes', format: 'no-talking', search: 'eye' }))).toEqual(['Eye close-up with a day counter']);
    expect(await data.catalog.list({ category: 'Hair', format: 'talking' })).toEqual([]);
  });

  it('categories lists the categories of the published templates', async () => {
    expect(await data.catalog.categories()).toEqual(['Fragrance', 'Lashes', 'Hair']);
    await data.admin.updateTemplate('tpl-shower', { status: 'hidden' });
    await data.admin.updateTemplate('tpl-refused', { status: 'hidden' });
    expect(await data.catalog.categories()).toEqual(['Fragrance', 'Lashes']);
  });

  it('a template published without a category adds no empty category', async () => {
    const waiting = await data.admin.prepareCandidate('cand-3');
    expect(waiting.category).toBe('');
    await data.admin.updateTemplate(waiting.id, { status: 'published' });
    expect(await data.catalog.categories()).toEqual(['Fragrance', 'Lashes', 'Hair']);
  });

  it('get returns a published template to anyone', async () => {
    expect((await data.catalog.get('tpl-layering'))?.title).toBe('Fragrance layering recipe');
    expect((await data.catalog.get('tpl-layering', 'usr-new'))?.products).toBe(4);
    expect(await data.catalog.get('tpl-missing')).toBeNull();
  });

  it('get of a hidden or waiting template is null', async () => {
    await data.admin.updateTemplate('tpl-eye', { status: 'hidden' });
    await data.admin.updateTemplate('tpl-shower', { status: 'waiting' });
    expect(await data.catalog.get('tpl-eye', 'usr-demo')).toBeNull();
    expect(await data.catalog.get('tpl-shower')).toBeNull();
  });

  it('hands out copies, so a caller cannot change the catalog', async () => {
    const template = await data.catalog.get('tpl-layering');
    if (template) {
      template.status = 'hidden';
      template.shots.pop();
      template.tags.push('Changed');
    }
    const stored = getStore().templates.find((item) => item.id === 'tpl-layering');
    expect(stored).toMatchObject({ status: 'published', tags: ['Hands and product'] });
    expect(stored?.shots).toHaveLength(5);
  });
});

describe('a user\'s own templates', () => {
  it('get of another user\'s private template is null', async () => {
    const mine = await data.catalog.addFromLink('usr-demo', LINK);
    expect((await data.catalog.get(mine.id, 'usr-demo'))?.id).toBe(mine.id);
    expect(await data.catalog.get(mine.id, 'usr-paying')).toBeNull();
    expect(await data.catalog.get(mine.id, 'usr-admin')).toBeNull();
    expect(await data.catalog.get(mine.id)).toBeNull();
    expect(await data.catalog.get('tpl-own-ready', 'usr-paying')).toBeNull();
  });

  it('addFromLink creates a private template that belongs to the owner and is being prepared', async () => {
    const template = await data.catalog.addFromLink('usr-demo', LINK);
    expect(template).toMatchObject({
      status: 'private', ownerId: 'usr-demo', source: 'link', video: null, timesGenerated: 0, editedAt: '2026-10-04T12:00:00.000Z',
      preparation: 'preparing', preparationNote: null, description: '', tags: [],
    });
    const again = await data.catalog.addFromLink('usr-demo', LINK);
    expect(again.id).not.toBe(template.id);
    await expect(data.catalog.addFromLink('nobody', LINK)).rejects.toThrow(NotFoundError);
  });

  it('a template that is being prepared turns ready after 20 s, on any read', async () => {
    const first = await data.catalog.addFromLink('usr-demo', LINK);
    const second = await data.catalog.addFromLink('usr-demo', LINK);
    const third = await data.catalog.addFromLink('usr-demo', LINK);
    vi.advanceTimersByTime(19_999);
    expect((await data.catalog.get(first.id, 'usr-demo'))?.preparation).toBe('preparing');
    vi.advanceTimersByTime(1);
    expect(await data.catalog.get(first.id, 'usr-demo')).toMatchObject({ preparation: 'ready', preparationNote: null, editedAt: first.editedAt });
    expect((await data.catalog.list({ viewerId: 'usr-demo' })).find((template) => template.id === second.id)?.preparation).toBe('ready');
    expect((await data.admin.template(third.id))?.preparation).toBe('ready');
    expect(first.shots).toHaveLength(5);
    expect(first.shots[4]?.to).toBe(first.seconds);
  });

  it('VC_FAKE_SPEED also speeds up the preparation', async () => {
    vi.stubEnv('VC_FAKE_SPEED', '20');
    const template = await data.catalog.addFromLink('usr-demo', LINK);
    vi.advanceTimersByTime(999);
    expect((await data.catalog.get(template.id, 'usr-demo'))?.preparation).toBe('preparing');
    vi.advanceTimersByTime(1);
    expect((await data.catalog.get(template.id, 'usr-demo'))?.preparation).toBe('ready');
  });

  it('the fixtures give usr-demo one ready template and one that did not fit', async () => {
    expect(await data.catalog.get('tpl-own-ready', 'usr-demo')).toMatchObject({
      status: 'private', ownerId: 'usr-demo', title: 'Desk unboxing in five shots', preparation: 'ready', preparationNote: null,
    });
    const failed = await data.catalog.get('tpl-own-failed', 'usr-demo');
    expect(failed).toMatchObject({ status: 'private', ownerId: 'usr-demo', preparation: 'failed', preparationNote: 'split-screen' });
    expect(failed?.shots).toEqual([]);
    expect(failed).toMatchObject({ description: '', tags: [] });
    vi.advanceTimersByTime(3_600_000);
    expect((await data.catalog.get('tpl-own-failed', 'usr-demo'))?.preparation).toBe('failed');
  });
});
