import { engine } from '../engine';
import { NotFoundError, RULES } from '../ports';
import type { AuthService, Id, LinkResult, LogInResult, ResendResult, User } from '../ports';
import { liveJobs } from './jobs';
import { keepEmail } from './mailer';
import { hashPassword, verifyPassword } from './password';
import { findUser, forgetKeysOf, getStore, now } from './store';
import type { TokenRecord } from './store';

const normalize = (email: string): string => email.trim().toLowerCase();
const byEmail = (email: string): User | undefined => getStore().users.find((user) => user.email === normalize(email));
const HOUR_MS = 3_600_000;
/**
 * One mailbox, one free video: spaces and a `+tag` do not make a second one, and Gmail reads the same mailbox with or without dots,
 * under gmail.com and googlemail.com. For the free video only: the address a person logs in with stays as it was typed.
 */
function mailbox(email: string): string {
  const address = normalize(email).replace(/\s/g, '').replace(/\+[^@]*(?=@)/, '');
  const at = address.lastIndexOf('@');
  return ['gmail.com', 'googlemail.com'].includes(address.slice(at + 1)) ? `${address.slice(0, at).replace(/\./g, '')}@gmail.com` : address;
}
const entitlementDigest = (email: string): string => process.getBuiltinModule('node:crypto').createHash('sha256').update(mailbox(email)).digest('hex');

function mustFind(id: Id): User {
  const user = findUser(id);
  if (!user) throw new NotFoundError('user');
  return user;
}

/** A new link of an email: single use, valid for `hours`. */
function newToken(user: User, purpose: TokenRecord['purpose'], email: string, hours: number): string {
  const createdAt = now().toISOString();
  const token = crypto.randomUUID();
  getStore().tokens.push({ token, userId: user.id, purpose, email, createdAt, expiresAt: new Date(now().getTime() + hours * HOUR_MS).toISOString(), usedAt: null });
  return token;
}

/** The token if it is still good; else why not. Changes nothing. */
function checkToken(token: string, purposes: TokenRecord['purpose'][]): TokenRecord | 'expired' | 'used' | 'invalid' {
  const record = getStore().tokens.find((item) => item.token === token && purposes.includes(item.purpose));
  if (!record || !findUser(record.userId)) return 'invalid';
  if (record.usedAt) return 'used';
  return Date.parse(record.expiresAt) <= now().getTime() ? 'expired' : record;
}

/**
 * A resend limit: at most one per `RULES.resendSeconds` per key. Records the send when it is allowed.
 * `retryAfter` is the seconds left until the next one. A record whose wait is over is forgotten: the key of a reset is whatever
 * address the caller typed, so the list would otherwise grow with every made-up address.
 */
function throttle(key: string): ResendResult {
  const store = getStore();
  const wait = RULES.resendSeconds * 1000;
  store.cooldowns = store.cooldowns.filter((item) => now().getTime() - Date.parse(item.at) < wait);
  const last = store.cooldowns.find((item) => item.key === key);
  if (last) return { sent: false, retryAfter: Math.ceil((wait - (now().getTime() - Date.parse(last.at))) / 1000) };
  store.cooldowns.push({ key, at: now().toISOString() });
  return { sent: true, retryAfter: RULES.resendSeconds };
}

/**
 * The key a failed log-in is kept under (`attempts[].email`): the email, and after it the caller when there is one.
 * An email is lower case, so the capitals can only be the separator: no email is the key of another email's caller.
 */
const FROM = ' FROM ';
const attemptKey = (email: string, caller?: string): string => (caller ? `${email}${FROM}${caller.slice(0, 64)}` : email);

/**
 * Seconds this log-in is still locked by the attempts limit (0 when it is not). Old failures are forgotten.
 * A caller is locked by its own `RULES.loginAttempts` failures on the email, so the wrong guesses of a stranger do not lock the owner out.
 * `RULES.loginEmailAttempts` failures of all callers together lock the email for everybody: the ceiling against guessing from many
 * callers. Without a caller (no trusted proxy: every caller looks the same) all failures are the one caller's own.
 */
