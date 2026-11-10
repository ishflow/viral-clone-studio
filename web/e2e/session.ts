import { signSession } from '../src/core/session/token';

/**
 * The secret the e2e server signs sessions with (playwright.config.ts passes it as VC_SESSION_SECRET). A made-up value for the fake store
 * on a developer machine: it protects nothing.
 */
export const E2E_SESSION_SECRET = 'e2e-session-secret-not-a-real-secret-0123456789';

/** The value of the `vc_session` cookie for a fixture user: the same signed value the site hands out at log-in. */
export const sessionCookie = (userId: string): string => signSession(userId, Buffer.from(E2E_SESSION_SECRET), Date.now());
