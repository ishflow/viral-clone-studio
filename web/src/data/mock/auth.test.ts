// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { NotFoundError } from '../ports';
import { credentialFixtures } from './fixtures/users';
import { verifyPassword } from './password';
import { getStore, resetStore } from './store';
import { SLOW_HASHING, startConfirmed } from './test-helpers';

/** The password every fixture account has in these tests (VC_DEV_PASSWORD; the shared test setup uses another one). */
const DEV = 'dev-password-1';

const sent = async (kind: string) => (await data.mailer.outbox()).filter((email) => email.kind === kind);
const resetTokenOf = async (email: string) => {
  await data.auth.requestPasswordReset(email);
  return (await sent('reset')).find((mail) => mail.to === email)?.data.token ?? '';
};

beforeEach(() => {
  vi.stubEnv('VC_DEV_PASSWORD', DEV);
  vi.stubEnv('VC_ADMIN_PASSWORD', ''); // the admin has the dev password here, unless a test sets one
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
  getStore().jobs.forEach((job) => { if (job.id === 'job-demo-running') job.pinnedElapsed = 3_600; }); // finished: an account with a running job cannot be deleted (B23)
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('fake auth service', () => {
  it('signUp creates an unverified user without a free video and sends verify', async () => {
    const user = await data.auth.signUp('Sam@Example.com ', 'any password');
    expect(user).toMatchObject({
      email: 'sam@example.com', role: 'customer', emailVerified: false, blocked: false, freeVideoAvailable: false,
      locale: 'en', joinedAt: '2026-10-04T12:00:00.000Z',
    });
    expect(await data.auth.getUser(user.id)).toEqual(user);
    expect(await sent('verify')).toMatchObject([{ to: 'sam@example.com', data: { userId: user.id } }]);
    expect(await data.ledger.balance(user.id)).toBe(0);
  });

  it('the sign-up mail carries free 0 while the free first video is off, and for an email that had it before', async () => {
    const free = async (email: string) => (await sent('verify')).find((mail) => mail.to === email)?.data.free;
    await data.auth.signUp('on@example.com', 'x');
    expect(await free('on@example.com')).toBe('1');
    getStore().limits.freeFirstVideo = false;
    await data.auth.signUp('off@example.com', 'x');
    expect(await free('off@example.com')).toBe('0');
    getStore().limits.freeFirstVideo = true;
    const again = await data.auth.signUp('again@example.com', 'x');
    await data.auth.verifyEmail(again.id);
    await data.auth.deleteAccount(again.id);
    await data.auth.signUp('Again@example.com', 'x');
    expect((await sent('verify')).filter((mail) => mail.to === 'again@example.com').map((mail) => mail.data.free)).toEqual(['0', '1']);
  });

  it('the resent verification mail carries the same free answer as the first one', async () => {
    getStore().limits.freeFirstVideo = false;
    const user = await data.auth.signUp('off@example.com', 'x');
    vi.advanceTimersByTime(61_000);
    await data.auth.resendVerification(user.id);
    expect((await sent('verify')).map((mail) => mail.data.free)).toEqual(['0', '0']);
  });

  it('signUp with an email that is already taken throws and creates nothing', async () => {
    await expect(data.auth.signUp('DEMO@viralclone.app', 'x')).rejects.toThrow('email-taken');
    expect(getStore().users).toHaveLength(7);
    expect(await sent('verify')).toEqual([]);
  });

  it('keeps a salted hash of the password, never the password', async () => {
    const user = await data.auth.signUp('sam@example.com', 'a-very-secret-password');
    const everything = JSON.stringify({ ...getStore(), keys: [...getStore().keys] });
    expect(everything).not.toContain('secret-password');
    const mine = getStore().credentials.filter((credential) => credential.userId === user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword('a-very-secret-password', mine[0]!.hash)).toBe(true);
    // the hash does not travel with the user: no port returns it
    expect(JSON.stringify(await data.auth.getUser(user.id))).not.toContain('scrypt');
  });

  it('verifyEmail turns on emailVerified and freeVideoAvailable', async () => {
    const user = await data.auth.signUp('sam@example.com', 'x');
    const verified = await data.auth.verifyEmail(user.id);
    expect(verified).toMatchObject({ id: user.id, emailVerified: true, freeVideoAvailable: true });
    expect(await data.auth.getUser(user.id)).toEqual(verified);
  });

  it('verifyEmail a second time does not hand out a second free video', async () => {
    const user = await data.auth.signUp('sam@example.com', 'x');
    await data.auth.verifyEmail(user.id);
    const stored = getStore().users.find((item) => item.id === user.id);
    if (stored) stored.freeVideoAvailable = false; // the free video was used
    expect(await data.auth.verifyEmail(user.id)).toMatchObject({ emailVerified: true, freeVideoAvailable: false });
    await expect(data.auth.verifyEmail('nobody')).rejects.toThrow(NotFoundError);
  });

  it('logIn returns the user for the right password, whatever the letter case of the email', async () => {
    const result = await data.auth.logIn(' Demo@ViralClone.app', DEV);
    expect(result).toMatchObject({ ok: true, user: { id: 'usr-demo', email: 'demo@viralclone.app', lastActiveAt: '2026-10-04T12:00:00.000Z' } });
  });

  it('logIn says blocked for a blocked user (B14)', async () => {
    expect(await data.auth.logIn('blocked@example.com', DEV)).toEqual({ ok: false, reason: 'blocked', retryAfter: null });
  });

  it('logIn says invalid for an unknown email', async () => {
    expect(await data.auth.logIn('nobody@example.com', 'x')).toEqual({ ok: false, reason: 'invalid', retryAfter: null });
  });

  it('requestPasswordReset sends reset to a known email', async () => {
    await data.auth.requestPasswordReset('demo@viralclone.app');
    expect(await sent('reset')).toMatchObject([{ to: 'demo@viralclone.app', data: { email: 'demo@viralclone.app' } }]);
  });

  it('requestPasswordReset for an unknown email sends nothing and does not throw', async () => {
    await expect(data.auth.requestPasswordReset('nobody@example.com')).resolves.toEqual({ sent: true, retryAfter: 60 });
    expect(await data.mailer.outbox()).toEqual([]);
  });

  it('requestPasswordReset forgets an address once its wait is over: made-up addresses cannot fill the store', async () => {
    for (let i = 0; i < 50; i++) await data.auth.requestPasswordReset(`ghost-${i}@example.com`);
    vi.advanceTimersByTime(61_000);
    await data.auth.requestPasswordReset('ghost-last@example.com');
    expect(getStore().cooldowns.map((item) => item.key)).toEqual(['reset:ghost-last@example.com']);
  });

  it('requestPasswordReset inside the wait is refused with the seconds left, the same for a known and an unknown address', async () => {
    await data.auth.requestPasswordReset('demo@viralclone.app');
    await data.auth.requestPasswordReset('nobody@example.com');
    vi.advanceTimersByTime(20_000);
    expect(await data.auth.requestPasswordReset('demo@viralclone.app')).toEqual({ sent: false, retryAfter: 40 });
    expect(await data.auth.requestPasswordReset('nobody@example.com')).toEqual({ sent: false, retryAfter: 40 });
    vi.advanceTimersByTime(40_000);
    expect(await data.auth.requestPasswordReset('demo@viralclone.app')).toEqual({ sent: true, retryAfter: 60 });
  });

  it('resetPassword (no link) does not throw, and changes no password: anyone can send an email address', async () => {
    await expect(data.auth.resetPassword('demo@viralclone.app', 'new password')).resolves.toBeUndefined();
    await expect(data.auth.resetPassword('nobody@example.com', 'new password')).resolves.toBeUndefined();
    expect(await data.auth.logIn('demo@viralclone.app', 'new password')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await data.auth.logIn('demo@viralclone.app', DEV)).toMatchObject({ ok: true });
  });

  it('getUser returns null for an unknown id, and a copy for a known one', async () => {
    expect(await data.auth.getUser('nobody')).toBeNull();
    const user = await data.auth.getUser('usr-demo');
    if (user) user.role = 'admin';
    expect((await data.auth.getUser('usr-demo'))?.role).toBe('customer');
  });

  it('the fixtures hold the three named accounts and four more customers', async () => {
    expect(await data.auth.getUser('usr-demo')).toMatchObject({ email: 'demo@viralclone.app', role: 'customer', emailVerified: true, freeVideoAvailable: false });
    expect(await data.auth.getUser('usr-new')).toMatchObject({ email: 'new@viralclone.app', role: 'customer', emailVerified: true, freeVideoAvailable: true });
    expect(await data.auth.getUser('usr-admin')).toMatchObject({ email: 'admin@viralclone.app', role: 'admin' });
    expect(await data.auth.getUser('usr-unverified')).toMatchObject({ emailVerified: false, freeVideoAvailable: false });
    expect(await data.auth.getUser('usr-blocked')).toMatchObject({ blocked: true });
    expect(getStore().users.filter((user) => user.role === 'customer')).toHaveLength(6);
  });

  it('updateProfile changes the name and the language at once; a new email waits for its link (B14)', async () => {
    const user = await data.auth.updateProfile('usr-demo', { name: 'New Name', email: 'New@Example.com', locale: 'tr' });
    expect(user).toMatchObject({ id: 'usr-demo', name: 'New Name', email: 'demo@viralclone.app', pendingEmail: 'new@example.com', locale: 'tr' });
    expect(await data.auth.getUser('usr-demo')).toEqual(user);
    expect(await data.auth.logIn('new@example.com', 'x')).toMatchObject({ ok: false, reason: 'invalid' });
    const [email] = await sent('verify');
    expect(email).toMatchObject({ to: 'new@example.com', data: { userId: 'usr-demo', purpose: 'email-change' } });
    expect(await data.auth.confirmEmailLink(email?.data.token ?? '', null)).toMatchObject({ ok: true, purpose: 'email-change', user: { email: 'new@example.com', pendingEmail: null } });
    expect(await data.auth.logIn('new@example.com', DEV)).toMatchObject({ ok: true });
    expect(await data.auth.confirmEmailLink(email?.data.token ?? '', null)).toEqual({ ok: false, reason: 'used' });
  });

  it('updateProfile refuses an email that another account uses, and an unknown user', async () => {
    await expect(data.auth.updateProfile('usr-demo', { email: 'new@viralclone.app' })).rejects.toThrow('email-taken');
    expect((await data.auth.getUser('usr-demo'))?.email).toBe('demo@viralclone.app');
    await expect(data.auth.updateProfile('usr-demo', { email: 'demo@viralclone.app', name: 'Same email' })).resolves.toMatchObject({ name: 'Same email' });
    await expect(data.auth.updateProfile('nobody', { name: 'x' })).rejects.toThrow(NotFoundError);
  });

  it('deleteAccount removes the user, their jobs and private templates', async () => {
    const mine = await data.catalog.addFromLink('usr-demo', 'https://www.tiktok.com/@someone/video/1');
    const theirs = await data.catalog.addFromLink('usr-paying', 'https://www.tiktok.com/@someone/video/2');
    expect(await data.jobs.listFor('usr-demo')).not.toHaveLength(0);

    await data.auth.deleteAccount('usr-demo');

    expect(await data.auth.getUser('usr-demo')).toBeNull();
    expect(await data.auth.logIn('demo@viralclone.app', DEV)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(getStore().credentials.some((credential) => credential.userId === 'usr-demo')).toBe(false);
    expect(await data.jobs.listFor('usr-demo')).toEqual([]);
    expect(getStore().jobs.some((job) => job.userId === 'usr-demo')).toBe(false);
    expect(await data.admin.template(mine.id)).toBeNull();
    expect(await data.admin.template(theirs.id)).not.toBeNull();
    expect(await data.admin.templates({})).toHaveLength(7);
  });

  it('deleteAccount removes only the private templates: one the admin published stays in the gallery', async () => {
    await data.admin.updateTemplate('tpl-own-ready', { status: 'published' });
    await data.auth.deleteAccount('usr-demo');
    expect((await data.catalog.get('tpl-own-ready'))?.ownerId).toBe('usr-demo');
    expect(await data.admin.template('tpl-own-failed')).toBeNull();
  });

  it('deleteAccount removes the idempotency keys and the open checkouts of the user', async () => {
    const input = { templateId: 'tpl-layering', products: [], quality: 'fast' as const, variants: 1 as const, language: 'en' };
    await startConfirmed('usr-paying', input, 'key-1');
    await startConfirmed('usr-demo', input, 'key-1');
    await data.admin.addCredits('usr-admin', 'usr-paying', 5, 'Test', 'key-1');
    const open = await data.payments.startCheckout('usr-paying', 'pack-starter', '/gallery');
    const settled = await data.payments.startCheckout('usr-paying', 'pack-starter', '/gallery');
    await data.payments.complete(settled.checkoutId, 'paid');
    const others = await data.payments.startCheckout('usr-demo', 'pack-starter', '/gallery');
    vi.advanceTimersByTime(60_000); // the jobs are done (B23)

    await data.auth.deleteAccount('usr-paying');

    expect([...getStore().keys.keys()].filter((key) => key.includes('usr-paying'))).toEqual([]);
    expect([...getStore().keys.keys()].filter((key) => key.includes('usr-demo'))).toHaveLength(1);
    expect(getStore().checkouts.map((checkout) => checkout.id).sort()).toEqual([settled.checkoutId, others.checkoutId].sort());
    await expect(data.payments.complete(open.checkoutId, 'paid')).rejects.toThrow(NotFoundError);
    expect((await data.payments.complete(others.checkoutId, 'paid')).status).toBe('paid');
  });

  it('after deleteAccount of a paying user, the overview never counts more paying users than users', async () => {
    for (const id of ['usr-demo', 'usr-paying', 'usr-blocked', 'usr-free', 'usr-new', 'usr-unverified']) {
      await data.auth.deleteAccount(id);
      const overview = await data.admin.overview('all');
      expect(overview.payingUsers).toBeLessThanOrEqual(overview.users);
    }
    expect(await data.admin.overview('all')).toMatchObject({ users: 1, payingUsers: 0 });
  });

  it('deleteAccount keeps the invoices and the credit history, and leaves other accounts alone', async () => {
    const ledgerBefore = getStore().ledger.length;
    await data.auth.deleteAccount('usr-demo');
    expect(getStore().invoices.some((invoice) => invoice.userId === 'usr-demo')).toBe(true);
    expect(getStore().ledger).toHaveLength(ledgerBefore);
    expect(getStore().users).toHaveLength(6);
    expect(await data.jobs.listFor('usr-paying')).not.toHaveLength(0);
    await expect(data.auth.deleteAccount('nobody')).resolves.toBeUndefined();
  });
});


describe('passwords (C1)', () => {
  const INVALID = { ok: false, reason: 'invalid', retryAfter: null };

  it('the wrong password is refused; an unknown email and a wrong password give the very same answer', async () => {
    const wrong = await data.auth.logIn('demo@viralclone.app', 'not-the-password');
    const unknown = await data.auth.logIn('nobody@example.com', 'not-the-password');
    expect(wrong).toEqual(INVALID);
    expect(unknown).toEqual(wrong);
    expect(await data.auth.logIn('demo@viralclone.app', '')).toEqual(INVALID);
    expect(await data.auth.logIn('admin@viralclone.app', 'admin')).toEqual(INVALID);
  });

  it('the admin\'s id and email are in the fixtures but are no way in without the password', async () => {
    expect(await data.auth.logIn('admin@viralclone.app', 'anything')).toEqual(INVALID);
    expect(await data.auth.logIn('admin@viralclone.app', DEV)).toMatchObject({ ok: true, user: { id: 'usr-admin', role: 'admin' } });
  });

  it('in fake mode the documented demo password works without any env: demo-password', async () => {
    vi.stubEnv('VC_DEV_PASSWORD', '');
    resetStore();
    expect(await data.auth.logIn('demo@viralclone.app', 'demo-password')).toMatchObject({ ok: true, user: { id: 'usr-demo' } });
    expect(await data.auth.logIn('demo@viralclone.app', 'wrong-password')).toEqual(INVALID);
  });

  it('VC_DEV_PASSWORD changes the demo password; VC_ADMIN_PASSWORD sets the admin\'s alone', async () => {
    vi.stubEnv('VC_ADMIN_PASSWORD', 'the-admin-password-12');
    resetStore();
    expect(await data.auth.logIn('demo@viralclone.app', DEV)).toMatchObject({ ok: true });
    expect(await data.auth.logIn('admin@viralclone.app', DEV)).toEqual(INVALID);
    expect(await data.auth.logIn('admin@viralclone.app', 'the-admin-password-12')).toMatchObject({ ok: true, user: { role: 'admin' } });
  });

  it('every fixture account has its own salt', () => {
    const hashes = getStore().credentials.map((credential) => credential.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(getStore().credentials.map((credential) => credential.userId).sort()).toEqual(getStore().users.map((user) => user.id).sort());
  });

  it('a wrong password counts toward the attempts limit: 5 failures lock the email, also for the right password', async () => {
    for (let i = 0; i < 4; i += 1) expect(await data.auth.logIn('demo@viralclone.app', 'wrong')).toEqual(INVALID);
    expect(await data.auth.logIn('demo@viralclone.app', 'wrong')).toEqual({ ok: false, reason: 'too-many', retryAfter: 900 });
    expect(await data.auth.logIn('demo@viralclone.app', DEV)).toMatchObject({ ok: false, reason: 'too-many' });
  });

  it('a stranger\'s five wrong guesses lock the stranger, not the owner who comes from elsewhere (SEC B2)', async () => {
    for (let i = 0; i < 4; i += 1) expect(await data.auth.logIn('demo@viralclone.app', 'wrong', '6.6.6.6')).toEqual(INVALID);
    expect(await data.auth.logIn('demo@viralclone.app', 'wrong', '6.6.6.6')).toEqual({ ok: false, reason: 'too-many', retryAfter: 900 });
    expect(await data.auth.logIn('demo@viralclone.app', DEV, '6.6.6.6')).toMatchObject({ ok: false, reason: 'too-many' });
    expect(await data.auth.logIn('demo@viralclone.app', DEV, '1.2.3.4')).toMatchObject({ ok: true, user: { id: 'usr-demo' } });
    expect(await data.auth.logIn('demo@viralclone.app', DEV, '6.6.6.6')).toMatchObject({ ok: false, reason: 'too-many' }); // the owner's log-in frees nobody else
  });

  it('guessing from many callers stops at the ceiling of the email: 20 failures lock it for everybody, for 15 minutes', SLOW_HASHING, async () => {
    for (const caller of ['6.6.6.1', '6.6.6.2', '6.6.6.3', '6.6.6.4']) {
      expect(await data.auth.logIn('demo@viralclone.app', DEV, '1.2.3.4')).toMatchObject({ ok: true });
      for (let i = 0; i < 5; i += 1) await data.auth.logIn('demo@viralclone.app', 'wrong', caller);
    }
    expect(await data.auth.logIn('demo@viralclone.app', DEV, '1.2.3.4')).toEqual({ ok: false, reason: 'too-many', retryAfter: 900 });
    vi.advanceTimersByTime(15 * 60_000);
    expect(await data.auth.logIn('demo@viralclone.app', DEV, '1.2.3.4')).toMatchObject({ ok: true });
  });

  it('a right password clears the failures of its own caller only', async () => {
    for (let i = 0; i < 3; i += 1) await data.auth.logIn('demo@viralclone.app', 'wrong', '1.2.3.4');
    for (let i = 0; i < 4; i += 1) await data.auth.logIn('demo@viralclone.app', 'wrong', '6.6.6.6');
    await data.auth.logIn('demo@viralclone.app', DEV, '1.2.3.4');
    for (let i = 0; i < 4; i += 1) expect(await data.auth.logIn('demo@viralclone.app', 'wrong', '1.2.3.4')).toEqual(INVALID);
    expect(await data.auth.logIn('demo@viralclone.app', 'wrong', '6.6.6.6')).toMatchObject({ reason: 'too-many' });
  });

  it('a right password clears the failures', async () => {
    for (let i = 0; i < 3; i += 1) await data.auth.logIn('demo@viralclone.app', 'wrong');
    await data.auth.logIn('demo@viralclone.app', DEV);
    for (let i = 0; i < 4; i += 1) expect(await data.auth.logIn('demo@viralclone.app', 'wrong')).toEqual(INVALID);
  });

  it('a blocked account says blocked only for its own password: the wrong one says invalid', async () => {
    expect(await data.auth.logIn('blocked@example.com', 'wrong')).toEqual(INVALID);
    expect(await data.auth.logIn('blocked@example.com', DEV)).toMatchObject({ ok: false, reason: 'blocked' });
  });

  it('signUp stores the password: the new account logs in with it and with nothing else', async () => {
    const user = await data.auth.signUp('Sam@Example.com', 'sam-password-1');
    expect(await data.auth.logIn('sam@example.com', 'sam-password-1')).toMatchObject({ ok: true, user: { id: user.id } });
    expect(await data.auth.logIn('sam@example.com', DEV)).toEqual(INVALID);
    expect(await data.auth.logIn('sam@example.com', 'sam-password-2')).toEqual(INVALID);
  });

  it('a Google account has no password: the empty and any other password refuse it', async () => {
    await data.auth.signInWithGoogle({ email: 'g@example.com', name: 'G' });
    expect(await data.auth.logIn('g@example.com', '')).toEqual(INVALID);
    expect(await data.auth.logIn('g@example.com', DEV)).toEqual(INVALID);
  });

  it('a reset link sets a new password and the old one stops working', async () => {
    await data.auth.requestPasswordReset('demo@viralclone.app');
    const token = (await data.mailer.outbox())[0]?.data.token ?? '';
    expect(await data.auth.resetPasswordWithLink(token, 'brand-new-password')).toEqual({ ok: true, email: 'demo@viralclone.app' });
    expect(await data.auth.logIn('demo@viralclone.app', DEV)).toEqual(INVALID);
    expect(await data.auth.logIn('demo@viralclone.app', 'brand-new-password')).toMatchObject({ ok: true });
  });

  it('five wrong passwords lock the email; a password set with the reset link unlocks it at once: the new password logs in, for the same caller and for another caller', async () => {
    for (let i = 0; i < 5; i += 1) await data.auth.logIn('demo@viralclone.app', 'wrong', '6.6.6.6');
    expect(await data.auth.logIn('demo@viralclone.app', DEV, '6.6.6.6')).toMatchObject({ ok: false, reason: 'too-many' });
    for (let i = 0; i < 5; i += 1) await data.auth.logIn('demo@viralclone.app', 'wrong');
    await data.auth.requestPasswordReset('demo@viralclone.app');
    const token = (await data.mailer.outbox())[0]?.data.token ?? '';
    expect(await data.auth.resetPasswordWithLink(token, 'brand-new-password')).toEqual({ ok: true, email: 'demo@viralclone.app' });
    expect(await data.auth.logIn('demo@viralclone.app', 'brand-new-password', '6.6.6.6')).toMatchObject({ ok: true, user: { id: 'usr-demo' } });
    expect(await data.auth.logIn('demo@viralclone.app', 'brand-new-password', '1.2.3.4')).toMatchObject({ ok: true });
    expect(await data.auth.logIn('demo@viralclone.app', 'brand-new-password')).toMatchObject({ ok: true });
  });

  it('the reset of one email leaves the failed tries of another email', async () => {
    for (let i = 0; i < 5; i += 1) await data.auth.logIn('blocked@example.com', 'wrong', '6.6.6.6');
    for (let i = 0; i < 5; i += 1) await data.auth.logIn('demo@viralclone.app', 'wrong');
    await data.auth.requestPasswordReset('demo@viralclone.app');
    const token = (await data.mailer.outbox())[0]?.data.token ?? '';
    await data.auth.resetPasswordWithLink(token, 'brand-new-password');
    expect(await data.auth.logIn('blocked@example.com', DEV, '6.6.6.6')).toMatchObject({ ok: false, reason: 'too-many' });
  });

  it('the reset of an email does not unlock another email it is a prefix of (a@x.co and a@x.com)', SLOW_HASHING, async () => {
    await data.auth.signUp('a@x.co', 'password-1');
    await data.auth.signUp('a@x.com', 'password-2');
    for (let i = 0; i < 5; i += 1) await data.auth.logIn('a@x.com', 'wrong', '6.6.6.6');
    for (let i = 0; i < 5; i += 1) await data.auth.logIn('a@x.com', 'wrong');
    for (let i = 0; i < 5; i += 1) await data.auth.logIn('a@x.co', 'wrong', '6.6.6.6');
    expect(await data.auth.resetPasswordWithLink(await resetTokenOf('a@x.co'), 'brand-new-1')).toMatchObject({ ok: true });
    expect(await data.auth.logIn('a@x.com', 'password-2', '6.6.6.6')).toMatchObject({ ok: false, reason: 'too-many' });
    expect(await data.auth.logIn('a@x.com', 'password-2')).toMatchObject({ ok: false, reason: 'too-many' });
    expect(await data.auth.logIn('a@x.co', 'brand-new-1', '6.6.6.6')).toMatchObject({ ok: true });
  });

  it('only a good, unused link of the same account unlocks it: a request alone, a made-up, another account\'s, an expired and a used link do not', SLOW_HASHING, async () => {
    const lockDemo = async () => { for (let i = 0; i < 5; i += 1) await data.auth.logIn('demo@viralclone.app', 'wrong', '6.6.6.6'); };
    const stillLocked = async () => expect(await data.auth.logIn('demo@viralclone.app', DEV, '6.6.6.6')).toMatchObject({ ok: false, reason: 'too-many' });
    await lockDemo();
    const expiring = await resetTokenOf('demo@viralclone.app');
    await stillLocked(); // the request alone
    expect(await data.auth.resetPasswordWithLink('made-up', 'brand-new-1')).toMatchObject({ ok: false });
    await stillLocked();
    await data.auth.signUp('other@example.com', 'password-1');
    expect(await data.auth.resetPasswordWithLink(await resetTokenOf('other@example.com'), 'brand-new-2')).toMatchObject({ ok: true });
    await stillLocked(); // another account's link
    vi.advanceTimersByTime(61 * 60_000); // the link (1 hour) and the first lock (15 minutes) are over
    await lockDemo();
    expect(await data.auth.resetPasswordWithLink(expiring, 'brand-new-3')).toMatchObject({ ok: false, reason: 'expired' });
    await stillLocked();
    const fresh = await resetTokenOf('demo@viralclone.app');
    expect(await data.auth.resetPasswordWithLink(fresh, 'brand-new-4')).toMatchObject({ ok: true });
    await lockDemo();
    expect(await data.auth.resetPasswordWithLink(fresh, 'brand-new-5')).toMatchObject({ ok: false, reason: 'used' });
    await stillLocked(); // a used link
  });

  it('after a reset the lock rule is the same: 5 own wrong passwords lock again for 15 minutes, and another caller is free', async () => {
    for (let i = 0; i < 5; i += 1) await data.auth.logIn('demo@viralclone.app', 'wrong', '6.6.6.6');
    await data.auth.resetPasswordWithLink(await resetTokenOf('demo@viralclone.app'), 'brand-new-1');
    for (let i = 0; i < 4; i += 1) expect(await data.auth.logIn('demo@viralclone.app', 'wrong', '6.6.6.6')).toEqual(INVALID);
    expect(await data.auth.logIn('demo@viralclone.app', 'wrong', '6.6.6.6')).toEqual({ ok: false, reason: 'too-many', retryAfter: 900 });
    expect(await data.auth.logIn('demo@viralclone.app', 'brand-new-1', '1.2.3.4')).toMatchObject({ ok: true });
  });

  it('a reset link that is used, expired or made up changes nothing', async () => {
    await data.auth.requestPasswordReset('demo@viralclone.app');
    const token = (await data.mailer.outbox())[0]?.data.token ?? '';
    await data.auth.resetPasswordWithLink(token, 'first-new-password');
    expect(await data.auth.resetPasswordWithLink(token, 'second-new-password')).toEqual({ ok: false, reason: 'used' });
    expect(await data.auth.resetPasswordWithLink('made-up', 'third-new-password')).toEqual({ ok: false, reason: 'invalid' });
    expect(await data.auth.logIn('demo@viralclone.app', 'first-new-password')).toMatchObject({ ok: true });
  });

  it('an email change keeps the password and the verified flag only once the new address is confirmed', async () => {
    await data.auth.updateProfile('usr-demo', { email: 'taken-over@example.com' });
    expect((await data.auth.getUser('usr-demo'))).toMatchObject({ email: 'demo@viralclone.app', pendingEmail: 'taken-over@example.com', emailVerified: true });
    const [mail] = await sent('verify');
    await data.auth.confirmEmailLink(mail?.data.token ?? '', null);
    expect(await data.auth.logIn('taken-over@example.com', DEV)).toMatchObject({ ok: true });
  });

  it('checkPassword says yes to the password of the account only; a Google account and an unknown user have none', async () => {
    expect(await data.auth.checkPassword('usr-demo', DEV)).toBe(true);
    expect(await data.auth.checkPassword('usr-demo', 'not-the-password')).toBe(false);
    expect(await data.auth.checkPassword('usr-demo', '')).toBe(false);
    const google = await data.auth.signInWithGoogle({ email: 'g@example.com', name: 'G' });
    expect(google.ok && await data.auth.checkPassword(google.user.id, '')).toBe(false);
    expect(await data.auth.checkPassword('nobody', DEV)).toBe(false);
  });

  it('a password reset cancels a pending email change: its link no longer takes the account over (SEC B3)', async () => {
    await data.auth.updateProfile('usr-demo', { email: 'thief@example.com' });
    const change = (await sent('verify'))[0]?.data.token ?? '';
    await data.auth.requestPasswordReset('demo@viralclone.app');
    await data.auth.resetPasswordWithLink((await sent('reset'))[0]?.data.token ?? '', 'the-owner-is-back');
    expect(await data.auth.getUser('usr-demo')).toMatchObject({ email: 'demo@viralclone.app', pendingEmail: null });
    expect(await data.auth.confirmEmailLink(change, null)).toEqual({ ok: false, reason: 'used' });
    expect(await data.auth.getUser('usr-demo')).toMatchObject({ email: 'demo@viralclone.app', pendingEmail: null });
    expect(await data.auth.logIn('thief@example.com', 'the-owner-is-back')).toMatchObject({ ok: false });
  });

  it('a confirmed email change ends every session that was open (SEC B3)', async () => {
    await data.auth.updateProfile('usr-demo', { email: 'moved@example.com' });
    expect((await data.auth.getUser('usr-demo'))?.sessionVersion ?? 0).toBe(0);
    await data.auth.confirmEmailLink((await sent('verify'))[0]?.data.token ?? '', null);
    expect(await data.auth.getUser('usr-demo')).toMatchObject({ email: 'moved@example.com', sessionVersion: 1 });
  });

  it('one new address a minute: a second one inside the wait is refused, sends nothing and saves nothing (SEC B9)', async () => {
    await data.auth.updateProfile('usr-demo', { email: 'first@example.com' });
    await expect(data.auth.updateProfile('usr-demo', { email: 'second@example.com', name: 'Not saved' })).rejects.toThrow('email-change-wait');
    expect(await data.auth.getUser('usr-demo')).toMatchObject({ name: 'Demo User', pendingEmail: 'first@example.com' });
    expect(await sent('verify')).toHaveLength(1);
    // the name alone is no email: it is saved at once, any number of times
    await data.auth.updateProfile('usr-demo', { name: 'One' });
    expect(await data.auth.updateProfile('usr-demo', { name: 'Two', email: 'first@example.com' })).toMatchObject({ name: 'Two' });
    vi.advanceTimersByTime(60_000);
    expect(await data.auth.updateProfile('usr-demo', { email: 'second@example.com' })).toMatchObject({ pendingEmail: 'second@example.com' });
    expect(await sent('verify')).toHaveLength(2);
  });

  it('a new email-change link uses up the earlier ones, also the one of the same address (SEC B9)', async () => {
    const linkTo = async (email: string) => {
      await data.auth.updateProfile('usr-demo', { email });
      vi.advanceTimersByTime(61_000);
      return (await sent('verify'))[0]?.data.token ?? '';
    };
    const first = await linkTo('one@example.com');
    await linkTo('two@example.com');
    const last = await linkTo('one@example.com');
    expect(await data.auth.confirmEmailLink(first, null)).toEqual({ ok: false, reason: 'used' });
    expect(await data.auth.confirmEmailLink(last, null)).toMatchObject({ ok: true, purpose: 'email-change', user: { email: 'one@example.com' } });
  });

  it('endSessions moves the session version of that user on, and is quiet for an unknown one', async () => {
    await data.auth.endSessions('usr-demo');
    await data.auth.endSessions('usr-demo');
    await data.auth.endSessions('nobody');
    expect((await data.auth.getUser('usr-demo'))?.sessionVersion).toBe(2);
    expect((await data.auth.getUser('usr-admin'))?.sessionVersion ?? 0).toBe(0);
  });

  it('a verification link ends no session: the person who just signed up stays signed in', async () => {
    const user = await data.auth.signUp('sam@example.com', 'a-password');
    await data.auth.confirmEmailLink((await sent('verify'))[0]?.data.token ?? '', user.id);
    expect(await data.auth.getUser(user.id)).toMatchObject({ emailVerified: true });
    expect((await data.auth.getUser(user.id))?.sessionVersion ?? 0).toBe(0);
  });
});

describe('seeding the passwords (credentialFixtures)', () => {
  const users = () => getStore().users;
  const loginWith = async (credentials: { userId: string; hash: string }[], id: string, password: string) => {
    const credential = credentials.find((item) => item.userId === id);
    return credential ? verifyPassword(password, credential.hash) : false;
  };

  it('fake mode, no env: every account gets the documented default', async () => {
    const credentials = credentialFixtures(users(), {});
    expect(await loginWith(credentials, 'usr-admin', 'demo-password')).toBe(true);
    expect(await loginWith(credentials, 'usr-demo', 'demo-password')).toBe(true);
  });

  it('with the real engine (sqlite) the admin password must come from VC_ADMIN_PASSWORD: no default, no seed without it', () => {
    expect(() => credentialFixtures(users(), { VC_ENGINE: 'sqlite' })).toThrow('admin-password-required');
    expect(() => credentialFixtures(users(), { VC_ENGINE: 'sqlite', VC_DEV_PASSWORD: 'demo-password' })).toThrow('admin-password-required');
    expect(() => credentialFixtures(users(), { VC_ENGINE: 'sqlite', VC_ADMIN_PASSWORD: 'too-short' })).toThrow('admin-password-too-short');
  });

  it('in paid mode too, whatever the engine', () => {
    expect(() => credentialFixtures(users(), { VC_PROVIDER: 'magnific' })).toThrow('admin-password-required');
  });

  it('sqlite with VC_ADMIN_PASSWORD: the admin can log in; the demo accounts have no password at all', async () => {
    const credentials = credentialFixtures(users(), { VC_ENGINE: 'sqlite', VC_ADMIN_PASSWORD: 'the-admin-password-12' });
    expect(credentials.map((credential) => credential.userId)).toEqual(['usr-admin']);
    expect(await loginWith(credentials, 'usr-admin', 'the-admin-password-12')).toBe(true);
    expect(await loginWith(credentials, 'usr-admin', 'demo-password')).toBe(false);
  });

  it('sqlite with an explicit VC_DEV_PASSWORD: the demo accounts get it, the admin does not', async () => {
    const credentials = credentialFixtures(users(), { VC_ENGINE: 'sqlite', VC_ADMIN_PASSWORD: 'the-admin-password-12', VC_DEV_PASSWORD: 'explicit-dev-pw' });
    expect(await loginWith(credentials, 'usr-demo', 'explicit-dev-pw')).toBe(true);
    expect(await loginWith(credentials, 'usr-admin', 'explicit-dev-pw')).toBe(false);
  });
});
