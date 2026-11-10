import { NotFoundError, RULES } from '../ports';
import type { Drafts } from '../ports';
import { findUser, getStore, now } from './store';

const HOUR_MS = 3_600_000;

/** Drops the drafts whose time is over. */
function prune(): void {
  const store = getStore();
  store.drafts = store.drafts.filter((draft) => Date.parse(draft.expiresAt) > now().getTime());
}

/** B8: one draft per user and template, kept `RULES.draftHours` from its last save; a job started from that template removes it. */
export const drafts: Drafts = {
  async save(userId, input) {
    if (!findUser(userId)) throw new NotFoundError('user');
    prune();
    const store = getStore();
    const savedAt = now().toISOString();
    const draft = { userId, templateId: input.templateId, input: structuredClone(input), savedAt, expiresAt: new Date(now().getTime() + RULES.draftHours * HOUR_MS).toISOString() };
    store.drafts = [...store.drafts.filter((item) => !(item.userId === userId && item.templateId === input.templateId)), draft];
    return structuredClone(draft);
  },

  async get(userId, templateId) {
    prune();
    const draft = getStore().drafts.find((item) => item.userId === userId && item.templateId === templateId);
    return draft ? structuredClone(draft) : null;
  },

  async discard(userId, templateId) {
    const store = getStore();
    store.drafts = store.drafts.filter((item) => !(item.userId === userId && item.templateId === templateId));
  },
};
