// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { resetStore } from '@/data/mock/store';
import { addCredits, sendPasswordReset, setAccess } from './actions';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const add = (over: Partial<Parameters<typeof addCredits>[0]> = {}) => addCredits({ userId: 'usr-demo', credits: 5, reason: 'Support goodwill', key: 'k-1', ...over });

beforeEach(() => {
  resetStore();
  sessionId = 'usr-admin';
  revalidatePath.mockClear();
});

describe('addCredits', () => {
  it.each([[0], [-3], [2.5], [10001], [Number.NaN]])('credits %s is refused and writes nothing', async (credits) => {
    const before = await data.ledger.balance('usr-demo');
    expect(await add({ credits })).toEqual({ status: 'failed' });
    expect(await data.ledger.balance('usr-demo')).toBe(before);
  });

  it.each([[''], ['   '], ['x'.repeat(201)]])('reason "%s" is refused and writes nothing', async (reason) => {
    const before = await data.ledger.entries('usr-demo');
    expect(await add({ reason })).toEqual({ status: 'failed' });
    expect(await data.ledger.entries('usr-demo')).toHaveLength(before.length);
  });

  it('writes a ledger entry by the admin with the reason, raises the balance, and answers with the new balance (no refresh: the dialog refreshes when it closes)', async () => {
    const before = await data.ledger.balance('usr-demo');
    const result = await add({ credits: 7, reason: '  Late delivery  ' });
    expect(result).toMatchObject({ status: 'done', detail: { credits: 7, balanceAfter: before + 7 } });
    expect(await data.ledger.balance('usr-demo')).toBe(before + 7);
    const [entry] = await data.ledger.entries('usr-demo');
    expect(entry).toMatchObject({ type: 'admin', change: 7, reason: 'Late delivery', by: { kind: 'admin', id: 'usr-admin' } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('the same key twice writes one entry', async () => {
    const before = (await data.ledger.entries('usr-demo')).length;
    await add();
    await add();
    expect(await data.ledger.entries('usr-demo')).toHaveLength(before + 1);
  });

  it('refuses an empty key and an unknown user without writing', async () => {
    expect(await add({ key: '' })).toEqual({ status: 'failed' });
    expect(await add({ userId: 'usr-nobody' })).toEqual({ status: 'failed' });
  });

  it('a customer or a signed-out visitor gets the 404 and nothing is written', async () => {
    const before = await data.ledger.balance('usr-demo');
    sessionId = 'usr-demo';
    await expect(add()).rejects.toThrow('NEXT_FORBIDDEN');
    sessionId = null;
    await expect(add()).rejects.toThrow('NEXT_FORBIDDEN');
    expect(await data.ledger.balance('usr-demo')).toBe(before);
  });
});

describe('setAccess', () => {
  it('blocks with a reason (kept on the user): the user can no longer log in; unblock restores it; a repeat answers "already"', async () => {
    expect(await data.auth.logIn('demo@viralclone.app', 'x')).toMatchObject({ ok: true });
    expect(await setAccess({ userId: 'usr-demo', blocked: true, reason: 'Chargeback' })).toMatchObject({ status: 'done', detail: { blocked: true } });
    expect((await data.admin.user('usr-demo'))?.user.block).toMatchObject({ reason: 'Chargeback', by: { kind: 'admin', id: 'usr-admin' } });
    expect(await data.auth.logIn('demo@viralclone.app', 'x')).toMatchObject({ ok: false, reason: 'blocked' });
    expect(await setAccess({ userId: 'usr-demo', blocked: true, reason: 'Again' })).toMatchObject({ status: 'already' });
    expect(await setAccess({ userId: 'usr-demo', blocked: false, reason: 'Resolved' })).toMatchObject({ status: 'done', detail: { blocked: false } });
    expect(await data.auth.logIn('demo@viralclone.app', 'x')).toMatchObject({ ok: true });
  });

  it('needs a reason: without one nothing changes', async () => {
    expect(await setAccess({ userId: 'usr-demo', blocked: true, reason: '  ' })).toEqual({ status: 'failed' });
    expect((await data.admin.user('usr-demo'))?.user.blocked).toBe(false);
  });

  it('a customer cannot block anyone', async () => {
    sessionId = 'usr-paying';
    await expect(setAccess({ userId: 'usr-demo', blocked: true, reason: 'x' })).rejects.toThrow('NEXT_FORBIDDEN');
    expect((await data.admin.user('usr-demo'))?.user.blocked).toBe(false);
  });

  it('an admin cannot block their own account: it fails and nothing changes', async () => {
    expect(await setAccess({ userId: 'usr-admin', blocked: true, reason: 'Oops' })).toEqual({ status: 'failed' });
    expect((await data.admin.user('usr-admin'))?.user.blocked).toBe(false);
  });
});

describe('sendPasswordReset', () => {
  it('sends the reset email to the user and says so', async () => {
    const state = await sendPasswordReset({ status: 'idle' }, form({ userId: 'usr-demo' }));
    expect(state.status).toBe('sent');
    const outbox = await data.mailer.outbox();
    expect(outbox.some((mail) => mail.kind === 'reset' && mail.to === 'demo@viralclone.app')).toBe(true);
  });

  it('an unknown user is an error and sends nothing', async () => {
    const before = (await data.mailer.outbox()).length;
    expect((await sendPasswordReset({ status: 'idle' }, form({ userId: 'usr-nobody' }))).status).toBe('error');
    expect(await data.mailer.outbox()).toHaveLength(before);
  });
});
