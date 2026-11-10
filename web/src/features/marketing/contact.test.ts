import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined) }) }));

import { data } from '@/data';
import { resetStore, getStore } from '@/data/mock/store';
import { limiter } from '@/core/rate-limit/rate-limit';
import { validateContact } from './contact';
import { submitContact, type ContactState } from './actions';

const OK = { topic: 'video', email: 'a@b.co', link: '', message: 'Something went wrong with my job.' };

beforeEach(() => {
  resetStore();
  limiter.reset();
  jar.clear();
});

describe('validateContact', () => {
  it('accepts a valid message with no link', () => {
    const { topic, email, message } = OK;
    expect(validateContact(OK)).toEqual({ ok: true, data: { topic, email, message, link: undefined } });
  });
  it('rejects an invalid email', () => {
    const r = validateContact({ ...OK, email: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.email).toBe('email');
  });
  it('rejects a message that is too short or too long', () => {
    for (const message of ['short', 'x'.repeat(2001)]) {
      const r = validateContact({ ...OK, message });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.message).toBe('message');
    }
  });
  it('accepts only https links', () => {
    expect(validateContact({ ...OK, link: 'https://example.com/v/1' }).ok).toBe(true);
    for (const link of ['http://example.com', 'javascript:alert(1)', 'not a url']) {
      const r = validateContact({ ...OK, link });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.link).toBe('link');
    }
  });
  it('rejects an unknown topic', () => {
    const r = validateContact({ ...OK, topic: 'x' });
    expect(r.ok).toBe(false);
  });
});

describe('submitContact', () => {
  it('treats a missing topic as a field error, not a default', async () => {
    const fd = new FormData();
    fd.set('email', 'a@b.co');
    fd.set('message', 'Something went wrong with my job.');
    const s = await submitContact({ status: 'idle', errors: {}, values: { topic: 'video', email: '', link: '', message: '' } }, fd);
    expect(s.status).toBe('error');
    expect(s.errors.topic).toBe('topic');
  });
  const idle: ContactState = { status: 'idle', errors: {}, values: { topic: 'video', email: '', link: '', message: '' } };
  it('returns field errors and keeps the values', async () => {
    const fd = new FormData();
    fd.set('topic', 'video');
    fd.set('email', 'bad');
    fd.set('message', '');
    const s = await submitContact(idle, fd);
    expect(s.status).toBe('error');
    expect(s.errors.email).toBe('email');
    expect(s.errors.message).toBe('message');
    expect(s.values.email).toBe('bad');
  });
  it('sends the message to the support desk and answers with its reference; the same form instance again is a duplicate with the same reference', async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(OK)) fd.set(k, v);
    fd.set('key', 'form-1');
    const first = await submitContact(idle, fd);
    expect(first).toMatchObject({ status: 'sent', duplicate: false });
    expect(first.reference).toMatch(/^S-/);
    const second = await submitContact(idle, fd);
    expect(second).toMatchObject({ status: 'sent', duplicate: true, reference: first.reference });
    const messages = (await data.support.messages()).filter((m) => m.email === 'a@b.co');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ topic: 'video', userId: null });
  });
  it('the new "Refund" topic is valid', () => {
    expect(validateContact({ ...OK, topic: 'refund' }).ok).toBe(true);
  });
  it('a signed-in visitor writes from the address of the account (the form value is ignored) and may name only a job of their own', async () => {
    jar.set('vc_session', 'usr-demo');
    const mine = (await data.jobs.listFor('usr-demo'))[0]!;
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...OK, email: 'someone-else@example.com', jobId: mine.id, key: 'form-2' })) fd.set(k, v);
    await submitContact(idle, fd);
    const fd2 = new FormData();
    for (const [k, v] of Object.entries({ ...OK, jobId: 'job-of-somebody-else', key: 'form-3' })) fd2.set(k, v);
    await submitContact(idle, fd2);
    const sent = await data.support.messages();
    const demo = await data.auth.getUser('usr-demo');
    expect(sent.find((m) => m.jobId === mine.id)).toMatchObject({ email: demo!.email, userId: 'usr-demo' });
    expect(sent.some((m) => m.email === 'someone-else@example.com')).toBe(false);
    expect(sent.filter((m) => m.userId === 'usr-demo' && m.jobId === null)).toHaveLength(1);
  });
  it('a failure of the desk keeps the fields and says failed', async () => {
    const spy = vi.spyOn(data.support, 'send').mockRejectedValueOnce(new Error('down'));
    const fd = new FormData();
    for (const [k, v] of Object.entries(OK)) fd.set(k, v);
    const out = await submitContact(idle, fd);
    expect(out).toMatchObject({ status: 'failed' });
    expect(out.values.message).toBe(OK.message);
    spy.mockRestore();
  });
});

