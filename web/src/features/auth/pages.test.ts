import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined) }),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const args = (sp: Record<string, string> = {}) => ({ searchParams: Promise.resolve(sp) });
const target = async (run: () => unknown) => {
  try {
    await run();
  } catch (e) {
    return String((e as Error).message);
  }
  return null;
};

beforeEach(() => jar.clear());
afterEach(() => vi.unstubAllEnvs());

describe('auth page guards', () => {
  it('a signed-in user opening /login or /signup goes to /gallery', async () => {
    jar.set('vc_session', 'usr-demo');
    const login = (await import('@/app/(auth)/login/page')).default;
    const signup = (await import('@/app/(auth)/signup/page')).default;
    expect(await target(() => login(args()))).toBe('REDIRECT:/gallery');
    expect(await target(() => signup(args()))).toBe('REDIRECT:/gallery');
  });
  it('an unverified user opening /welcome goes to /verify-email; a signed-out visitor to login and back', async () => {
    const { WelcomeScreen } = await import('./WelcomeScreen');
    jar.set('vc_session', 'usr-unverified');
    expect(await target(() => WelcomeScreen())).toBe('REDIRECT:/verify-email');
    jar.clear();
    expect(await target(() => WelcomeScreen())).toBe('REDIRECT:/login?next=%2Fwelcome');
  });
  it('/verify-email without a session goes to /login; a user who is verified already goes to /welcome', async () => {
    const { VerifyEmailScreen } = await import('./screens');
    expect(await target(() => VerifyEmailScreen())).toBe('REDIRECT:/login?next=%2Fverify-email');
    jar.set('vc_session', 'usr-demo');
    expect(await target(() => VerifyEmailScreen())).toBe('REDIRECT:/welcome');
  });
  it('/reset-password without a token goes to /forgot-password, an unknown one to the page that says the link does not work; /forgot-password/sent without an email goes to /forgot-password', async () => {
    const { ResetScreen, ResetSentScreen } = await import('./screens');
    expect(await target(() => ResetScreen({ token: undefined }))).toBe('REDIRECT:/forgot-password');
    expect(await target(() => ResetScreen({ token: 'nope' }))).toBe('REDIRECT:/reset-password/invalid');
    expect(await target(() => ResetSentScreen({ email: undefined }))).toBe('REDIRECT:/forgot-password');
  });
});

describe('the link of an email change', () => {
  const linkOf = async () => {
    const { data } = await import('@/data');
    const { resetStore } = await import('@/data/mock/store');
    resetStore();
    await data.auth.updateProfile('usr-demo', { name: 'Demo User', email: 'changed@example.com', locale: 'en' });
    const mail = (await data.mailer.outbox()).find((m) => m.kind === 'verify' && m.to === 'changed@example.com');
    return new Request(`http://localhost/verify-email/confirm?token=${encodeURIComponent(mail?.data.token ?? '')}`);
  };
  it('ends on /login?reason=email-changed: the change ends the old session, so the account page would say it was closed', async () => {
    const { GET } = await import('@/app/(auth)/verify-email/confirm/route');
    expect(await target(async () => GET(await linkOf()))).toBe('REDIRECT:/login?reason=email-changed&next=%2Faccount');
  });
  it('the login page a verification link sent its visitor to says "log in first", also to a browser that is signed in as somebody else', async () => {
    const login = (await import('@/app/(auth)/login/page')).default as (props: ReturnType<typeof args>) => Promise<ReactElement<{ verifyLogin: boolean; next: string }>>;
    const next = '/verify-email/confirm?token=abc';
    expect((await login(args({ reason: 'verify-login', next }))).props).toMatchObject({ verifyLogin: true, next });
    expect((await login(args({ reason: 'expired' }))).props).toMatchObject({ verifyLogin: false });
    (await import('@/data/mock/store')).resetStore(); // the tests above changed the demo account's email, which ended its sessions
    jar.set('vc_session', 'usr-demo');
    expect((await login(args({ reason: 'verify-login', next }))).props).toMatchObject({ verifyLogin: true, next });
    expect(await target(() => login(args({ reason: 'expired' })))).toBe('REDIRECT:/gallery');
  });
  it('the login page of a changed email says so and does not say the session ended', async () => {
    const login = (await import('@/app/(auth)/login/page')).default as (props: ReturnType<typeof args>) => Promise<ReactElement<{ emailChanged: boolean; expired: boolean }>>;
    expect((await login(args({ reason: 'email-changed' }))).props).toMatchObject({ emailChanged: true, expired: false });
    expect((await login(args({ reason: 'expired' }))).props).toMatchObject({ emailChanged: false, expired: true });
  });
});

