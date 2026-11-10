// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-admin';
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (sessionId ? data.auth.getUser(sessionId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({
  forbidden: () => { throw new Error('NEXT_FORBIDDEN'); },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { data } from '@/data';
import { fakeEngine } from '@/data/engine/fake';
import { resetStore } from '@/data/mock/store';
import {
  addCandidateToGallery, addLink, hideTemplate, prepareLinkList, publishTemplate, rejectCandidateAction, rejectTemplate, runScanNow, sampleCostFor, saveTemplate,
  startSample, uploadSamplePhoto, type LinkListState, type SaveState,
} from './actions';
import { loadEditor, loadInbox, loadList, loadScans } from './load';

const IDLE_SAVE: SaveState = { status: 'idle', errors: {} };
const IDLE_LIST: LinkListState = { status: 'idle', rows: [] };
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const shotsJson = (list: { from: number; to: number; action?: string; text?: string; product?: number | null }[]) =>
  JSON.stringify(list.map((s) => ({ action: 'Something happens', text: '', product: null, ...s })));

/** A valid save for tpl-eye (13 sec) with the given overrides. */
const save = (over: Record<string, string> = {}, id = 'tpl-eye') =>
  saveTemplate(IDLE_SAVE, form({
    id, title: 'Eye close-up, new title', category: 'Lashes', products: '1', visibility: 'published',
    shots: shotsJson([{ from: 0, to: 5 }, { from: 5, to: 13 }]), ...over,
  }));

/** The fixtures have no waiting template: "Add to gallery" on a candidate makes one (with no category, which the admin picks; `category` here stands for that pick). */
async function prepared(index = 0, category: string | null = 'Lashes') {
  const candidate = (await data.admin.candidates())[index]!;
  const template = await data.admin.prepareCandidate(candidate.id);
  return category === null ? template : data.admin.updateTemplate(template.id, { category });
}

beforeEach(() => {
  resetStore();
  sessionId = 'usr-admin';
  revalidatePath.mockClear();
});

describe('guards', () => {
  it.each([['usr-demo'], [null]])('a visitor (%s) gets the forbidden page from every action and loader, and nothing changes', async (who) => {
    sessionId = who;
    const candidatesBefore = (await data.admin.candidates()).length;
    const prev = { status: 'idle' as const };
    const calls = [
      () => save(), () => hideTemplate(IDLE_SAVE, form({ id: 'tpl-eye' })), () => publishTemplate(prev, form({ id: 'tpl-story' })),
      () => rejectTemplate(prev, form({ id: 'tpl-story' })), () => addCandidateToGallery(prev, form({ id: 'x' })),
      () => rejectCandidateAction(prev, form({ id: 'x' })), () => runScanNow(), () => addLink({ status: 'idle' }, form({ url: 'https://www.tiktok.com/@a/video/1' })),
      () => prepareLinkList(IDLE_LIST, form({ links: 'https://www.tiktok.com/@a/video/1' })),
      () => loadList({}), () => loadInbox({}), () => loadScans({}), () => loadEditor('tpl-eye'),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow('NEXT_FORBIDDEN');
    sessionId = 'usr-admin';
    expect((await data.admin.template('tpl-eye'))?.title).toBe('Eye close-up with a day counter');
    expect(await data.admin.candidates()).toHaveLength(candidatesBefore);
  });
});

describe('saveTemplate', () => {
  it('keeps the template\'s own category even when no published template has it (a scanned template: "food delivery")', async () => {
    const waiting = await prepared();
    const full = (await data.admin.template(waiting.id))!;
    await data.admin.updateTemplate(waiting.id, { title: full.title, category: 'Phone cases', products: full.products, shots: full.shots });
    expect((await data.catalog.categories()).includes('Phone cases')).toBe(false);
    const state = await saveTemplate(IDLE_SAVE, form({ id: waiting.id, title: full.title, category: 'Phone cases', products: String(full.products), visibility: '', shots: shotsJson([{ from: 0, to: full.seconds }]) }));
    expect(state.errors.category).toBeUndefined();
    expect(state.status).toBe('saved');
  });

  it('an empty or too short title is a field error and saves nothing', async () => {
    for (const title of ['', '  ', 'ab', 'x'.repeat(121)]) {
      const state = await save({ title });
      expect(state.status).toBe('error');
      expect(state.errors.title).toBe('invalid');
    }
    expect((await data.admin.template('tpl-eye'))?.title).toBe('Eye close-up with a day counter');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([['0'], ['9'], [''], ['1.5'], ['abc']])('products "%s" is a field error', async (products) => {
    expect((await save({ products })).errors.products).toBe('invalid');
  });

  it('at least one shot', async () => {
    expect((await save({ shots: '[]' })).errors.shots).toEqual({ code: 'none', n: 0 });
  });

  it.each([
    ['ends after the template length', [{ from: 0, to: 5 }, { from: 5, to: 14 }], { code: 'range', n: 2 }],
    ['starts before 0', [{ from: -1, to: 5 }], { code: 'range', n: 1 }],
    ['is empty', [{ from: 5, to: 5 }], { code: 'range', n: 1 }],
    ['starts before the shot above ends (overlap)', [{ from: 0, to: 6 }, { from: 5, to: 13 }], { code: 'order', n: 2 }],
    ['is out of order', [{ from: 6, to: 13 }, { from: 0, to: 5 }], { code: 'order', n: 2 }],
    ['uses a product the template does not need', [{ from: 0, to: 13, product: 2 }], { code: 'product', n: 1 }],
    ['has no text for what happens', [{ from: 0, to: 13, action: '  ' }], { code: 'invalid', n: 1 }],
  ])('a shot that %s is an error and saves nothing', async (_name, list, expected) => {
    const state = await save({ shots: shotsJson(list) });
    expect(state.status).toBe('error');
    expect(state.errors.shots).toEqual(expected);
    expect((await data.admin.template('tpl-eye'))?.title).toBe('Eye close-up with a day counter');
  });

  it('a shot may use product 2 when the template needs 2', async () => {
    const state = await save({ products: '2', shots: shotsJson([{ from: 0, to: 13, product: 2 }]) });
    expect(state.status).toBe('saved');
  });

  it('an unknown category or id is an error', async () => {
    expect((await save({ category: 'Nonsense' })).errors.category).toBe('invalid');
    expect((await save({}, 'nope')).errors.form).toBe('failed');
  });

  it('persists: the list shows the new title, the shots and the products; the shell is refreshed', async () => {
    const state = await save({ title: '  Brand new title  ', products: '2', shots: shotsJson([{ from: 0, to: 4, action: 'First' }, { from: 4, to: 13, action: 'Second', product: 2 }]) });
    expect(state).toEqual({ status: 'saved', errors: {} });
    const row = (await loadList({})).rows.find((r) => r.id === 'tpl-eye');
    expect(row?.title).toBe('Brand new title');
    const template = await data.admin.template('tpl-eye');
    expect(template?.products).toBe(2);
    expect(template?.shots.map((s) => [s.n, s.from, s.to, s.action, s.product])).toEqual([[1, 0, 4, 'First', null], [2, 4, 13, 'Second', 2]]);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('visibility Hidden hides it, Published publishes a waiting one', async () => {
    await save({ visibility: 'hidden' });
    expect((await data.admin.template('tpl-eye'))?.status).toBe('hidden');
    const waiting = await prepared();
    const seconds = waiting.seconds;
    await saveTemplate(IDLE_SAVE, form({ id: waiting.id, title: waiting.title, category: 'Lashes', products: '1', visibility: 'published', shots: shotsJson([{ from: 0, to: seconds }]) }));
    expect((await data.admin.template(waiting.id))?.status).toBe('published');
  });

  it('a waiting template with no category is published by a save that picks one', async () => {
    const waiting = await prepared(0, null);
    const send = (category: string) => saveTemplate(IDLE_SAVE, form({ id: waiting.id, title: waiting.title, category, products: '1', visibility: 'published', shots: shotsJson([{ from: 0, to: waiting.seconds }]) }));
    expect((await send('Lashes')).status).toBe('saved');
    expect((await data.admin.template(waiting.id))?.status).toBe('published');
  });
});

describe('hideTemplate', () => {
  it('sets the status to hidden and the template is gone from the public gallery', async () => {
    expect((await data.catalog.list({})).some((t) => t.id === 'tpl-eye')).toBe(true);
    expect(await hideTemplate(IDLE_SAVE, form({ id: 'tpl-eye' }))).toEqual({ status: 'hidden', errors: {} });
    expect((await data.admin.template('tpl-eye'))?.status).toBe('hidden');
    expect((await data.catalog.list({})).some((t) => t.id === 'tpl-eye')).toBe(false);
    expect((await loadList({ status: 'hidden' })).rows.map((r) => r.id)).toContain('tpl-eye');
    expect((await hideTemplate(IDLE_SAVE, form({ id: 'nope' }))).status).toBe('error');
  });
});

describe('inbox actions', () => {
  it('Publish puts a waiting template in the gallery; Reject hides it', async () => {
    const first = await prepared(0);
    const second = await prepared(1);
    expect(await publishTemplate({ status: 'idle' }, form({ id: first.id }))).toEqual({ status: 'done' });
    expect(await rejectTemplate({ status: 'idle' }, form({ id: second.id }))).toEqual({ status: 'done' });
    expect((await data.admin.template(first.id))?.status).toBe('published');
    expect((await data.admin.template(second.id))?.status).toBe('hidden');
    expect((await data.catalog.list({})).map((t) => t.id)).toContain(first.id);
    expect((await data.catalog.list({})).map((t) => t.id)).not.toContain(second.id);
    expect((await publishTemplate({ status: 'idle' }, form({ id: '' }))).status).toBe('error');
  });

  it('Add to gallery turns a candidate into a waiting template; Reject removes a candidate; neither works twice', async () => {
    const [a, b] = await data.admin.candidates();
    expect(await addCandidateToGallery({ status: 'idle' }, form({ id: a!.id }))).toEqual({ status: 'done' });
    expect((await data.admin.templates({ status: 'waiting' })).some((t) => t.title === a!.title)).toBe(true);
    expect((await addCandidateToGallery({ status: 'idle' }, form({ id: a!.id }))).status).toBe('error');
    expect(await rejectCandidateAction({ status: 'idle' }, form({ id: b!.id }))).toEqual({ status: 'done' });
    expect((await data.admin.candidates()).some((c) => c.id === b!.id)).toBe(false);
  });

  it('Run a scan now never starts a second scan while one runs (clicking twice is one effect)', async () => {
    const running = async () => (await data.admin.scans()).filter((s) => s.status === 'running');
    expect(await running()).toHaveLength(1); // the fixtures have a Top Ads scan running
    expect(await runScanNow()).toEqual({ status: 'done' });
    expect(await runScanNow()).toEqual({ status: 'done' });
    expect(await running()).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it.each([['http://www.tiktok.com/@a/video/1'], ['https://example.com/x'], ['https://tiktok.com.evil.com/x'], ['not a link'], ['']])('addLink refuses "%s"', async (url) => {
    const before = (await data.admin.templates({})).length;
    expect(await addLink({ status: 'idle' }, form({ url }))).toEqual({ status: 'error', error: 'linkInvalid' });
    expect((await data.admin.templates({})).length).toBe(before);
  });

  it('addLink accepts a TikTok or YouTube https link and adds a private template', async () => {
    const before = (await data.admin.templates({ status: 'private' })).length;
    expect(await addLink({ status: 'idle' }, form({ url: 'https://www.tiktok.com/@a/video/1' }))).toEqual({ status: 'done' });
    expect(await addLink({ status: 'idle' }, form({ url: 'https://youtu.be/abc' }))).toEqual({ status: 'done' });
    expect((await data.admin.templates({ status: 'private' })).length).toBe(before + 2);
  });
});

describe('loaders', () => {
  it('the list filters by status and search, unknown status falls back to all', async () => {
    const all = await loadList({});
    expect(all.status).toBe('all');
    const published = await loadList({ status: 'published' });
    expect(published.rows.length).toBeGreaterThan(0);
    expect(published.rows.every((r) => r.status === 'published')).toBe(true);
    expect(published.total).toBe(all.total);
    expect((await loadList({ status: 'bogus' })).status).toBe('all');
    expect((await loadList({ q: 'eye' })).rows.map((r) => r.id)).toContain('tpl-eye');
  });

  it('the editor 404s for an unknown id and returns the categories', async () => {
    await expect(loadEditor('nope')).rejects.toThrow('NEXT_NOT_FOUND');
    const { template, categories } = await loadEditor('tpl-eye');
    expect(template.id).toBe('tpl-eye');
    expect(categories).toContain('Lashes');
  });

  it('the inbox lists waiting templates, filters candidates by source and warns about a source whose newest scan stopped', async () => {
    expect((await loadInbox({})).waiting).toHaveLength(0);
    await prepared();
    const inbox = await loadInbox({});
    expect(inbox.waiting).toHaveLength(1);
    expect(inbox.candidates.length).toBeGreaterThan(0);
    const shorts = await loadInbox({ source: 'shorts' });
    expect(shorts.candidates.every((c) => c.source === 'shorts')).toBe(true);
    const scans = await data.admin.scans();
    const expected = (['topads', 'shorts'] as const).filter((s) => scans.find((x) => x.source === s)?.status === 'stopped');
    expect(inbox.stoppedSources.map((s) => s.source)).toEqual(expected);
    expect(inbox.stoppedSources.every((s) => s.reason === 'source-unavailable')).toBe(true);
  });

  it('the scan history filters by period and counts only catalog templates as published', async () => {
    const all = await loadScans({ period: 'all' });
    expect(all.scans.length).toBe(all.total);
    expect((await loadScans({ period: 'today' }, new Date('2030-01-01T00:00:00Z'))).scans).toHaveLength(0);
    // "Today" is the current day in UTC, not the last 24 hours.
    const newest = new Date(all.scans[0]!.startedAt);
    const justAfterMidnight = new Date(Date.UTC(newest.getUTCFullYear(), newest.getUTCMonth(), newest.getUTCDate() + 1) + 1);
    expect((await loadScans({ period: 'today' }, newest)).scans.map((scan) => scan.id)).toContain(all.scans[0]!.id);
    expect((await loadScans({ period: 'today' }, justAfterMidnight)).scans).toHaveLength(0);
    expect((await loadScans({ period: 'bogus' })).period).toBe('30d');
    expect(all.threshold).toBe((await data.admin.settings()).threshold);
  });
});

describe('forged status changes', () => {
  const idle = { status: 'idle' as const };
  const status = async (id: string) => (await data.admin.template(id))?.status;

  it('reject is waiting-only; publishing a hidden template without a current sample is refused', async () => {
    expect((await publishTemplate(idle, form({ id: 'tpl-eye' }))).error).toBe('transition');
    expect((await rejectTemplate(idle, form({ id: 'tpl-eye' }))).error).toBe('transition');
    expect(await status('tpl-eye')).toBe('published');
    await hideTemplate(IDLE_SAVE, form({ id: 'tpl-eye' }));
    expect((await publishTemplate(idle, form({ id: 'tpl-eye' }))).status).toBe('error');
    expect(await status('tpl-eye')).toBe('hidden');
    expect(revalidatePath).toHaveBeenCalledTimes(1); // only hide
  });

  it('a template with no category is not published and keeps its status', async () => {
    const waiting = await prepared(0, null);
    expect(waiting.category).toBe('');
    expect((await publishTemplate(idle, form({ id: waiting.id }))).error).toBe('transition');
    expect(await status(waiting.id)).toBe('waiting');
    await data.admin.updateTemplate(waiting.id, { category: 'Lashes' });
    expect(await publishTemplate(idle, form({ id: waiting.id }))).toEqual({ status: 'done' });
  });

  it('publish needs a sample image', async () => {
    const waiting = await prepared();
    const real = data.admin.template.bind(data.admin);
    const spy = vi.spyOn(data.admin, 'template').mockImplementation(async (id) => {
      const t = await real(id);
      return t ? { ...t, image: '' } : t;
    });
    expect((await publishTemplate(idle, form({ id: waiting.id }))).error).toBe('transition');
    spy.mockRestore();
    expect(await status(waiting.id)).toBe('waiting');
  });

  it('a private template is never touched by publish, reject, hide or a visibility save', async () => {
    for (const call of [() => publishTemplate(idle, form({ id: 'tpl-own-ready' })), () => rejectTemplate(idle, form({ id: 'tpl-own-ready' }))]) {
      expect((await call()).error).toBe('transition');
    }
    expect((await hideTemplate(IDLE_SAVE, form({ id: 'tpl-own-ready' }))).errors.form).toBe('transition');
    const state = await saveTemplate(IDLE_SAVE, form({ id: 'tpl-own-ready', title: 'Changed title', category: 'Lashes', products: '1', visibility: 'published', shots: shotsJson([{ from: 0, to: 12 }]) }));
    expect(state.errors.form).toBe('transition');
    expect(await status('tpl-own-ready')).toBe('private');
    expect((await data.admin.template('tpl-own-ready'))?.title).toBe('Desk unboxing in five shots');
  });

  it('hide works from published or waiting, not from hidden', async () => {
    const waiting = await prepared();
    expect((await hideTemplate(IDLE_SAVE, form({ id: waiting.id }))).status).toBe('hidden');
    expect((await hideTemplate(IDLE_SAVE, form({ id: waiting.id }))).errors.form).toBe('transition');
  });
});

describe('stored shot times', () => {
  it('fractional times from the data (an even split of 13 sec into 5) are saved as sent', async () => {
    const stored = (await data.admin.template('tpl-eye'))!.shots;
    const state = await save({ shots: JSON.stringify(stored.map(({ from, to, action, text, product }) => ({ from, to, action, text, product }))) });
    expect(state.status).toBe('saved');
    expect((await data.admin.template('tpl-eye'))!.shots.map((s) => [s.from, s.to])).toEqual(stored.map((s) => [s.from, s.to]));
  });
});

describe('sample', () => {
  const PAID = { images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 };
  const PRODUCTS = [1, 2, 3, 4, 5].map((n) => ({ name: `Serum ${n}`, images: [`uploads/sample/${n}.jpg`] }));

  it('sampleCostFor reads the paid requests and starts nothing', async () => {
    const jobs = (await data.admin.jobs({})).length;
    expect(await sampleCostFor('tpl-layering')).toEqual({ status: 'ok', paid: PAID });
    expect(await sampleCostFor('tpl-missing')).toEqual({ status: 'error' });
    expect(await sampleCostFor('')).toEqual({ status: 'error' });
    expect((await data.admin.jobs({})).length).toBe(jobs);
  });

  it('startSample with the counts that were shown starts the admin\'s sample job and refreshes the shell', async () => {
    const outcome = await startSample('tpl-layering', PAID, PRODUCTS);
    expect(outcome.status).toBe('ok');
    const job = (await data.admin.jobs({})).find((item) => outcome.status === 'ok' && item.id === outcome.jobId);
    expect(job).toMatchObject({ userId: 'usr-admin', templateId: 'tpl-layering', credits: 0 });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('startSample with other counts starts nothing and returns the counts of now', async () => {
    const jobs = (await data.admin.jobs({})).length;
    expect(await startSample('tpl-layering', { ...PAID, clips: 4 }, PRODUCTS)).toEqual({ status: 'changed', paid: PAID });
    expect((await data.admin.jobs({})).length).toBe(jobs);
  });

  it('without the products (none, a nameless one, a path that is not an upload shape) nothing starts', async () => {
    const jobs = (await data.admin.jobs({})).length;
    expect(await startSample('tpl-layering', PAID, [])).toEqual({ status: 'refused' });
    expect(await startSample('tpl-layering', PAID, [{ name: ' ', images: ['uploads/sample/1.jpg'] }, ...PRODUCTS.slice(1)])).toEqual({ status: 'refused' });
    expect(await startSample('tpl-layering', PAID, PRODUCTS.slice(0, 1))).toEqual({ status: 'refused' });   // the template needs more
    expect((await data.admin.jobs({})).length).toBe(jobs);
  });

  it('uploadSamplePhoto stores the admin\'s photograph, refuses what the store refuses, and is for admins only', async () => {
    const form = (file: File) => { const f = new FormData(); f.set('file', file); return f; };
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], 'a.png', { type: 'image/png' });
    expect(await uploadSamplePhoto(form(png))).toMatchObject({ status: 'saved' });
    vi.spyOn(data.uploads, 'save').mockRejectedValueOnce(new Error('upload-type'));
    expect(await uploadSamplePhoto(form(png))).toEqual({ status: 'refused' });
    sessionId = 'usr-demo';
    await expect(uploadSamplePhoto(form(png))).rejects.toThrow('NEXT_FORBIDDEN');
  });

  it('a forged count, an unknown id or a template that is not ready is refused (nothing started); a visitor gets the 404 page', async () => {
    const jobs = (await data.admin.jobs({})).length;
    expect(await startSample('tpl-layering', { ...PAID, images: -1 }, PRODUCTS)).toEqual({ status: 'refused' });
    expect(await startSample('tpl-missing', PAID, PRODUCTS)).toEqual({ status: 'refused' });
    expect(await startSample('tpl-own-failed', { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 }, PRODUCTS)).toEqual({ status: 'refused' });
    expect((await data.admin.jobs({})).length).toBe(jobs);
    sessionId = 'usr-demo';
    await expect(sampleCostFor('tpl-layering')).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(startSample('tpl-layering', PAID, PRODUCTS)).rejects.toThrow('NEXT_FORBIDDEN');
  });

  it('a start that fails without a code is "unknown", never "did not start"', async () => {
    const spy = vi.spyOn(data.admin, 'generateSample').mockRejectedValueOnce(new Error('socket hang up'));
    expect(await startSample('tpl-layering', PAID, PRODUCTS)).toEqual({ status: 'unknown' });
    spy.mockRestore();
  });

  it('the coded "sample-running" refusal (to come from D0) comes back as running, with its job when named', async () => {
    const spy = vi.spyOn(data.admin, 'generateSample').mockRejectedValueOnce(Object.assign(new Error('sample-running'), { jobId: 'job-9' }));
    expect(await startSample('tpl-layering', PAID, PRODUCTS)).toEqual({ status: 'running', jobId: 'job-9' });
    spy.mockRestore();
  });

  it('a template that says a sample is running opens no confirmation', async () => {
    const real = data.admin.template.bind(data.admin);
    const spy = vi.spyOn(data.admin, 'template').mockImplementation(async (id) => {
      const t = await real(id);
      return t ? Object.assign(t, { sampleRunning: { jobId: 'job-7' } }) : t;
    });
    const cost = vi.spyOn(data.admin, 'sampleCost');
    expect(await sampleCostFor('tpl-layering')).toEqual({ status: 'running', jobId: 'job-7' });
    expect(cost).not.toHaveBeenCalled();
    expect((await loadEditor('tpl-layering')).sampleRunning).toEqual({ jobId: 'job-7' });
    spy.mockRestore();
    cost.mockRestore();
    expect((await loadEditor('tpl-layering')).sampleRunning).toBeNull();
  });

  it('a refresh that fails after the start still reports the started sample', async () => {
    revalidatePath.mockImplementationOnce(() => {
      throw new Error('refresh failed');
    });
    const outcome = await startSample('tpl-layering', PAID, PRODUCTS);
    expect(outcome.status).toBe('ok');
  });
});

describe('publishing needs a finished preparation', () => {
  it.each([['preparing'], ['failed']] as const)('a waiting template whose preparation is %s is not published, by Publish or by a save', async (preparation) => {
    const waiting = await prepared();
    const real = data.admin.template.bind(data.admin);
    const spy = vi.spyOn(data.admin, 'template').mockImplementation(async (id) => {
      const t = await real(id);
      return t ? { ...t, image: '/samples/x.jpg', preparation } : t;
    });
    expect((await publishTemplate({ status: 'idle' }, form({ id: waiting.id }))).error).toBe('transition');
    const saved = await saveTemplate(IDLE_SAVE, form({
      id: waiting.id, title: 'A fine title', category: waiting.category || 'Lashes', products: String(waiting.products), visibility: 'published',
      shots: shotsJson([{ from: 0, to: waiting.seconds }]),
    }));
    expect(saved.errors.form).toBe('transition');
    spy.mockRestore();
    expect((await data.admin.template(waiting.id))?.status).toBe('waiting');
  });
});

it('a hidden template with a current sample can be republished', async () => {
  await hideTemplate(IDLE_SAVE, form({ id: 'tpl-layering' }));
  expect(await publishTemplate({ status: 'idle' }, form({ id: 'tpl-layering' }))).toEqual({ status: 'done' });
  expect((await data.admin.template('tpl-layering'))?.status).toBe('published');
});

describe('prepareLinkList: a list of links, one per line, prepared for the catalog', () => {
  const video = (n: number) => `https://www.tiktok.com/@shop/video/7300000${String(n).padStart(12, '0')}`;
  const send = (links: string) => prepareLinkList(IDLE_LIST, form({ links }));
  afterEach(() => vi.restoreAllMocks());

  it('says row by row what became of each line, blank lines are not rows', async () => {
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const state = await send(`${video(1)}\n\n  \nhttps://example.com/x\nhttp://www.tiktok.com/@a/video/2\n${video(1)}\r\n${video(2)}`);
    expect(state).toEqual({ status: 'done', rows: [
      { line: video(1), status: 'queued' }, { line: 'https://example.com/x', status: 'invalid' },
      { line: 'http://www.tiktok.com/@a/video/2', status: 'invalid' }, { line: video(1), status: 'exists' }, { line: video(2), status: 'queued' },
    ] });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('uses the preparation path once for each valid link, and no provider, sample or job is asked', async () => {
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const spent = [vi.spyOn(fakeEngine, 'start'), vi.spyOn(fakeEngine, 'resume'), vi.spyOn(fakeEngine, 'paid')];
    const waiting = (await data.admin.templates({ status: 'waiting' })).length;
    await send([video(1), video(2), video(3)].join('\n'));
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(spent.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    expect((await data.admin.templates({ status: 'waiting' })).length).toBe(waiting + 3);
  });

  it('a 51st line is refused and nothing at all is queued; 50 are taken', async () => {
    await data.admin.saveSettings({ dailyTemplates: 100, dailyCandidates: 100 });
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const lines = Array.from({ length: 51 }, (_, n) => video(n));
    expect(await send(lines.join('\n'))).toEqual({ status: 'error', error: 'tooMany', rows: [] });
    expect(prepare).not.toHaveBeenCalled();
    const taken = await send(lines.slice(0, 50).join('\n'));
    expect(taken.status).toBe('done');
    expect(taken.rows.every((row) => row.status === 'queued')).toBe(true);
  });

  it('an empty box is an error and asks nothing', async () => {
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    expect(await send(' \n \n')).toEqual({ status: 'error', error: 'empty', rows: [] });
    expect(await prepareLinkList(IDLE_LIST, new FormData())).toEqual({ status: 'error', error: 'empty', rows: [] });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('when the day is full the rest is told "limit" and nothing goes over it', async () => {
    await data.admin.saveSettings({ dailyTemplates: 2 });
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const state = await send([video(1), video(2), video(3)].join('\n'));
    expect(state.rows.map((row) => row.status)).toEqual(['queued', 'queued', 'limit']);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('a very long line or a box of a page of text is refused before anything is read', async () => {
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    expect(await send('x'.repeat(200_000))).toMatchObject({ status: 'error', error: 'tooMany' });
    expect(prepare).not.toHaveBeenCalled();
  });
});