describe('the anonymous contact form cannot be used to fill the site (B1)', () => {
  const idle: ContactState = { status: 'idle', errors: {}, values: { topic: 'video', email: '', link: '', message: '' } };
  const send = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...OK, ...fields })) fd.set(k, v);
    return submitContact(idle, fd);
  };

  it('refuses a link or an address longer than any real one, and stores nothing', async () => {
    expect(validateContact({ ...OK, link: `https://example.com/${'a'.repeat(2000)}` }).ok).toBe(false);
    expect(validateContact({ ...OK, email: `${'a'.repeat(250)}@b.co` }).ok).toBe(false);
    const out = await send({ link: `https://example.com/${'a'.repeat(10_000)}`, key: 'k' });
    expect(out.status).toBe('error');
    expect(out.errors.link).toBe('link');
    expect(await data.support.messages()).toHaveLength(0);
  });
  it('a long form key is not stored as it is', async () => {
    const out = await send({ key: 'k'.repeat(10_000) });
    expect(out.status).toBe('sent');
    expect([...getStore().keys.keys()].every((k) => k.length < 200)).toBe(true);
  });
  it('a message over the limit says it is a limit, keeps the fields, and is not counted as a failure of the desk', async () => {
    for (let i = 0; i < 5; i++) await send({ key: `l-${i}` });
    const out = await send({ key: 'l-5', message: 'Still here after the limit.' });
    expect(out).toMatchObject({ status: 'limited', values: { message: 'Still here after the limit.' } });
  });
  it('one address cannot send message after message', async () => {
    for (let i = 0; i < 5; i++) expect((await send({ key: `f-${i}` })).status).toBe('sent');
    expect((await send({ key: 'f-5' })).status).toBe('limited');
    expect(await data.support.messages()).toHaveLength(5);
  });
  it('one caller cannot send without end from many addresses', async () => {
    let sent = 0;
    for (let i = 0; i < 150; i++) if ((await send({ email: `x${i}@b.co`, key: `g-${i}` })).status === 'sent') sent++;
    expect(sent).toBe(100);
  });
  const filler = (n: number, over: { at?: string; userId?: string | null; email?: string } = {}) => ({
    reference: `S-${String(n).padStart(6, '0')}`, at: new Date().toISOString(), topic: 'other', email: 'f@f.co', message: 'filler', userId: null, jobId: null, problem: null, ...over,
  } as const);
  const LONG_AGO = '2020-01-01T00:00:00.000Z';

  it('the desk takes only so many anonymous messages a day', async () => {
    getStore().support.push(...Array.from({ length: 499 }, (_, i) => filler(i + 1)));
    expect((await send({ key: 'last' })).status).toBe('sent');
    expect((await send({ email: 'z@b.co', key: 'over' })).status).toBe('failed');
    expect(await data.support.messages()).toHaveLength(500);
  });
  it('a full day of anonymous messages does not close the desk for a signed-in customer', async () => {
    getStore().support.push(...Array.from({ length: 500 }, (_, i) => filler(i + 1)));
    expect((await send({ key: 'anonymous' })).status).toBe('failed');
    jar.set('vc_session', 'usr-demo');
    expect((await send({ key: 'customer', topic: 'refund' })).status).toBe('sent');
  });
  it('the messages of customers do not use up the day of the anonymous form', async () => {
    getStore().support.push(...Array.from({ length: 500 }, (_, i) => filler(i + 1, { userId: 'usr-demo' })));
    expect((await send({ key: 'visitor' })).status).toBe('sent');
  });
  it('the same form again on a full day is answered with its first reference, not refused', async () => {
    const first = await send({ key: 'again' });
    getStore().support.push(...Array.from({ length: 499 }, (_, i) => filler(i + 2)));
    expect((await send({ email: 'z@b.co', key: 'new' })).status).toBe('failed');
    expect(await send({ key: 'again' })).toMatchObject({ status: 'sent', duplicate: true, reference: first.reference });
  });
  it('at the total the oldest anonymous message makes room: the form never closes for good, and no message of a customer is dropped', async () => {
    const store = getStore();
    store.support.push(filler(1, { at: LONG_AGO, userId: 'usr-demo', email: 'customer@example.com' }), filler(2, { at: LONG_AGO, email: 'oldest@example.com' }));
    store.keys.set('support:oldest@example.com:its-form', 'S-000002');
    store.support.push(...Array.from({ length: 9_999 }, (_, i) => filler(i + 3, { at: LONG_AGO })));
    const out = await send({ key: 'all' });
    expect(out.status).toBe('sent');
    const kept = await data.support.messages();
    expect(kept.filter((m) => m.userId === null)).toHaveLength(10_000);
    expect(kept.some((m) => m.email === 'oldest@example.com')).toBe(false);
    expect(kept.some((m) => m.email === 'customer@example.com')).toBe(true);
    expect(store.keys.has('support:oldest@example.com:its-form')).toBe(false);
    expect(kept.filter((m) => m.reference === out.reference)).toHaveLength(1); // a dropped message does not hand its number to the next one
    expect((await send({ key: 'all-2', topic: 'refund' })).reference).not.toBe(out.reference);
  });
  it('a signed-in customer still sends when anonymous callers have used up the shared bucket (N1)', async () => {
    for (let i = 0; i < 100; i++) await send({ email: `x${i}@b.co`, key: `fill-${i}` });
    expect((await send({ email: 'y@b.co', key: 'anon-over' })).status).toBe('limited');
    jar.set('vc_session', 'usr-demo');
    expect((await send({ key: 'customer', topic: 'refund' })).status).toBe('sent');
  });
  it('a signed-in customer is limited by the account, not by the shared bucket (N1)', async () => {
    jar.set('vc_session', 'usr-demo');
    for (let i = 0; i < 5; i++) expect((await send({ key: `c-${i}` })).status).toBe('sent');
    expect((await send({ key: 'c-5' })).status).toBe('limited');
  });
  it('a normal visitor still gets through, twice, and a signed-in one too', async () => {
    expect((await send({ key: 'n-1' })).status).toBe('sent');
    expect((await send({ key: 'n-2', topic: 'refund' })).status).toBe('sent');
    jar.set('vc_session', 'usr-demo');
    expect((await send({ key: 'n-3' })).status).toBe('sent');
  });
});
