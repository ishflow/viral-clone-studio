import type { Id, User } from '../../ports';
import { hashPasswordSync } from '../password';
import type { Ago, CredentialRecord } from '../store';

function user(id: Id, email: string, name: string, joinedAt: string, lastActiveAt: string, over: Partial<User> = {}): User {
  return {
    id, email, name, role: 'customer', emailVerified: true, blocked: false, freeVideoAvailable: false, locale: 'en',
    joinedAt, lastActiveAt, authProvider: 'password', pendingEmail: null, block: null, ...over,
  };
}

/**
 * Three named accounts and four more customers: paying, free video only, not verified, blocked.
 * `freeVideoAvailable` is true for a verified account that has not used its free video yet.
 */
export function userFixtures(ago: Ago): User[] {
  return [
    user('usr-demo', 'demo@viralclone.app', 'Demo User', ago(21), ago(0, 5)),
    user('usr-new', 'new@viralclone.app', 'New User', ago(0, 90), ago(0, 30), { freeVideoAvailable: true }),
    user('usr-admin', 'admin@viralclone.app', 'Admin', ago(60), ago(0, 10), { role: 'admin', freeVideoAvailable: true }),
    user('usr-paying', 'paying@example.com', 'Paying Customer', ago(40), ago(1)),
    user('usr-free', 'free-only@example.com', 'Free Video Customer', ago(5), ago(4)),
    user('usr-unverified', 'not-verified@example.com', 'Unverified Customer', ago(2), ago(2), { emailVerified: false }),
    user('usr-blocked', 'blocked@example.com', 'Blocked Customer', ago(33), ago(12), {
      blocked: true, freeVideoAvailable: true,
      block: { at: ago(12), reason: 'Chargeback on the Starter pack', by: { kind: 'admin', id: 'usr-admin', name: 'Admin' } },
    }),
  ];
}

/** The password of the fixture accounts in fake mode when `VC_DEV_PASSWORD` is not set. Documented in the runbook; it works nowhere else. */
export const DEFAULT_DEV_PASSWORD = 'demo-password';
const ADMIN_PASSWORD_MIN = 12;
type Env = Record<string, string | undefined>;

// One hash per account and password for the whole process: a store made again (every e2e test, every unit test) does not pay scrypt again.
const seeded = new Map<string, string>();
function seedHash(userId: Id, password: string): string {
  const key = `${userId}\u0000${password}`;
  let hash = seeded.get(key);
  if (!hash) {
    hash = hashPasswordSync(password);
    seeded.set(key, hash);
  }
  return hash;
}

/** The admin password from `VC_ADMIN_PASSWORD`; null when it is not set. A set one must be long enough. */
function adminPassword(env: Env): string | null {
  const password = env.VC_ADMIN_PASSWORD;
  if (!password) return null;
  if (password.length < ADMIN_PASSWORD_MIN) throw new Error(`admin-password-too-short: VC_ADMIN_PASSWORD needs at least ${ADMIN_PASSWORD_MIN} characters`);
  return password;
}

/**
 * The passwords of the fixture accounts (C1).
 * Fake mode (the default): every account gets `VC_DEV_PASSWORD`, or `demo-password` when that is not set; `VC_ADMIN_PASSWORD` sets the admin's own.
 * With the real engine (`VC_ENGINE=sqlite`) or in paid mode (`VC_PROVIDER=magnific`) there is no default at all: the admin gets
 * `VC_ADMIN_PASSWORD` and the store is not made without it (`admin-password-required`); the other fixture accounts get a password only
 * when `VC_DEV_PASSWORD` is set on purpose, and have none (so they cannot log in) otherwise.
 */
export function credentialFixtures(users: User[], env: Env = process.env): CredentialRecord[] {
  const strict = env.VC_ENGINE === 'sqlite' || env.VC_PROVIDER === 'magnific';
  const dev = env.VC_DEV_PASSWORD || (strict ? null : DEFAULT_DEV_PASSWORD);
  const admin = adminPassword(env) ?? (strict ? null : dev);
  if (strict && !admin && users.some((user) => user.role === 'admin')) {
    throw new Error('admin-password-required: set VC_ADMIN_PASSWORD (at least 12 characters) before the first start with VC_ENGINE=sqlite or VC_PROVIDER=magnific');
  }
  return users.flatMap((user) => {
    const password = user.role === 'admin' ? admin : dev;
    return password ? [{ userId: user.id, hash: seedHash(user.id, password) }] : [];
  });
}

/**
 * A store read from `site.json` that has an admin without a password (it was made before passwords existed): gives the admin the password
 * of `VC_ADMIN_PASSWORD` when it is set; otherwise the admin cannot log in, and a warning says why. Returns the credentials to add.
 */
export function missingAdminCredentials(users: User[], credentials: CredentialRecord[], env: Env = process.env): CredentialRecord[] {
  const without = users.filter((user) => user.role === 'admin' && !credentials.some((credential) => credential.userId === user.id));
  if (!without.length) return [];
  const password = adminPassword(env);
  if (!password) {
    console.warn('admin-has-no-password: set VC_ADMIN_PASSWORD (at least 12 characters) and restart: the admin cannot log in until then');
    return [];
  }
  return without.map((user) => ({ userId: user.id, hash: seedHash(user.id, password) }));
}
