'use server';

import { attemptAllowed } from '@/core/rate-limit/attempts';
import { limiter, rulesFor } from '@/core/rate-limit/rate-limit';
import { getSessionUser } from '@/core/session/session';
import { data } from '@/data';
import { validateContact, type ContactErrors, type ContactInput } from './contact';

export type ContactState = {
  status: 'idle' | 'error' | 'failed' | 'limited' | 'sent';
  errors: ContactErrors;
  values: ContactInput;
  /** Set when `sent`: the reference of the message, and whether this very message had been sent before (the same form instance). */
  reference?: string;
  duplicate?: boolean;
};

/** A form key is a UUID; a longer one is not ours and is not kept. */
const MAX_KEY = 64;

const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
};

/**
 * Sends the message to the support desk. A signed-in visitor writes from the address of the account (the form has no email field and the
 * browser's value is ignored) and may name one of their own jobs. `key` is one per form instance: the same key again answers with the same
 * reference and `duplicate`. A failure keeps the fields (`failed`); so does a message over the rate limit, which says so (`limited`).
 */
export async function submitContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const user = await getSessionUser();
  const values: ContactInput = {
    topic: text(formData, 'topic'),
    email: user ? user.email : text(formData, 'email'),
    link: text(formData, 'link'),
    message: text(formData, 'message'),
    jobId: text(formData, 'jobId'),
  };
  const result = validateContact(values);
  if (!result.ok) return { status: 'error', errors: result.errors, values };
  const { topic, email, link, message } = result.data;
  // A signed-in sender is counted by the account, so anonymous callers sharing one bucket cannot close the form for a customer.
  const allowed = user ? limiter.allow(rulesFor('contact', `user:${user.id}`, email)) : await attemptAllowed('contact', email);
  if (!allowed) return { status: 'limited', errors: {}, values };
  // Only the user's own job can be named; anything else is dropped.
  const jobs = user ? await data.jobs.listFor(user.id) : [];
  const jobId = jobs.find((job) => job.id === values.jobId)?.id ?? null;
  const body = link ? `${message}\n\n${link}` : message;
  const formKey = text(formData, 'key');
  const key = formKey && formKey.length <= MAX_KEY ? formKey : crypto.randomUUID();
  try {
    const sent = await data.support.send({ topic, email, message: body, userId: user?.id ?? null, jobId, key });
    return { status: 'sent', errors: {}, values, reference: sent.reference, duplicate: sent.duplicate };
  } catch {
    return { status: 'failed', errors: {}, values };
  }
}
