// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { resetStore } from './store';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fake mailer', () => {
  it('starts with an empty outbox', async () => {
    expect(await data.mailer.outbox()).toEqual([]);
  });

  it('send keeps the email in the outbox instead of sending it', async () => {
    await data.mailer.send('ready', 'demo@viralclone.app', { jobId: 'job-1' });
    const outbox = await data.mailer.outbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: 'ready', to: 'demo@viralclone.app', at: '2026-10-04T12:00:00.000Z', data: { jobId: 'job-1' } });
    expect(outbox[0]?.id).toEqual(expect.any(String));
  });

  it('outbox is newest first', async () => {
    await data.mailer.send('verify', 'a@example.com', {});
    vi.advanceTimersByTime(1_000);
    await data.mailer.send('reset', 'b@example.com', {});
    await data.mailer.send('payment', 'c@example.com', {});
    expect((await data.mailer.outbox()).map((email) => email.kind)).toEqual(['payment', 'reset', 'verify']);
  });

  it('hands out copies, so a caller cannot change the outbox', async () => {
    const data1 = { jobId: 'job-1' };
    await data.mailer.send('ready', 'demo@viralclone.app', data1);
    data1.jobId = 'changed';
    const [email] = await data.mailer.outbox();
    if (email) email.to = 'changed@example.com';
    expect((await data.mailer.outbox())[0]).toMatchObject({ to: 'demo@viralclone.app', data: { jobId: 'job-1' } });
  });
});
