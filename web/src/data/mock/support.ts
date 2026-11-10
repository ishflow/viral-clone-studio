import { NotFoundError, RULES } from '../ports';
import type { Id, ProblemKind, SupportDesk, SupportMessage, SupportTopic } from '../ports';
import { liveJobs } from './jobs';
import { findUser, getStore, keyOf, newestFirst, now } from './store';

const DAY_MS = 86_400_000;
/**
 * What the desk keeps of the anonymous form, which must not be able to fill the store (every port call writes all of it).
 * Without an account the day and the total are shared by all; an account has its own limit of a day and is never dropped.
 */
const MAX_PER_DAY = 500;
const MAX_IN_ALL = 10_000;

/** What one account may send in a day: a customer always gets through the anonymous limits, but not without end. */
const MAX_PER_ACCOUNT_DAY = 20;

/** A reference the customer can quote: S- and a running number, one past the newest message (the list loses old messages, so its length is no number). */
function nextReference(): string {
  const newest = Number(getStore().support.at(-1)?.reference.slice(2)) || 0;
  return `S-${String(newest + 1).padStart(6, '0')}`;
}

/** Drops a message and the form key that answers with its reference. */
function forget(message: SupportMessage): void {
  const store = getStore();
  store.support.splice(store.support.indexOf(message), 1);
  for (const [stored, reference] of store.keys) {
    if (reference === message.reference && stored.startsWith('support:')) store.keys.delete(stored);
  }
}

/** Keeps a message once per key: a second send with the same key gets the first reference back. Nothing is sent in the fake. */
function keep(owner: string, key: string, message: Omit<SupportMessage, 'reference' | 'at'>): { reference: string; duplicate: boolean } {
  const store = getStore();
  const stored = keyOf('support', owner, key);
  const known = store.keys.get(stored);
  if (known) return { reference: known, duplicate: true };
  const reference = nextReference();
  store.support.push({ reference, at: now().toISOString(), ...message });
  store.keys.set(stored, reference);
  return { reference, duplicate: false };
}

const PROBLEM_TOPIC: SupportTopic = 'video';

export const support: SupportDesk = {
  async send({ topic, email, message, userId = null, jobId = null, key }) {
    if (!email.trim() || !message.trim()) throw new Error('message-required');
    const owner = userId ?? email.trim().toLowerCase();
    const store = getStore();
    // The same form again gets its first reference back, whatever the day looks like.
    if (userId && !store.keys.has(keyOf('support', owner, key))) {
      const since = now().getTime() - DAY_MS;
      if (store.support.filter((item) => item.userId === userId && Date.parse(item.at) > since).length >= MAX_PER_ACCOUNT_DAY) throw new Error('support-full');
    }
    if (!userId && !store.keys.has(keyOf('support', owner, key))) {
      const anonymous = store.support.filter((item) => item.userId === null);
      const since = now().getTime() - DAY_MS;
      if (anonymous.filter((item) => Date.parse(item.at) > since).length >= MAX_PER_DAY) throw new Error('support-full');
      // At the total the oldest anonymous message makes room: the form does not close for good.
      const oldest = anonymous[0];
      if (oldest && anonymous.length >= MAX_IN_ALL) forget(oldest);
    }
    return keep(owner, key, { topic, email: email.trim(), message: message.trim(), userId, jobId, problem: null });
  },

  async report(userId: Id, jobId: Id, problem: ProblemKind, note: string, key: string) {
    const user = findUser(userId);
    const job = liveJobs().find((item) => item.id === jobId && item.userId === userId && !item.deletedAt);
    if (!user || !job) throw new NotFoundError('job');
    const open = job.status === 'done' && job.finishedAt !== null && now().getTime() - Date.parse(job.finishedAt) <= RULES.reportDays * DAY_MS;
    if (!open) throw new Error('report-closed');
    if (problem === 'not-me' && !job.swap) throw new Error('invalid-problem');
    return keep(userId, key, { topic: PROBLEM_TOPIC, email: user.email, message: note.trim(), userId, jobId, problem });
  },

  async messages() {
    return newestFirst(getStore().support, (message) => message.at).map((message) => ({ ...message }));
  },
};
