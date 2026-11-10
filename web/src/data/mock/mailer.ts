import type { EmailKind, Mailer, SentEmail } from '../ports';
import { getStore, newestFirst, now } from './store';

/** Puts an email in the outbox. Nothing is sent. The other fakes call this inside their own writes. */
export function keepEmail(kind: EmailKind, to: string, data: Record<string, string>): SentEmail {
  const email: SentEmail = { id: crypto.randomUUID(), kind, to, at: now().toISOString(), data: { ...data } };
  getStore().outbox.push(email);
  return email;
}

export const mailer: Mailer = {
  async send(kind, to, data) {
    keepEmail(kind, to, data);
  },
  /** Newest first. */
  async outbox() {
    return newestFirst(getStore().outbox, (email) => email.at).map((email) => structuredClone(email));
  },
};
