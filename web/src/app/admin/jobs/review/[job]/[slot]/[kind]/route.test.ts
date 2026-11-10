// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

import { data } from '@/data';
import { SWAP_TEMPLATE_ID } from '@/data/mock/demo-values';
import { getStore, resetStore } from '@/data/mock/store';
import { NotFoundError, RULES, type Job, type SwapConsent, type SwapInput } from '@/data/ports';
import { GET } from './route';

const consent: SwapConsent = { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion };
const input: SwapInput = { templateId: SWAP_TEMPLATE_ID, quality: 'fast', people: [{ slot: 1, body: 'me.jpg', face: null }] };
const start = async (): Promise<Job> => data.swap.start('usr-demo', input, 'key-1', await data.swap.estimate('usr-demo', input), consent);
const ask = (job: string, slot = '1', kind = 'body') =>
  GET(new Request(`http://x/admin/jobs/review/${job}/${slot}/${kind}`), { params: Promise.resolve({ job, slot, kind }) });
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
let dir: string;
/** The data layer hands over a stored file: what it does in real mode for a job that waits. */
const stored = () => {
  const file = path.join(dir, 'body.jpg');
  writeFileSync(file, BYTES);
  return vi.spyOn(data.admin, 'swapPhoto').mockResolvedValue({ state: 'shown', name: 'body.jpg', file: { path: file, type: 'image/jpeg', size: BYTES.length } });
};

beforeEach(() => {
  vi.stubEnv('VC_FAKE_SWAP', '1');
  resetStore();
  getStore().limits.personSwap = true;
  delete getStore().limits.swapReview;
  sessionId = 'usr-admin';
  dir = mkdtempSync(path.join(tmpdir(), 'kd4b-photo-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('/admin/jobs/review/[job]/[slot]/[kind]', () => {
  it('hands the photograph of a job that waits to the admin: its bytes, its type, and never from a cache', async () => {
    const job = await start();
    const read = stored();
    const answer = await ask(job.id);
    expect(answer.status).toBe(200);
    expect(Buffer.from(await answer.arrayBuffer())).toEqual(BYTES);
    expect(answer.headers.get('content-type')).toBe('image/jpeg');
    expect(answer.headers.get('content-length')).toBe(String(BYTES.length));
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(read).toHaveBeenCalledWith('usr-admin', job.id, 1, 'body');
  });

  it('hands the side photograph over on the same way: asked of the data layer as the side one, and never from a cache', async () => {
    const job = await start();
    const read = stored();
    const answer = await ask(job.id, '1', 'side');
    expect(answer.status).toBe(200);
    expect(Buffer.from(await answer.arrayBuffer())).toEqual(BYTES);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(read).toHaveBeenCalledWith('usr-admin', job.id, 1, 'side');
  });

  it.each([['the owner of the job', 'usr-demo'], ['another customer', 'usr-new'], ['a signed-out visitor', null]])('is a 403 for %s who has the address, before the data layer is asked for anything', async (_name, who) => {
    const job = await start();
    const read = stored();
    sessionId = who;
    await expect(ask(job.id)).rejects.toThrow('NEXT_FORBIDDEN');
    expect(read).not.toHaveBeenCalled();
  });

  it('the no of the data layer is a 403 too, with no byte', async () => {
    const job = await start();
    vi.spyOn(data.admin, 'swapPhoto').mockRejectedValue(new Error('forbidden'));
    await expect(ask(job.id)).rejects.toThrow('NEXT_FORBIDDEN');
  });

  it.each([['approved', 'decided'], ['rejected', 'deleted']] as const)('a job that was %s says "%s" and gives no byte', async (verdict, state) => {
    const job = await start();
    await data.admin.reviewSwap('usr-admin', job.id, verdict);
    const answer = await ask(job.id);
    expect(answer.status).toBe(410);
    expect(await answer.text()).toBe(state);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('fake mode keeps no file: a photograph that is only a name is a 404, never a made-up picture', async () => {
    const job = await start();
    const answer = await ask(job.id);
    expect(answer.status).toBe(404);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(await answer.text()).not.toContain('me.jpg');
  });

  it.each([
    ['an unknown job', 'job-nobody', '1', 'body'],
    ['a face the job never had', 'JOB', '1', 'face'],
    ['a side photograph the job never had', 'JOB', '1', 'side'],
    ['a slot the job never had', 'JOB', '2', 'body'],
    ['a slot that is no number', 'JOB', '1e0', 'body'],
    ['another kind of file', 'JOB', '1', 'video'],
  ])('%s is a 404 that is not cached', async (_name, id, slot, kind) => {
    const job = await start();
    const read = vi.spyOn(data.admin, 'swapPhoto');
    const answer = await ask(id === 'JOB' ? job.id : id, slot, kind);
    expect(answer.status).toBe(404);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    if (slot === '1e0' || kind === 'video') expect(read).not.toHaveBeenCalled();
  });

  it('an error of the data layer that is no refusal is not turned into a 404', async () => {
    vi.spyOn(data.admin, 'swapPhoto').mockRejectedValue(new Error('disk'));
    await expect(ask('job-1')).rejects.toThrow('disk');
    vi.spyOn(data.admin, 'swapPhoto').mockRejectedValue(new NotFoundError('photo'));
    expect((await ask('job-1')).status).toBe(404);
  });
});