describe('a verification link that was never valid', () => {
  const screenText = async (state: 'expired' | 'used' | 'invalid', locale: 'en' | 'tr' = 'en') => {
    const { VerifyLinkScreen } = await import('./screens');
    const { LOCALE_COOKIE } = await import('@/core/i18n/types');
    jar.set(LOCALE_COOKIE, locale);
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { I18nProvider } = await import('@/core/i18n/I18nProvider');
    const { loadMessages } = await import('@/core/i18n/messages');
    const { createElement } = await import('react');
    return renderToStaticMarkup(createElement(I18nProvider, { locale, messages: loadMessages(locale), children: await VerifyLinkScreen({ state }) }));
  };
  it('says it does not work, not that it expired: /verify-email/confirm sends an unknown token to ?state=invalid', async () => {
    const { GET } = await import('@/app/(auth)/verify-email/confirm/route');
    expect(await target(() => GET(new Request('http://localhost/verify-email/confirm?token=nope')))).toBe('REDIRECT:/verify-email/expired?state=invalid');
    expect(await target(() => GET(new Request('http://localhost/verify-email/confirm')))).toBe('REDIRECT:/verify-email/expired?state=invalid');
  });
  it('the expired page hands ?state=invalid on to the screen, and any other value stays "expired"', async () => {
    const page = (await import('@/app/(auth)/verify-email/expired/page')).default as (props: ReturnType<typeof args>) => Promise<ReactElement<{ state: string }>>;
    expect((await page(args({ state: 'invalid' }))).props.state).toBe('invalid');
    expect((await page(args({ state: 'used' }))).props.state).toBe('used');
    expect((await page(args())).props.state).toBe('expired');
  });
  it('the screen of an invalid link has no "24 hours" sentence, and asks for a new link from the sign-in page, in English and Turkish', async () => {
    const en = await screenText('invalid');
    expect(en).toContain('This link does not work.');
    expect(en).toContain('Ask for a new one from the sign-in page.');
    expect(en).toContain('If you were changing your email, ask from your Account page.');
    expect(en).not.toMatch(/expired|24 hours|work for/);
    const tr = await screenText('invalid', 'tr');
    expect(tr).toContain('Bu bağlantı çalışmıyor.');
    expect(tr).toContain('Giriş sayfasından yenisini iste.');
    expect(tr).toContain('E-postanı değiştiriyorsan Hesap sayfasından iste.');
    expect(tr).not.toMatch(/süresi doldu|24 saat/);
    expect(await screenText('expired')).toContain('This link has expired.');
  });
});

describe('the login page after the account was deleted', () => {
  it('is told so by /login?reason=account-deleted and does not say the session ended', async () => {
    const login = (await import('@/app/(auth)/login/page')).default as (props: ReturnType<typeof args>) => Promise<ReactElement<{ accountDeleted: boolean; expired: boolean }>>;
    expect((await login(args({ reason: 'account-deleted' }))).props).toMatchObject({ accountDeleted: true, expired: false });
    expect((await login(args())).props).toMatchObject({ accountDeleted: false });
  });
});

describe('/forgot-password/sent: the demo reset link', () => {
  const sentPage = async (email: string) => {
    const { data } = await import('@/data');
    const { resetStore } = await import('@/data/mock/store');
    const { ResetSentScreen } = await import('./screens');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { I18nProvider } = await import('@/core/i18n/I18nProvider');
    const { loadMessages } = await import('@/core/i18n/messages');
    const { createElement } = await import('react');
    resetStore();
    await data.auth.requestPasswordReset(email);
    return renderToStaticMarkup(createElement(I18nProvider, { locale: 'en', messages: loadMessages('en'), children: await ResetSentScreen({ email }) }));
  };
  it('is never shown for an admin account, however the address is written: it would be a way into the admin panel (SEC B7)', async () => {
    expect(await sentPage('admin@viralclone.app')).not.toContain('/reset-password?token=');
    expect(await sentPage(' Admin@ViralClone.app')).not.toContain('/reset-password?token=');
  });
  it('is still shown for a customer in the demo', async () => {
    expect(await sentPage('demo@viralclone.app')).toContain('/reset-password?token=');
    expect(await sentPage('Demo@ViralClone.app')).toContain('/reset-password?token=');
  });
});