function lockedFor(email: string, caller?: string): number {
  const store = getStore();
  const window = RULES.loginLockMinutes * 60_000;
  store.attempts = store.attempts.filter((item) => now().getTime() - Date.parse(item.at) < window);
  const all = store.attempts.filter((item) => item.email === email || item.email.startsWith(`${email}${FROM}`));
  const own = all.filter((item) => item.email === attemptKey(email, caller));
  const failures = own.length >= RULES.loginAttempts ? own : all.length >= RULES.loginEmailAttempts ? all : [];
  if (!failures.length) return 0;
  const lockEnd = Math.max(...failures.map((item) => Date.parse(item.at))) + window;
  return Math.max(0, Math.ceil((lockEnd - now().getTime()) / 1000));
}

/** Forgets every failed log-in of this email, of every caller: a new password from the reset link is the owner back in. */
function forgetFailures(email: string): void {
  const store = getStore();
  store.attempts = store.attempts.filter((item) => item.email !== email && !item.email.startsWith(`${email}${FROM}`));
}

/** Replaces (or makes) the password of a user. */
async function setPassword(userId: Id, password: string): Promise<void> {
  const hash = await hashPassword(password);
  const { credentials } = getStore();
  const own = credentials.find((credential) => credential.userId === userId);
  if (own) own.hash = hash;
  else credentials.push({ userId, hash });
}

/** A hash nobody has the password of, checked when the email is unknown: the answer takes as long as for a known one. */
let decoy: Promise<string> | null = null;

/** Does the user have this password? An account without a password (Google, or a fixture account of the real engine) never does. */
async function hasPassword(user: User | undefined, password: string): Promise<boolean> {
  const stored = user ? getStore().credentials.find((credential) => credential.userId === user.id)?.hash : undefined;
  if (stored) return verifyPassword(password, stored);
  decoy ??= hashPassword(crypto.randomUUID());
  await verifyPassword(password, await decoy);
  return false;
}

function signedIn(user: User): LogInResult {
  if (user.blocked) return { ok: false, reason: 'blocked', retryAfter: null };
  user.lastActiveAt = now().toISOString();
  return { ok: true, user: { ...user } };
}

function newUser(email: string, over: Partial<User> = {}): User {
  const at = now().toISOString();
  return {
    id: crypto.randomUUID(), email: normalize(email), name: '', role: 'customer', emailVerified: false, blocked: false,
    freeVideoAvailable: false, locale: 'en', joinedAt: at, lastActiveAt: at, authProvider: 'password', pendingEmail: null, block: null, ...over,
  };
}

/** Whether verifying this email would give the free video now: the admin has it on and this mailbox never had it. */
function freeVideoOpenFor(email: string): boolean {
  const store = getStore();
  const digest = entitlementDigest(email);
  return store.limits.freeFirstVideo && !store.freeEntitlements.some(entry => entry.digest === digest);
}

/** The data of a sign-up mail: the link, and whether its text may promise the free video (`free`). */
function verifyMailData(user: User): Record<string, string> {
  return { userId: user.id, token: newToken(user, 'verify', user.email, RULES.verifyLinkHours), purpose: 'verify', free: freeVideoOpenFor(user.email) ? '1' : '0' };
}

/** The free video is given once, at the moment the email becomes verified, when the admin has it switched on (B10). */
function verify(user: User): void {
  if (user.emailVerified) return;
  user.emailVerified = true;
  const store = getStore();
  const digest = entitlementDigest(user.email);
  user.freeVideoAvailable = freeVideoOpenFor(user.email);
  // No await between checking and inserting: one grant in this site's exclusive store writer.
  if (user.freeVideoAvailable) store.freeEntitlements.push({ digest, at: now().toISOString() });
}

