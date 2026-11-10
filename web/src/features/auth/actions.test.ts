import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  set: vi.fn((name: string, value: string) => void jar.set(name, value)),
  delete: vi.fn((name: string) => void jar.delete(name)),
};
let forwardedFor: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
  headers: async () => new Headers(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { data } from '@/data';
import { getStore, resetStore } from '@/data/mock/store';
import { SLOW_HASHING } from '@/data/mock/test-helpers';
import { limiter } from '@/core/rate-limit/rate-limit';
import { getSessionUser, SESSION_COOKIE } from '@/core/session/session';
import { GET as openVerifyLink } from '@/app/(auth)/verify-email/confirm/route';
import { confirmEmail, logIn, logInWithGoogle, requestReset, resendReset, resendVerification, resetPassword, signUp, signUpWithAnotherEmail } from './actions';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const redirected = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith('REDIRECT:')) return m.slice('REDIRECT:'.length);
    throw e;
  }
  return null;
};

beforeEach(() => {
  limiter.reset();
  resetStore();
  jar.clear();
  vi.clearAllMocks();
});

describe('signUp', () => {
  it('rejects an invalid email: field error, no session, no user', async () => {
    const out = await signUp(null, form({ email: 'nope', password: 'longenough' }));
    expect(out?.fieldErrors?.email).toBe('invalid-email');
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
  it('a 70-character local part is refused at sign up with the invalid-email answer and no account is made', async () => {
    const users = getStore().users.length;
    const out = await signUp(null, form({ email: `${'a'.repeat(70)}@example.com`, password: 'longenough' }));
    expect(out?.fieldErrors?.email).toBe('invalid-email');
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(getStore().users).toHaveLength(users);
    await expect(signUp(null, form({ email: `${'a'.repeat(64)}@example.com`, password: 'longenough' }))).rejects.toThrow('REDIRECT:/verify-email'); // 64 is still fine
  });
  it('an address over 254 characters is refused as well, even with a short local part', async () => {
    const out = await signUp(null, form({ email: `a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(63)}.com`, password: 'longenough' }));
    expect(out?.fieldErrors?.email).toBe('invalid-email');
  });
  it('rejects a short password: field error, no session', async () => {
    const out = await signUp(null, form({ email: 'short@example.com', password: '1234567' }));
    expect(out?.fieldErrors?.password).toBe('password-short');
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
  it('puts the error on the email when it is already registered', async () => {
    const demo = await data.auth.getUser('usr-demo');
    const out = await signUp(null, form({ email: demo!.email, password: 'longenough' }));
    expect(out?.fieldErrors?.email).toBe('email-taken');
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
  it('creates the account, starts the session and goes to /verify-email', async () => {
    const to = await redirected(() => signUp(null, form({ email: 'fresh@example.com', password: 'longenough' })));
    expect(to).toBe('/verify-email');
    const id = jar.get(SESSION_COOKIE)!;
    const user = await data.auth.getUser(id);
    expect(user?.email).toBe('fresh@example.com');
    expect(user?.emailVerified).toBe(false);
  });
  it('signUp then confirmEmail verifies the user, gives the free video and lands on /welcome', async () => {
    await redirected(() => signUp(null, form({ email: 'flow@example.com', password: 'longenough' })));
    const to = await redirected(() => confirmEmail());
    expect(to).toBe('/welcome');
    const user = await data.auth.getUser(jar.get(SESSION_COOKIE)!);
    expect(user?.emailVerified).toBe(true);
    expect(user?.freeVideoAvailable).toBe(true);
  });
});

describe('signUp by invitation (real mail with a guest list in VC_MAIL_ALLOW)', () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries({ VC_MAIL: 'resend', RESEND_API_KEY: 'test-placeholder', MAIL_FROM: 'no-reply@ishflow.com', VC_MAIL_ALLOW: 'guest@example.com' })) vi.stubEnv(name, value);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    forwardedFor = undefined;
  });

  it('an address that is not on the list opens no account: the form says "by invitation", no user, no session, no mail', async () => {
    const users = getStore().users.length;
    const mails = (await data.mailer.outbox()).length;
    const out = await signUp(null, form({ email: 'stranger@example.com', password: 'longenough' }));
    expect(out).toEqual({ form: 'invite-only', email: 'stranger@example.com' });
    expect(getStore().users).toHaveLength(users);
    expect(await data.mailer.outbox()).toHaveLength(mails);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
  it('the answer does not say whether the address has an account: an existing account outside the list gets the same one as a stranger', async () => {
    const demo = await data.auth.getUser('usr-demo');
    const taken = await signUp(null, form({ email: demo!.email, password: 'longenough' }));
    const unknown = await signUp(null, form({ email: 'nobody@example.com', password: 'longenough' }));
    expect(taken).toEqual({ form: 'invite-only', email: demo!.email });
    expect({ ...unknown, email: undefined }).toEqual({ ...taken, email: undefined });
  });
  it('an invited address opens its account as before, whatever the capitals', async () => {
    expect(await redirected(() => signUp(null, form({ email: 'Guest@Example.com', password: 'longenough' })))).toBe('/verify-email');
    expect((await data.auth.getUser(jar.get(SESSION_COOKIE)!))?.emailVerified).toBe(false);
  });
  it('asking is counted like any sign-up: the list cannot be read out without end', async () => {
    for (let i = 0; i < 50; i++) expect((await signUp(null, form({ email: `probe-${i}@example.com`, password: 'longenough' })))?.form).toBe('invite-only');
    expect((await signUp(null, form({ email: 'guest@example.com', password: 'longenough' })))?.form).toBe('rate-limited');
  });
  it('somebody with many addresses cannot read the list out either: past the ceiling of all callers together a guest and a stranger get the same "too many attempts", and no account is opened', async () => {
    vi.stubEnv('VC_TRUST_PROXY', '1');
    for (let i = 0; i < 50; i++) {
      forwardedFor = `7.7.7.${i}`;
      expect((await signUp(null, form({ email: `probe-${i}@example.com`, password: 'longenough' })))?.form).toBe('invite-only');
    }
    forwardedFor = '1.2.3.4';
    const users = getStore().users.length;
    expect(await signUp(null, form({ email: 'guest@example.com', password: 'longenough' }))).toEqual({ form: 'rate-limited', email: 'guest@example.com' });
    expect(await signUp(null, form({ email: 'stranger@example.com', password: 'longenough' }))).toEqual({ form: 'rate-limited', email: 'stranger@example.com' });
    expect(getStore().users).toHaveLength(users);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
  it('with `*` on the list everyone is invited', async () => {
    vi.stubEnv('VC_MAIL_ALLOW', '*');
    expect(await redirected(() => signUp(null, form({ email: 'stranger@example.com', password: 'longenough' })))).toBe('/verify-email');
  });
});

describe('the verification link is completed only in a browser that holds the session of its own account', () => {
  const mailToken = async (kind: 'verify' | 'reset', to: string) => (await data.mailer.outbox()).filter((mail) => mail.kind === kind && mail.to === to).at(-1)?.data.token ?? '';
  const linkOf = (token: string) => `/verify-email/confirm?token=${encodeURIComponent(token)}`;
  const open = (token: string) => redirected(async () => openVerifyLink(new Request(`http://localhost${linkOf(token)}`)));
  const toLogin = (token: string) => `/login?reason=verify-login&next=${encodeURIComponent(linkOf(token))}`;
  const account = async (email: string) => getStore().users.find((user) => user.email === email);
  const signedUp = async (email: string, password: string) => {
    await redirected(() => signUp(null, form({ email, password })));
    return mailToken('verify', email);
  };

  it('the person who signed up opens the link in the same browser: verified, on to /welcome', async () => {
    const token = await signedUp('same@example.com', 'longenough');
    expect(await open(token)).toBe('/welcome');
    expect((await account('same@example.com'))?.emailVerified).toBe(true);
  });
  it('opened where nobody is signed in it verifies nothing: it goes to the log-in page with the link kept for afterwards, and the link is not used up', async () => {
    const token = await signedUp('elsewhere@example.com', 'longenough');
    jar.clear();
    expect(await open(token)).toBe(toLogin(token));
    expect(await open(token)).toBe(toLogin(token));
    expect((await account('elsewhere@example.com'))?.emailVerified).toBe(false);
  });
  it('the honest owner on another device logs in with the own password and the link is completed then', async () => {
    const token = await signedUp('phone@example.com', 'longenough');
    jar.clear();
    await open(token);
    expect(await redirected(() => logIn(null, form({ email: 'phone@example.com', password: 'longenough', next: linkOf(token) })))).toBe(linkOf(token));
    expect(await open(token)).toBe('/welcome');
    expect((await account('phone@example.com'))?.emailVerified).toBe(true);
  });
  it('an account that is not verified is sent to its link only: any other `next` still ends on /verify-email', async () => {
    await signedUp('waiting@example.com', 'longenough');
    for (const next of ['/gallery', '/verify-email/confirmed?token=x', '/verify-email/confirm', '/admin?x=/verify-email/confirm?token=x']) {
      jar.clear();
      expect(await redirected(() => logIn(null, form({ email: 'waiting@example.com', password: 'longenough', next }))), next).toBe('/verify-email');
    }
  });
  it('the session of another account does not complete it either', async () => {
    const token = await signedUp('first@example.com', 'longenough');
    await signedUp('second@example.com', 'longenough'); // this browser is now the second account's
    expect(await open(token)).toBe(toLogin(token));
    expect((await account('first@example.com'))?.emailVerified).toBe(false);
  });
  it('a stranger who opened the account of an invited address first never gets a verified account with the own password: the owner of the mailbox is told to log in, resets the password, which ends the stranger\'s session, and is verified after logging in', async () => {
    const token = await signedUp('invited@example.com', 'stranger-password');
    const strangerSession = jar.get(SESSION_COOKIE)!;

    jar.clear(); // the owner of the mailbox, in the owner's own browser
    expect(await open(token)).toBe(toLogin(token));
    expect((await account('invited@example.com'))?.emailVerified).toBe(false);

    await redirected(() => requestReset(null, form({ email: 'invited@example.com' })));
    const reset = await mailToken('reset', 'invited@example.com');
    expect(await redirected(() => resetPassword(null, form({ token: reset, password: 'the-owners-password', repeat: 'the-owners-password' })))).toBe('/login?reason=password-reset');

    jar.set(SESSION_COOKIE, strangerSession); // the stranger's browser: the session is over, the password is gone, the link does nothing
    expect(await getSessionUser()).toBeNull();
    expect(await open(token)).toBe(toLogin(token));
    jar.clear();
    expect((await logIn(null, form({ email: 'invited@example.com', password: 'stranger-password', next: linkOf(token) })))?.form).toBe('credentials');
    expect((await account('invited@example.com'))?.emailVerified).toBe(false);

    expect(await redirected(() => logIn(null, form({ email: 'invited@example.com', password: 'the-owners-password', next: linkOf(token) })))).toBe(linkOf(token));
    expect(await open(token)).toBe('/welcome');
    expect((await account('invited@example.com'))?.emailVerified).toBe(true);
  });
  it('the answer for a link that never worked is the same with and without a session: nothing about any account', async () => {
    expect(await open('nope')).toBe('/verify-email/expired?state=invalid');
    await signedUp('someone@example.com', 'longenough');
    expect(await open('nope')).toBe('/verify-email/expired?state=invalid');
  });
});

describe('logIn', () => {
  it('sends a blocked user to /blocked and starts no session', async () => {
    await data.admin.setBlocked('usr-demo', true);
    const demo = await data.auth.getUser('usr-demo');
    const out = await logIn(null, form({ email: demo!.email, password: 'x' })).catch((e) => String(e));
    expect(out).toContain('REDIRECT:/blocked');
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
  it('gives the same error for an unknown email', async () => {
    const out = await logIn(null, form({ email: 'ghost@example.com', password: 'whatever1' }));
    expect(out?.form).toBe('credentials');
    expect(out?.fieldErrors).toBeUndefined();
  });
  it('rejects a malformed email and an empty password as field errors', async () => {
    expect((await logIn(null, form({ email: 'x', password: 'a' })))?.fieldErrors?.email).toBe('invalid-email');
    expect((await logIn(null, form({ email: 'a@b.co', password: '' })))?.fieldErrors?.password).toBe('required');
  });
  it('redirects to a same-site next path', async () => {
    const demo = await data.auth.getUser('usr-demo');
    const to = await redirected(() => logIn(null, form({ email: demo!.email, password: 'x', next: '/jobs/1' })));
    expect(to).toBe('/jobs/1');
    expect(jar.get(SESSION_COOKIE)).toBe('usr-demo');
  });
  it('an account whose email is not verified lands on /verify-email after log in, whatever next says', async () => {
    await data.auth.signUp('unverified@example.com', 'longenough');
    const to = await redirected(() => logIn(null, form({ email: 'unverified@example.com', password: 'longenough', next: '/jobs/1' })));
    expect(to).toBe('/verify-email');
    expect(jar.has(SESSION_COOKIE)).toBe(true);
  });
  it('sends next=//evil.com to /gallery', async () => {
    const demo = await data.auth.getUser('usr-demo');
    const to = await redirected(() => logIn(null, form({ email: demo!.email, password: 'x', next: '//evil.com' })));
    expect(to).toBe('/gallery');
  });
});

describe('an account whose email is over the sign-up limit', () => {
  const long = `${'a'.repeat(70)}@example.com`;
  beforeEach(async () => {
    await data.auth.signUp(long, 'longenough-1'); // made before the limit existed
  });
  it('still logs in and asks for a reset', async () => {
    expect(await redirected(() => logIn(null, form({ email: long, password: 'longenough-1' })))).toBe('/verify-email'); // not verified yet, so it goes there
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(await redirected(() => requestReset(null, form({ email: long })))).toBe(`/forgot-password/sent?email=${encodeURIComponent(long)}`);
    expect((await data.mailer.outbox()).filter((mail) => mail.kind === 'reset' && mail.to === long)).toHaveLength(1);
  });
  it('gets a reset link from "send again" too', async () => {
    expect(await resendReset(null, form({ email: long }))).toMatchObject({ sent: true, email: long });
    expect((await data.mailer.outbox()).filter((mail) => mail.kind === 'reset' && mail.to === long)).toHaveLength(1);
  });
  it('is still refused as a new sign-up', async () => {
    expect((await signUp(null, form({ email: `${'b'.repeat(70)}@example.com`, password: 'longenough' })))?.fieldErrors?.email).toBe('invalid-email');
  });
});

describe('Continue with Google (demo stand-in)', () => {
  it('signs in the demo user', async () => {
    const to = await redirected(() => logInWithGoogle(null, form({ next: '/videos' })));
    expect(to).toBe('/videos');
    expect(jar.get(SESSION_COOKIE)).toBe('usr-demo');
  });
  it('says so when the demo account was deleted, instead of bouncing back to the login page; no session', async () => {
    getStore().jobs.forEach((job) => { if (job.id === 'job-demo-running') job.pinnedElapsed = 3_600; }); // B23: no running job
    await data.auth.deleteAccount('usr-demo');
    expect(await logInWithGoogle(null, form({ next: '/videos' }))).toEqual({ form: 'demo-deleted' });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
  it('refuses a blocked demo account like any blocked login: /blocked, no session', async () => {
    await data.admin.setBlocked('usr-demo', true);
    expect(await redirected(() => logInWithGoogle(null, form({})))).toBe('/blocked');
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
});

describe('verification link', () => {
  it('confirmEmail without a session goes to /login', async () => {
    expect(await redirected(() => confirmEmail())).toBe('/login');
  });
  it('resend queues a verify email for the signed-in user', async () => {
    await redirected(() => signUp(null, form({ email: 'resend@example.com', password: 'longenough' })));
    // The sign-up just sent a link: a second one inside the 60 seconds is refused, and the answer says how long to wait.
    const out = await resendVerification();
    expect(out?.sent).toBe(false);
    expect(out?.retryAfter).toBeGreaterThan(0);
    const outbox = await data.mailer.outbox();
    expect(outbox.filter((m) => m.kind === 'verify' && m.to === 'resend@example.com')).toHaveLength(1);
  });
});

describe('"Use another email" on the verify page', () => {
  it('ends the session and opens sign up (the sign-up page would send a signed-in visitor away)', async () => {
    await redirected(() => signUp(null, form({ email: 'typo@example.com', password: 'longenough' })));
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(await redirected(() => signUpWithAnotherEmail())).toBe('/signup');
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
});

describe('password reset', () => {
  it('answers the same for a known and an unknown email', async () => {
    const demo = await data.auth.getUser('usr-demo');
    const known = await redirected(() => requestReset(null, form({ email: demo!.email })));
    const unknown = await redirected(() => requestReset(null, form({ email: 'ghost@example.com' })));
    expect(known).toBe(`/forgot-password/sent?email=${encodeURIComponent(demo!.email)}`);
    expect(unknown).toBe(`/forgot-password/sent?email=${encodeURIComponent('ghost@example.com')}`);
  });
  it('rejects a malformed email', async () => {
    expect((await requestReset(null, form({ email: 'x' })))?.fieldErrors?.email).toBe('invalid-email');
  });
  it('resendReset confirms inline', async () => {
    expect((await resendReset(null, form({ email: 'a@b.co' })))?.sent).toBe(true);
  });
  it('resetPassword needs min length and equal passwords', async () => {
    const short = await resetPassword(null, form({ email: 'a@b.co', password: '123', repeat: '123' }));
    expect(short?.fieldErrors?.password).toBe('password-short');
    const diff = await resetPassword(null, form({ email: 'a@b.co', password: 'longenough', repeat: 'longenough2' }));
    expect(diff?.fieldErrors?.repeat).toBe('mismatch');
  });
  const tokenFor = async (email: string) => {
    await requestReset(null, form({ email })).catch(() => undefined);
    return (await data.mailer.outbox()).find((m) => m.kind === 'reset' && m.to === email)!.data.token!;
  };
  it('resetPassword with the link of the email goes to /login and starts no session; the link is single use', async () => {
    const demo = await data.auth.getUser('usr-demo');
    const token = await tokenFor(demo!.email);
    const input = form({ token, password: 'longenough', repeat: 'longenough' });
    expect(await redirected(() => resetPassword(null, input))).toBe('/login?reason=password-reset');
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await redirected(() => resetPassword(null, input))).toBe('/reset-password/invalid');
  });
  it('resetPassword with an unknown token goes to the page that says the link does not work', async () => {
    expect(await redirected(() => resetPassword(null, form({ token: 'nope', password: 'longenough', repeat: 'longenough' })))).toBe('/reset-password/invalid');
  });
  it('resetPassword checks both fields before it spends the link', async () => {
    const demo = await data.auth.getUser('usr-demo');
    const token = await tokenFor(demo!.email);
    expect((await resetPassword(null, form({ token, password: 'short', repeat: 'short' })))?.fieldErrors?.password).toBe('password-short');
    expect((await resetPassword(null, form({ token, password: 'longenough', repeat: 'different1' })))?.fieldErrors?.repeat).toBe('mismatch');
    expect((await data.auth.checkResetLink(token)).ok).toBe(true);
  });
});

describe('rate limits on the anonymous actions (review I2)', () => {
  const tooMany = { form: 'rate-limited' };
  afterEach(() => {
    vi.unstubAllEnvs();
    forwardedFor = undefined;
  });
  it('without VC_TRUST_PROXY the forwarding header is ignored: rotating it does not reset the count; the shared bucket is ten times wider (no lock-out of everyone)', SLOW_HASHING, async () => {
    const spy = vi.spyOn(data.auth, 'signUp');
    for (let i = 0; i < 6; i++) {
      forwardedFor = `7.7.7.${i}`;
      await redirected(() => signUp(null, form({ email: `rot${i}@example.com`, password: 'longenough' })));
    }
    expect(spy).toHaveBeenCalledTimes(6); // more than the per-caller 5: the shared bucket allows 50
    for (let i = 6; i < 50; i++) await redirected(() => signUp(null, form({ email: `rot${i}@example.com`, password: 'longenough' })));
    forwardedFor = '1.1.1.1';
    expect(await signUp(null, form({ email: 'rot-last@example.com', password: 'longenough' }))).toMatchObject(tooMany);
    expect(spy).toHaveBeenCalledTimes(50);
  });
  it('logIn: a +tag or other case of one mailbox counts as the same address', async () => {
    const spy = vi.spyOn(data.auth, 'logIn');
    for (let i = 0; i < 5; i++) await logIn(null, form({ email: `Plus+${i}@Example.com`, password: 'x' }));
    for (let i = 5; i < 10; i++) await logIn(null, form({ email: ` plus@example.com`, password: 'x' }));
    expect(await logIn(null, form({ email: 'plus+zzz@example.com', password: 'x' }))).toMatchObject(tooMany);
    expect(spy).toHaveBeenCalledTimes(10);
  });
  it('a huge token field does not become a huge key', async () => {
    await redirected(() => resetPassword(null, form({ token: 'x'.repeat(5_000_000), password: 'longenough', repeat: 'longenough' })));
    expect(Math.max(...limiter.keys().map((k) => k.length))).toBeLessThan(200);
  });
  const call = (n: number, run: (i: number) => Promise<unknown>) => Array.from({ length: n }).reduce<Promise<unknown>>((p, _, i) => p.then(() => run(i)), Promise.resolve());

  it('logIn: the 11th attempt from one caller (proxy trusted) is refused and nothing reaches data.auth; a different address is not affected', SLOW_HASHING, async () => {
    vi.stubEnv('VC_TRUST_PROXY', '1');
    forwardedFor = '9.9.9.9';
    const spy = vi.spyOn(data.auth, 'logIn');
    await call(10, (i) => logIn(null, form({ email: `nobody${i}@example.com`, password: 'x' })));
    expect(spy).toHaveBeenCalledTimes(10);
    expect(await logIn(null, form({ email: 'nobody-new@example.com', password: 'x' }))).toMatchObject(tooMany);
    expect(spy).toHaveBeenCalledTimes(10);
  });
  it('logIn behind the trusted proxy: five wrong passwords from a stranger lock the stranger, and the owner still gets in (SEC B2)', async () => {
    vi.stubEnv('VC_TRUST_PROXY', '1');
    forwardedFor = '6.6.6.6';
    await call(4, () => logIn(null, form({ email: 'demo@viralclone.app', password: 'a-guess' })));
    expect(await logIn(null, form({ email: 'demo@viralclone.app', password: 'a-guess' }))).toMatchObject({ form: 'locked', retryAfter: 900 });
    expect(await logIn(null, form({ email: 'demo@viralclone.app', password: 'x' }))).toMatchObject({ form: 'locked' });
    forwardedFor = '1.2.3.4';
    expect(await redirected(() => logIn(null, form({ email: 'demo@viralclone.app', password: 'x' })))).toBe('/gallery');
    expect(jar.get(SESSION_COOKIE)).toBe('usr-demo');
  });
  it('logIn behind the trusted proxy: ten requests of a stranger on an address stop the stranger, and the owner still gets in from elsewhere (RP1 Ö2)', async () => {
    vi.stubEnv('VC_TRUST_PROXY', '1');
    forwardedFor = '6.6.6.6';
    await call(10, () => logIn(null, form({ email: 'demo@viralclone.app', password: 'a-guess' })));
    expect(await logIn(null, form({ email: 'demo@viralclone.app', password: 'x' }))).toMatchObject(tooMany);
    forwardedFor = '1.2.3.4';
    expect(await redirected(() => logIn(null, form({ email: 'demo@viralclone.app', password: 'x' })))).toBe('/gallery');
    expect(jar.get(SESSION_COOKIE)).toBe('usr-demo');
  });
  it('logIn without a trusted proxy: callers cannot be told apart, so ten requests on an address still stop it for everybody', async () => {
    forwardedFor = '6.6.6.6';
    await call(10, () => logIn(null, form({ email: 'demo@viralclone.app', password: 'a-guess' })));
    forwardedFor = '1.2.3.4';
    expect(await logIn(null, form({ email: 'demo@viralclone.app', password: 'x' }))).toMatchObject(tooMany);
  });
  it('logIn: 10 attempts on one address (by any callers) lock that address only, before data.auth is called', async () => {
    const spy = vi.spyOn(data.auth, 'logIn');
    for (let i = 0; i < 10; i++) limiter.allow([{ key: 'logIn:email:victim@example.com', max: 10, windowMs: 600_000 }]);
    expect(await logIn(null, form({ email: 'Victim@Example.com', password: 'x' }))).toMatchObject(tooMany);
    expect(spy).not.toHaveBeenCalled();
    expect(await logIn(null, form({ email: 'someone-else@example.com', password: 'x' }))).not.toMatchObject(tooMany);
  });
  it('signUp: the 6th sign-up from one caller (proxy trusted) in the hour is refused and creates no user', async () => {
    vi.stubEnv('VC_TRUST_PROXY', '1');
    forwardedFor = '9.9.9.8';
    const spy = vi.spyOn(data.auth, 'signUp');
    for (let i = 0; i < 5; i++) await redirected(() => signUp(null, form({ email: `new${i}@example.com`, password: 'longenough' })));
    expect(spy).toHaveBeenCalledTimes(5);
    expect(await signUp(null, form({ email: 'new5@example.com', password: 'longenough' }))).toMatchObject(tooMany);
    expect(spy).toHaveBeenCalledTimes(5);
  });
  it('requestReset: the 4th request for one address in 10 minutes is refused, with the same state for a known and an unknown address', async () => {
    const spy = vi.spyOn(data.auth, 'requestPasswordReset');
    const demo = await data.auth.getUser('usr-demo');
    for (let i = 0; i < 3; i++) await redirected(() => requestReset(null, form({ email: demo!.email })));
    for (let i = 0; i < 3; i++) await redirected(() => requestReset(null, form({ email: 'ghost@example.com' })));
    expect(spy).toHaveBeenCalledTimes(6);
    const known = await requestReset(null, form({ email: demo!.email }));
    const unknown = await requestReset(null, form({ email: 'ghost@example.com' }));
    expect(known).toMatchObject({ form: 'rate-limited' });
    expect(unknown).toMatchObject({ form: 'rate-limited' });
    expect({ ...known, email: '' }).toEqual({ ...unknown, email: '' });
    expect(spy).toHaveBeenCalledTimes(6);
  });
  it('resendReset and resendVerification are limited too, and nothing is sent over the limit', async () => {
    const reset = vi.spyOn(data.auth, 'requestPasswordReset');
    for (let i = 0; i < 3; i++) await resendReset(null, form({ email: 'r@example.com' }));
    expect(await resendReset(null, form({ email: 'r@example.com' }))).toMatchObject(tooMany);
    expect(reset).toHaveBeenCalledTimes(3);
    await redirected(() => signUp(null, form({ email: 'v@example.com', password: 'longenough' })));
    const verify = vi.spyOn(data.auth, 'resendVerification');
    for (let i = 0; i < 3; i++) await resendVerification();
    expect(await resendVerification()).toMatchObject(tooMany);
    expect(verify).toHaveBeenCalledTimes(3);
  });
  it('resetPassword is limited per link and per caller', async () => {
    const spy = vi.spyOn(data.auth, 'resetPasswordWithLink');
    for (let i = 0; i < 5; i++) await redirected(() => resetPassword(null, form({ token: 't1', password: 'longenough', repeat: 'longenough' })));
    expect(await resetPassword(null, form({ token: 't1', password: 'longenough', repeat: 'longenough' }))).toMatchObject(tooMany);
    expect(spy).toHaveBeenCalledTimes(5);
  });
});

describe('paid mode (VC_PROVIDER=magnific): no self-verification and no demo Google (C1, C2)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('a production build has no demo aids unless VC_DEMO_LINKS=1 on a loopback address (review C-1, SEC B7)', async () => {
    const { demoAidsAllowed } = await import('@/core/paid-mode');
    vi.stubEnv('NODE_ENV', 'production');
    expect(demoAidsAllowed()).toBe(false);
    expect(await confirmEmail()).toEqual({ form: 'unavailable' });
    expect(await logInWithGoogle(null, form({}))).toEqual({ form: 'unavailable' });
    vi.stubEnv('VC_DEMO_LINKS', '1');
    expect(await logInWithGoogle(null, form({}))).toEqual({ form: 'unavailable' });
    vi.stubEnv('VC_BIND_HOST', '127.0.0.1');
    expect(demoAidsAllowed()).toBe(true);
    vi.stubEnv('VC_PROVIDER', 'magnific');
    expect(demoAidsAllowed()).toBe(false);
  });

  it('confirmEmail refuses with a plain error state and does not call verifyEmail', async () => {
    await redirected(() => signUp(null, form({ email: 'paid@example.com', password: 'longenough' })));
    const spy = vi.spyOn(data.auth, 'verifyEmail');
    vi.stubEnv('VC_PROVIDER', 'magnific');
    expect(await confirmEmail()).toEqual({ form: 'unavailable' });
    expect(spy).not.toHaveBeenCalled();
    expect((await data.auth.getUser(jar.get(SESSION_COOKIE)!.split('.')[0]!))?.emailVerified).toBe(false);
  });
  it('logInWithGoogle refuses and starts no session; getUser is not even asked', async () => {
    const spy = vi.spyOn(data.auth, 'getUser');
    vi.stubEnv('VC_PROVIDER', 'magnific');
    expect(await logInWithGoogle(null, form({}))).toEqual({ form: 'unavailable' });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
  it('unset: both behave as before', async () => {
    expect(await redirected(() => logInWithGoogle(null, form({})))).toBe('/gallery');
    expect(await redirected(() => confirmEmail())).toBe('/welcome');
  });
});