describe('/welcome', () => {
  it('a verified user sees the template row linking to /templates/<id>', async () => {
    jar.set('vc_session', 'usr-new');
    const { WelcomeScreen: welcome } = await import('./WelcomeScreen');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { I18nProvider } = await import('@/core/i18n/I18nProvider');
    const { loadMessages } = await import('@/core/i18n/messages');
    const { createElement } = await import('react');
    const el = await welcome();
    const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'en', messages: loadMessages('en'), children: el }));
    const hrefs = [...html.matchAll(/href="(\/templates\/[^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.length).toBeLessThanOrEqual(5);
    expect(html).toContain('is free.');
  });
});

describe('/verify-email', () => {
  it('"Change it" is a button that ends the session, not a link to /signup (which sends a signed-in visitor to the gallery)', async () => {
    jar.set('vc_session', 'usr-unverified');
    const { VerifyEmailScreen: verify } = await import('./screens');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { I18nProvider } = await import('@/core/i18n/I18nProvider');
    const { loadMessages } = await import('@/core/i18n/messages');
    const { createElement } = await import('react');
    const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'en', messages: loadMessages('en'), children: await verify() }));
    expect(html).not.toContain('href="/signup"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Change it<\/button>/);
  });
});

describe('the auth pages give the answers of the site, not fixed ones', () => {
  const formOf = async (path: 'login' | 'signup') => {
    const page = (await import(`@/app/(auth)/${path}/page`)).default as (props: ReturnType<typeof args>) => Promise<ReactElement<{ google: boolean; freeOffer?: boolean; inviteOnly?: boolean }>>;
    return (await page(args())).props;
  };
  /** The auth layout is the frame plus the cookie notice: the two children of its fragment. */
  const layoutParts = async () => {
    const layout = (await import('@/app/(auth)/layout')).default as (props: { children: string }) => Promise<ReactElement<{ children: ReactElement<{ freeOffer: boolean; answered: boolean; inFlow?: boolean }>[] }>>;
    const { AuthFrame, CookieNotice } = await import('@/shared/ui');
    const parts = (await layout({ children: 'page' })).props.children;
    return { frame: parts.find((part) => part.type === AuthFrame)!, notice: parts.find((part) => part.type === CookieNotice) };
  };
  const setting = async (on: boolean) => {
    const { getStore, resetStore } = await import('@/data/mock/store');
    resetStore();
    getStore().limits.freeFirstVideo = on;
  };

  it('/login and /signup offer Google only where the demo aids are allowed (the action\'s own gate)', async () => {
    expect((await formOf('login')).google).toBe(true);
    expect((await formOf('signup')).google).toBe(true);
    vi.stubEnv('VC_PROVIDER', 'magnific');
    expect((await formOf('login')).google).toBe(false);
    expect((await formOf('signup')).google).toBe(false);
  });
  it('/signup says the first video is free only while the admin offers it', async () => {
    await setting(true);
    expect((await formOf('signup')).freeOffer).toBe(true);
    await setting(false);
    expect((await formOf('signup')).freeOffer).toBe(false);
  });
  it('/signup says "by invitation" only while the mail list is a guest list', async () => {
    expect((await formOf('signup')).inviteOnly).toBe(false);
    for (const [name, value] of Object.entries({ VC_MAIL: 'resend', RESEND_API_KEY: 'test-placeholder', MAIL_FROM: 'no-reply@ishflow.com', VC_MAIL_ALLOW: 'guest@example.com' })) vi.stubEnv(name, value);
    expect((await formOf('signup')).inviteOnly).toBe(true);
    vi.stubEnv('VC_MAIL_ALLOW', '*');
    expect((await formOf('signup')).inviteOnly).toBe(false);
  });
  it('the layout of every auth page puts the same answer in the phone menu', async () => {
    await setting(true);
    expect((await layoutParts()).frame.props.freeOffer).toBe(true);
    await setting(false);
    expect((await layoutParts()).frame.props.freeOffer).toBe(false);
  });
  it('the auth pages keep the cookie notice in the flow, so it never covers the form buttons on a phone', async () => {
    expect((await layoutParts()).notice?.props.inFlow).toBe(true);
  });
  it('the auth pages draw the cookie notice until it is answered', async () => {
    expect((await layoutParts()).notice?.props.answered).toBe(false);
    jar.set('vc_cookies', 'necessary');
    expect((await layoutParts()).notice?.props.answered).toBe(true);
  });
});
