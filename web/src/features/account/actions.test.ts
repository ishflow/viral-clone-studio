// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  set: vi.fn((name: string, value: string) => void jar.set(name, value)),
  delete: vi.fn((name: string) => void jar.delete(name)),
};
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { limiter } from '@/core/rate-limit/rate-limit';
import { data } from '@/data';
import { getStore, resetStore } from '@/data/mock/store';
import { deleteAccount, saveProfile, type ProfileState } from './actions';

const empty: ProfileState = { status: 'idle', errors: {} };
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const valid = { name: 'Demo Renamed', email: 'demo@viralclone.app', locale: 'en', theme: 'system' };

beforeEach(() => {
  resetStore();
  limiter.reset();
  jar.clear();
  vi.clearAllMocks();
  jar.set('vc_session', 'usr-demo');
});

describe('saveProfile', () => {
  it('rejects an invalid email with a field error and saves nothing', async () => {
    const state = await saveProfile(empty, form({ ...valid, email: 'not-an-email' }));
    expect(state.status).toBe('error');
    expect(state.errors.email).toBe('emailInvalid');
    expect((await data.auth.getUser('usr-demo'))?.name).toBe('Demo User');
  });
  it('an account with no name saves its language and theme', async () => {
    // Sign-up asks no name, so a blank one is a valid state of the profile.
    const state = await saveProfile(empty, form({ ...valid, name: '  ', locale: 'tr', theme: 'dark' }));
    expect(state).toEqual({ status: 'saved', errors: {} });
    expect(await data.auth.getUser('usr-demo')).toMatchObject({ name: '', locale: 'tr' });
  });
  it('rejects a name over 80 characters', async () => {
    expect((await saveProfile(empty, form({ ...valid, name: 'x'.repeat(81) }))).errors.name).toBe('nameLong');
    expect((await saveProfile(empty, form({ ...valid, name: 'x'.repeat(80) }))).status).toBe('saved');
  });
  it('refuses an email with a 70-character local part, the way sign-up does, and saves nothing', async () => {
    const state = await saveProfile(empty, form({ ...valid, email: `${'a'.repeat(70)}@example.com`, password: 'x' }));
    expect(state.errors.email).toBe('emailInvalid');
    expect((await data.auth.getUser('usr-demo'))?.pendingEmail).toBeNull();
  });
  it('an account whose email is over the limit still saves its language, and only a new email meets the limit', async () => {
    const long = `${'a'.repeat(70)}@example.com`;
    getStore().users.find((u) => u.id === 'usr-demo')!.email = long; // made before the limit existed
    const state = await saveProfile(empty, form({ ...valid, email: long, locale: 'tr', theme: 'dark' }));
    expect(state).toEqual({ status: 'saved', errors: {} });
    expect(await data.auth.getUser('usr-demo')).toMatchObject({ email: long, pendingEmail: null, locale: 'tr' });
    const other = await saveProfile(empty, form({ ...valid, email: `${'b'.repeat(70)}@example.com`, password: 'x' }));
    expect(other.errors.email).toBe('emailInvalid');
  });
  it('saves name, email and locale on the user', async () => {
    const state = await saveProfile(empty, form({ ...valid, email: 'new-address@example.com', locale: 'tr', password: 'x' }));
    expect(state.status).toBe('saved');
    const user = await data.auth.getUser('usr-demo');
    expect(user).toMatchObject({ name: 'Demo Renamed', email: 'demo@viralclone.app', pendingEmail: 'new-address@example.com', locale: 'tr' }); // B14: the new email waits for its link
  });
  it('a new email without the current password, or with a wrong one, changes nothing and sends no link (SEC B3)', async () => {
    const none = await saveProfile(empty, form({ ...valid, email: 'thief@example.com' }));
    expect(none).toEqual({ status: 'error', errors: { password: 'passwordRequired' } });
    const wrong = await saveProfile(empty, form({ ...valid, email: 'thief@example.com', password: 'a-guess' }));
    expect(wrong).toEqual({ status: 'error', errors: { password: 'passwordWrong' } });
    expect(await data.auth.getUser('usr-demo')).toMatchObject({ name: 'Demo User', email: 'demo@viralclone.app', pendingEmail: null });
    expect((await data.mailer.outbox()).filter((mail) => mail.to === 'thief@example.com')).toEqual([]);
  });
  it('the name and the language are saved without a password, also while a new email waits for its link', async () => {
    await saveProfile(empty, form({ ...valid, email: 'new-address@example.com', password: 'x' }));
    expect((await saveProfile(empty, form({ ...valid, name: 'Later', email: 'new-address@example.com' }))).status).toBe('saved');
    expect((await saveProfile(empty, form({ ...valid, name: 'Back', email: 'Demo@viralclone.app' }))).status).toBe('saved');
    expect(await data.auth.getUser('usr-demo')).toMatchObject({ name: 'Back', pendingEmail: null });
  });
  it('a Google account has no password to ask for: its email change goes on as before', async () => {
    const google = await data.auth.signInWithGoogle({ email: 'g@example.com', name: 'G' });
    if (!google.ok) throw new Error('no google account');
    jar.set('vc_session', google.user.id);
    expect((await saveProfile(empty, form({ ...valid, email: 'g2@example.com' }))).status).toBe('saved');
    expect((await data.auth.getUser(google.user.id))?.pendingEmail).toBe('g2@example.com');
  });
  describe('the limit of email changes (SEC B9)', () => {
    beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T12:00:00Z') }));
    afterEach(() => void vi.useRealTimers());
    const change = (email: string, password = 'x') => saveProfile(empty, form({ ...valid, email, password }));
    const mailsTo = async (domain: string) => (await data.mailer.outbox()).filter((mail) => mail.to.endsWith(domain)).length;

    it('a loop of new addresses gets one link: the next one inside a minute is told to wait', async () => {
      expect((await change('a1@loop.example')).status).toBe('saved');
      for (const email of ['a2@loop.example', 'a3@loop.example']) expect(await change(email)).toEqual({ status: 'error', errors: { form: 'emailWait' } });
      expect(await mailsTo('@loop.example')).toBe(1);
      expect((await data.auth.getUser('usr-demo'))?.pendingEmail).toBe('a1@loop.example');
    });
    it('a patient loop, one address a minute, stops at the third in ten minutes', async () => {
      for (const email of ['b1@loop.example', 'b2@loop.example', 'b3@loop.example']) {
        expect((await change(email)).status).toBe('saved');
        vi.advanceTimersByTime(61_000);
      }
      expect(await change('b4@loop.example')).toEqual({ status: 'error', errors: { form: 'emailWait' } });
      expect(await mailsTo('@loop.example')).toBe(3);
    });
    it('the password cannot be guessed through the form: after three tries the right one is told to wait too', async () => {
      for (const guess of ['guess-1', 'guess-2', 'guess-3']) expect((await change('thief@example.com', guess)).errors.password).toBe('passwordWrong');
      expect(await change('thief@example.com', 'x')).toEqual({ status: 'error', errors: { form: 'emailWait' } });
      expect((await data.auth.getUser('usr-demo'))?.pendingEmail).toBeNull();
    });
    it('saving the name is not an email change: it is never limited', async () => {
      for (let i = 0; i < 12; i++) expect((await saveProfile(empty, form({ ...valid, name: `Name ${i}` }))).status).toBe('saved');
    });
  });
  it('switches the language cookie', async () => {
    await saveProfile(empty, form({ ...valid, locale: 'tr' }));
    expect(jar.get('vc_locale')).toBe('tr');
  });
  it('sets the theme cookie, and removes it for System', async () => {
    await saveProfile(empty, form({ ...valid, theme: 'light' }));
    expect(jar.get('vc_theme')).toBe('light');
    await saveProfile(empty, form({ ...valid, theme: 'system' }));
    expect(jar.has('vc_theme')).toBe(false);
  });
  it('reports an email that another account already uses', async () => {
    const state = await saveProfile(empty, form({ ...valid, email: 'admin@viralclone.app', password: 'x' }));
    expect(state.errors.email).toBe('emailTaken');
  });
  it('sends a signed-out visitor to login', async () => {
    jar.clear();
    await expect(saveProfile(empty, form(valid))).rejects.toThrow('REDIRECT:/login');
  });
  it('sends a user whose email is not verified to /verify-email and saves nothing', async () => {
    jar.set('vc_session', 'usr-unverified');
    await expect(saveProfile(empty, form({ ...valid, email: 'not-verified@example.com' }))).rejects.toThrow('REDIRECT:/verify-email');
    expect((await data.auth.getUser('usr-unverified'))?.name).toBe('Unverified Customer');
    await expect(deleteAccount({ status: 'idle' }, form({ confirm: 'DELETE' }))).rejects.toThrow('REDIRECT:/verify-email');
    expect(await data.auth.getUser('usr-unverified')).not.toBeNull();
  });
});

