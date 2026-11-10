// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { NotFoundError } from '../ports';
import { getStore, resetStore } from './store';
import { START, generateInput as input, startConfirmed } from './test-helpers';

const LINK = 'https://www.tiktok.com/@someone/video/1';
const ids = (templates: { id: string }[]) => templates.map((template) => template.id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('remove a template', () => {
  it('the owner removes a private template: it is gone for the owner and for the admin', async () => {
    await expect(data.catalog.remove('tpl-own-failed', 'usr-demo')).resolves.toBeUndefined();
    expect(await data.catalog.get('tpl-own-failed', 'usr-demo')).toBeNull();
    expect(ids(await data.catalog.list({ viewerId: 'usr-demo' }))).not.toContain('tpl-own-failed');
    expect(await data.admin.template('tpl-own-failed')).toBeNull();
    expect(await data.admin.templates({})).toHaveLength(7);
  });

  it('a preparing template stays for owner and admin until preparation finishes', async () => {
    const added = await data.catalog.addFromLink('usr-paying', LINK);
    await expect(data.catalog.remove(added.id, 'usr-paying')).rejects.toThrow('template-in-use');
    await expect(data.catalog.remove(added.id, 'usr-admin')).rejects.toThrow('template-in-use');
    expect(await data.catalog.get(added.id, 'usr-paying')).toMatchObject({ preparation: 'preparing' });
    vi.advanceTimersByTime(20_000);
    await data.catalog.remove(added.id, 'usr-paying');
    expect(await data.catalog.get(added.id, 'usr-paying')).toBeNull();
  });

  it('another customer, an unknown viewer and an unknown id are "not found", and nothing is removed', async () => {
    await expect(data.catalog.remove('tpl-own-ready', 'usr-paying')).rejects.toThrow(NotFoundError);
    await expect(data.catalog.remove('tpl-own-ready', 'nobody')).rejects.toThrow(NotFoundError);
    await expect(data.catalog.remove('tpl-missing', 'usr-demo')).rejects.toThrow(NotFoundError);
    expect(await data.admin.templates({})).toHaveLength(8);
  });

  it('a customer cannot remove a template of the catalog', async () => {
    await expect(data.catalog.remove('tpl-eye', 'usr-demo')).rejects.toThrow(NotFoundError);
    expect((await data.catalog.get('tpl-eye'))?.id).toBe('tpl-eye');
  });

  it('an admin removes any template: one of the catalog, a waiting one, a customer\'s private one', async () => {
    const waiting = await data.admin.prepareCandidate('cand-1');
    await data.catalog.remove('tpl-eye', 'usr-admin');
    await data.catalog.remove(waiting.id, 'usr-admin');
    await data.catalog.remove('tpl-own-failed', 'usr-admin');
    expect(ids(await data.admin.templates({}))).toEqual(['tpl-layering', 'tpl-story', 'tpl-stop', 'tpl-shower', 'tpl-refused', 'tpl-own-ready']);
    expect(await data.catalog.get('tpl-eye')).toBeNull();
  });

  it('a template with a running job is in use: it stays, for the owner and for the admin', async () => {
    await startConfirmed('usr-demo', input('tpl-own-ready'), 'key-1');
    await expect(data.catalog.remove('tpl-own-ready', 'usr-demo')).rejects.toThrow('template-in-use');
    await expect(data.catalog.remove('tpl-own-ready', 'usr-admin')).rejects.toThrow('template-in-use');
    await expect(data.catalog.remove('tpl-layering', 'usr-admin')).rejects.toThrow('template-in-use'); // the frozen running job of the fixtures
    expect((await data.catalog.get('tpl-own-ready', 'usr-demo'))?.id).toBe('tpl-own-ready');
  });

  it('once the job is done the template can be removed, and the job stays with its ready email', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-own-ready'), 'key-1');
    vi.advanceTimersByTime(40_000);
    await data.catalog.remove('tpl-own-ready', 'usr-demo'); // nobody has read the job since it finished
    expect(await data.catalog.get('tpl-own-ready', 'usr-demo')).toBeNull();
    expect(await data.jobs.get(job.id, 'usr-demo')).toMatchObject({ status: 'done', templateTitle: 'Desk unboxing in five shots' });
    expect((await data.mailer.outbox()).filter((email) => email.kind === 'ready')).toMatchObject([{ data: { jobId: job.id } }]);
  });

  it('a stopped job does not keep a template', async () => {
    await data.catalog.remove('tpl-stop', 'usr-admin'); // job-demo-stopped ran on it
    expect(await data.admin.template('tpl-stop')).toBeNull();
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.status).toBe('stopped');
    expect(getStore().jobs).toHaveLength(10);
  });
});
