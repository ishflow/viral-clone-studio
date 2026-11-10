import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Sessions and passwords in unit tests (SEC1).
// The suites of the features put a bare user id in the cookie jar and log in as a fixture account with the password "x". They run with an
// identity signer (the cookie value is the user id) and with `VC_DEV_PASSWORD=x`. Suites that test the passwords stub these two env values themselves. The real signed cookie is tested where it lives
// (core/session/token.test.ts, session.test.ts, proxy.test.ts: `vi.unmock('./token')`) and by the e2e run, which signs with the real code.
process.env.VC_DEV_PASSWORD = 'x';
process.env.VC_ADMIN_PASSWORD = 'unit-test-admin-password'; // the real engine (VC_ENGINE=sqlite) makes no first store without one
process.env.VC_SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';
vi.mock('@/core/session/token', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/session/token')>()),
  signSession: (userId: string) => userId,
  verifySession: (value: string | undefined) => value || null,
}));
