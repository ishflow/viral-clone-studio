/**
 * A small in-memory sliding-window limiter for the anonymous auth actions (review I2). One process, one Map: it does not
 * protect several servers (a shared store is the real adapter's job), but it stops a loop against one server.
 * Memory is bounded: a key is dropped once its newest hit is older than its window, and the map has a hard size cap.
 * A `pinned` rule is a count of the whole site under one fixed key: the hard cap never drops it, or whoever fills the map with
 * other keys would wash it out. Its key must not come from the caller.
 */
export interface Rule { key: string; max: number; windowMs: number; pinned?: boolean }

const SWEEP_EVERY = 200;     // calls between two full sweeps
const MAX_KEYS = 10_000;     // hard cap: past it the oldest keys go

interface Entry { hits: number[]; windowMs: number; pinned?: boolean }

export function createLimiter(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  let calls = 0;

  const prune = (entry: Entry, at: number) => {
    const from = at - entry.windowMs;
    let drop = 0;
    while (drop < entry.hits.length && (entry.hits[drop] ?? Infinity) <= from) drop++;
    if (drop) entry.hits.splice(0, drop);
  };
  const sweep = (at: number) => {
    for (const [key, entry] of entries) {
      prune(entry, at);
      if (!entry.hits.length) entries.delete(key);
    }
    // Map keeps insertion order: the first keys are the oldest.
    for (const [key, entry] of entries) {
      if (entries.size <= MAX_KEYS) break;
      if (!entry.pinned) entries.delete(key);
    }
  };

  return {
    /**
     * Every rule must have room, then every rule records this attempt. One refused rule records nothing, so a refused
     * attempt does not extend anybody's lock. Returns true when the attempt may go on.
     */
    allow(rules: Rule[]): boolean {
      const at = now();
      if (++calls % SWEEP_EVERY === 0) sweep(at);
      for (const rule of rules) {
        const entry = entries.get(rule.key);
        if (!entry) continue;
        prune(entry, at);
        if (entry.hits.length >= rule.max) return false;
      }
      for (const rule of rules) {
        const entry = entries.get(rule.key) ?? { hits: [], windowMs: rule.windowMs };
        entry.windowMs = Math.max(entry.windowMs, rule.windowMs);
        if (rule.pinned) entry.pinned = true;
        entry.hits.push(at);
        entries.set(rule.key, entry);
      }
      if (entries.size > MAX_KEYS) sweep(at);
      return true;
    },
    size: () => entries.size,
    keys: () => [...entries.keys()],
    reset: () => entries.clear(),
  };
}

const MAX_KEY_PART = 128;    // a key part longer than this is cut: the map cannot be fed memory through a long form field

/** One mailbox, one key: case, spaces and a `+tag` in the local part do not make a second address (`a+1@x.com` is `a@x.com`). */
function mailbox(email: string): string {
  const [local = '', ...rest] = email.trim().toLowerCase().split('@');
  return `${local.split('+')[0]}@${rest.join('@')}`.slice(0, MAX_KEY_PART);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The numbers (Ruling: the suggested ones of the brief). `key` = the caller's address, `email` = the normalised address. */
export const LIMITS = {
  signUp: { key: { max: 5, windowMs: HOUR } },
  logIn: { key: { max: 10, windowMs: 10 * MINUTE }, email: { max: 10, windowMs: 10 * MINUTE } },
  reset: { key: { max: 10, windowMs: HOUR }, email: { max: 3, windowMs: 10 * MINUTE } },
  setPassword: { key: { max: 10, windowMs: HOUR }, email: { max: 5, windowMs: 10 * MINUTE } },
  /** The contact form is open to anyone and every message is kept: the address is whatever the sender typed, so the caller rule matters most. */
  contact: { key: { max: 10, windowMs: HOUR }, email: { max: 5, windowMs: HOUR } },
  resend: { key: { max: 10, windowMs: HOUR }, email: { max: 3, windowMs: 10 * MINUTE } },
} as const;

export type LimitedAction = keyof typeof LIMITS;

export const limiter = createLimiter();

/** The rules of one action for this caller; the email part is left out when there is no usable address. */
export function rulesFor(action: LimitedAction, client: string, email?: string): Rule[] {
  const set: { key: { max: number; windowMs: number }; email?: { max: number; windowMs: number } } = LIMITS[action];
  const rules: Rule[] = [{ key: `${action}:key:${client.slice(0, MAX_KEY_PART)}`, ...set.key }];
  const normalised = email ? mailbox(email) : '';
  if (set.email && normalised) rules.push({ key: `${action}:email:${normalised}`, ...set.email });
  return rules;
}