/** The password is kept as a salted scrypt hash in `store.credentials`, beside the user, never in it. */
export const auth: AuthService = {
  async signUp(email, password) {
    const hash = await hashPassword(password); // before the check: nothing awaits between the check and the writes, two sign-ups cannot both pass
    if (byEmail(email)) throw new Error('email-taken');
    const user = newUser(email);
    getStore().credentials.push({ userId: user.id, hash });
    getStore().users.push(user);
    throttle(`verify:${user.id}`);
    keepEmail('verify', user.email, verifyMailData(user));
    return { ...user };
  },

  async logIn(email, password, caller) {
    const address = normalize(email);
    const locked = lockedFor(address, caller);
    if (locked > 0) return { ok: false, reason: 'too-many', retryAfter: locked };
    const user = byEmail(address);
    // The same work and the same answer for an unknown email and a wrong password; `blocked` only for the right password.
    if (!(await hasPassword(user, password)) || !user) {
      getStore().attempts.push({ email: attemptKey(address, caller), at: now().toISOString() });
      const now5 = lockedFor(address, caller);
      return now5 > 0 ? { ok: false, reason: 'too-many', retryAfter: now5 } : { ok: false, reason: 'invalid', retryAfter: null };
    }
    getStore().attempts = getStore().attempts.filter((item) => item.email !== attemptKey(address, caller));
    return signedIn(user);
  },

  async signInWithGoogle(callback) {
    if ('error' in callback) return { ok: false, reason: callback.error, retryAfter: null };
    const existing = byEmail(callback.email);
    if (existing) return signedIn(existing);
    const user = newUser(callback.email, { name: callback.name, authProvider: 'google' });
    verify(user);
    getStore().users.push(user);
    return signedIn(user);
  },

  async verifyEmail(userId) {
    const user = mustFind(userId);
    verify(user);
    return { ...user };
  },

  async resendVerification(userId) {
    const user = mustFind(userId);
    if (user.emailVerified) return { sent: false, retryAfter: 0 };
    const answer = throttle(`verify:${user.id}`);
    if (answer.sent) keepEmail('verify', user.email, verifyMailData(user));
    return answer;
  },

  async confirmEmailLink(token, signedInAs): Promise<LinkResult<{ user: User; purpose: 'verify' | 'email-change' }> | { ok: false; reason: 'login-required' }> {
    const record = checkToken(token, ['verify', 'email-change']);
    if (typeof record === 'string') return { ok: false, reason: record };
    const user = mustFind(record.userId);
    if (record.purpose === 'email-change') {
      const owner = byEmail(record.email);
      if (owner && owner.id !== user.id) return { ok: false, reason: 'invalid' };
      if (user.pendingEmail !== record.email) return { ok: false, reason: 'used' };
      user.email = record.email;
      user.pendingEmail = null;
      // The address is the way in from now on: whoever was signed in under the old one signs in again.
      user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    } else {
      if (user.emailVerified) return { ok: false, reason: 'used' };
      // The link proves the mailbox, the session proves the password: both, or a stranger who signed up with this address first
      // would own a verified account. The link is not used up: it is opened again after logging in.
      if (signedInAs !== user.id) return { ok: false, reason: 'login-required' };
      verify(user);
    }
    record.usedAt = now().toISOString();
    return { ok: true, user: { ...user }, purpose: record.purpose === 'email-change' ? 'email-change' : 'verify' };
  },

  /** Silent for an unknown email, and limited the same way for every email: the answer says nothing about the account. */
  async requestPasswordReset(email) {
    const answer = throttle(`reset:${normalize(email)}`);
    const user = byEmail(email);
    if (answer.sent && user) keepEmail('reset', user.email, { email: user.email, token: newToken(user, 'reset', user.email, RULES.resetLinkHours) });
    return answer;
  },

  async checkResetLink(token) {
    const record = checkToken(token, ['reset']);
    return typeof record === 'string' ? { ok: false, reason: record } : { ok: true, email: record.email };
  },

  async resetPasswordWithLink(token, password) {
    const record = checkToken(token, ['reset']);
    if (typeof record === 'string') return { ok: false, reason: record };
    // Reserve before hashing: concurrent submissions of one link cannot both change the password.
    record.usedAt = now().toISOString();
    try {
      await setPassword(record.userId, password);
    } catch (error) {
      record.usedAt = null;
      throw error;
    }
    const user = mustFind(record.userId);
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    // Older reset links must not undo this password change either. Nor may an email change that waits for its link:
    // whoever asked for it may be the reason for this reset.
    user.pendingEmail = null;
    for (const link of getStore().tokens) {
      if (link.userId === user.id && (link.purpose === 'reset' || link.purpose === 'email-change')) link.usedAt ??= record.usedAt;
    }
    forgetFailures(user.email);
    return { ok: true, email: record.email };
  },

  /** Changes nothing: an email address alone proves nothing, so only `resetPasswordWithLink` sets a password. */
  async resetPassword() {},

  async getUser(id) {
    const user = findUser(id);
    return user ? { ...user } : null;
  },

  async endSessions(userId) {
    const user = findUser(userId);
    if (user) user.sessionVersion = (user.sessionVersion ?? 0) + 1;
  },

  async checkPassword(userId, password) {
    return hasPassword(findUser(userId), password);
  },

  /**
   * A new email waits for its link (B14): until it is opened the old one stays. The same email again cancels a pending change.
   * One new address per `RULES.resendSeconds` (`email-change-wait`, nothing is saved): each one puts an email in the outbox.
   * Only the newest link works.
   */
  async updateProfile(id, patch) {
    const user = mustFind(id);
    if (patch.email !== undefined) {
      const email = normalize(patch.email);
      const owner = byEmail(email);
      if (owner && owner.id !== id) throw new Error('email-taken');
      if (email === user.email) user.pendingEmail = null;
      else if (email !== user.pendingEmail) {
        if (!throttle(`email-change:${user.id}`).sent) throw new Error('email-change-wait');
        user.pendingEmail = email;
        for (const link of getStore().tokens) {
          if (link.userId === user.id && link.purpose === 'email-change') link.usedAt ??= now().toISOString();
        }
        keepEmail('verify', email, { userId: user.id, token: newToken(user, 'email-change', email, RULES.verifyLinkHours), purpose: 'email-change' });
      }
    }
    if (patch.name !== undefined) user.name = patch.name;
    if (patch.locale !== undefined) user.locale = patch.locale;
    return { ...user };
  },

  /**
   * Removes the account, its jobs, its private templates, its idempotency keys, its open checkouts, drafts and links.
   * Invoices, purchases and the credit history stay. Not while a job is queued or running (B23).
   * The templates go first: they are the engine's, and when the engine fails the account must still be whole.
   * So do the files of its person swaps (the video and the parts it was made of show a person): deleted from the disk, never left
   * for the retirement to move aside; a deletion that fails leaves the account, to be tried again, and each job whose files are gone
   * by then is marked (`swapVideoGoneAt`): it no longer says that its video is kept.
   */
  async deleteAccount(id) {
    const store = getStore();
    if (liveJobs().some((job) => job.userId === id && (job.status === 'running' || job.status === 'queued' || job.variants.some(variant => variant.status === 'generating')))) throw new Error('job-running');
    for (const template of engine().templates()) {
      if (template.status === 'private' && template.ownerId === id) engine().removeTemplate(template.id);
    }
    for (const job of store.jobs) if (job.userId === id && job.swap) {
      engine().deleteMedia(job);
      job.swapVideoGoneAt ??= now().toISOString();                           // should a later one fail, this job says its video is gone
    }
    const owner = findUser(id);
    if (owner?.emailVerified) {
      // Preserve eligibility for verified accounts from stores written before digest records existed.
      const digest = entitlementDigest(owner.email);
      if (!store.freeEntitlements.some(entry => entry.digest === digest)) store.freeEntitlements.push({ digest, at: now().toISOString() });
    }
    store.users = store.users.filter((user) => user.id !== id);
    store.credentials = store.credentials.filter((credential) => credential.userId !== id);
    store.jobs = store.jobs.filter((job) => job.userId !== id);
    store.checkouts = store.checkouts.filter((checkout) => !(checkout.userId === id && checkout.purchaseId === null));
    store.drafts = store.drafts.filter((draft) => draft.userId !== id);
    store.tokens = store.tokens.filter((token) => token.userId !== id);
    forgetKeysOf(id);
  },
};
