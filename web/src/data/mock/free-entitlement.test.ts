import { afterEach, expect, it, vi } from 'vitest';
import { auth } from './auth';
import { getStore, resetStore } from './store';

afterEach(() => vi.restoreAllMocks());
it('grants once across concurrent aliases, deletion and signup; outside Gmail a dot is another mailbox', async () => {
  resetStore();
  const first = await auth.signUp('Trial+one@example.test', 'password123');
  const second = await auth.signUp('trial+two@example.test', 'password123');
  await Promise.all([auth.verifyEmail(first.id), auth.verifyEmail(second.id)]);
  expect(getStore().users.filter(u => [first.id, second.id].includes(u.id) && u.freeVideoAvailable)).toHaveLength(1);
  await auth.deleteAccount(first.id);
  const again = await auth.signUp('Trial+one@example.test', 'password123');
  expect(await auth.verifyEmail(again.id)).toMatchObject({ freeVideoAvailable: false });
  const dotted = await auth.signUp('tr.ial@example.test', 'password123');
  expect(await auth.verifyEmail(dotted.id)).toMatchObject({ freeVideoAvailable: true });
});

it('keeps a legacy verified account ineligible after deletion', async () => {
  resetStore();
  getStore().jobs = [];
  const legacy = getStore().users.find(u => u.role === 'customer')!;
  legacy.emailVerified = true;
  const email = legacy.email;
  await auth.deleteAccount(legacy.id);
  const again = await auth.signUp(email, 'password123');
  expect(await auth.verifyEmail(again.id)).toMatchObject({ freeVideoAvailable: false });
});

it('one Gmail mailbox gets one free video, however it is written: dots, +tags and googlemail.com (SEC B8)', async () => {
  resetStore();
  const free = async (email: string) => (await auth.verifyEmail((await auth.signUp(email, 'password123')).id)).freeVideoAvailable;
  expect(await free('ab.cd@gmail.com')).toBe(true);
  for (const alias of ['abcd@gmail.com', 'a.b.c.d@gmail.com', 'AB.CD+promo@Gmail.com', 'abcd@googlemail.com', 'a.bcd+x@googlemail.com']) {
    expect(await free(alias), alias).toBe(false);
  }
  expect(await free('abcde@gmail.com')).toBe(true); // another mailbox
  expect(await free('ab.cd@gmail.com.example.test')).toBe(true); // not Gmail: the domain only starts like it
});

it('the Gmail rule is for the free video only: each spelling stays its own account with its own log-in', async () => {
  resetStore();
  const dotted = await auth.signUp('ab.cd@gmail.com', 'password-one');
  const plain = await auth.signUp('abcd@gmail.com', 'password-two');
  expect([dotted.email, plain.email]).toEqual(['ab.cd@gmail.com', 'abcd@gmail.com']);
  expect(await auth.logIn('ab.cd@gmail.com', 'password-one')).toMatchObject({ ok: true, user: { id: dotted.id } });
  expect(await auth.logIn('abcd@gmail.com', 'password-two')).toMatchObject({ ok: true, user: { id: plain.id } });
  expect(await auth.logIn('abcd@gmail.com', 'password-one')).toMatchObject({ ok: false });
});