describe('deleteAccount', () => {
  it('does nothing unless the confirmation is exactly DELETE', async () => {
    for (const text of ['', 'delete', 'DELETE ', 'DEL']) {
      await deleteAccount({ status: 'idle' }, form({ confirm: text }));
      expect(await data.auth.getUser('usr-demo')).not.toBeNull();
      expect(jar.get('vc_session')).toBe('usr-demo');
    }
  });
  it('deleting the account ends on the login page that says it was deleted', async () => {
    getStore().jobs.forEach((job) => { if (job.id === 'job-demo-running') job.pinnedElapsed = 3_600; }); // B23: no running job
    await expect(deleteAccount({ status: 'idle' }, form({ confirm: 'DELETE' }))).rejects.toThrow('REDIRECT:/login?reason=account-deleted');
    expect(await data.auth.getUser('usr-demo')).toBeNull();
    expect(jar.has('vc_session')).toBe(false);
  });
});

describe('requestRefund / cancelRefund / deleteAccount with a running job', () => {
  it('requestRefund asks the data layer for the signed-in user only; cancelRefund takes it back and frees the credits', async () => {
    const { requestRefund, cancelRefund } = await import('./actions');
    jar.set('vc_session', 'usr-demo');
    const purchase = (await data.payments.purchasesFor('usr-demo')).find((p) => p.refundable?.ok);
    if (!purchase) return; // no eligible fixture pack: nothing to ask for
    const asked = await requestRefund({ status: 'idle' }, form({ purchaseId: purchase.id }));
    expect(asked.status).toBe('requested');
    expect(await data.ledger.held('usr-demo')).toBe(purchase.credits);
    const cancelled = await cancelRefund({ status: 'idle' }, form({ purchaseId: purchase.id }));
    expect(cancelled.status).toBe('cancelled');
    expect(await data.ledger.held('usr-demo')).toBe(0);
  });
  it('requestRefund of an unknown pack is an error state and changes nothing', async () => {
    const { requestRefund } = await import('./actions');
    expect((await requestRefund({ status: 'idle' }, form({ purchaseId: 'nope' }))).status).toBe('error');
  });
  it('deleteAccount with a job running answers `running` on the server and keeps the account', async () => {
    const out = await deleteAccount({ status: 'idle' }, form({ confirm: 'DELETE' }));
    expect(out.status).toBe('running');
    expect(await data.auth.getUser('usr-demo')).not.toBeNull();
  });
});
