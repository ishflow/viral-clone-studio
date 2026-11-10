import { z } from 'zod';

export const TOPICS = ['video', 'refund', 'payment', 'account', 'other'] as const;

export type ContactInput = { topic: string; email: string; link: string; message: string; jobId?: string };
export type ContactField = 'topic' | 'email' | 'link' | 'message';
export type ContactErrors = Partial<Record<ContactField, ContactField>>;

const schema = z.object({
  topic: z.enum(TOPICS),
  email: z.email().max(254),
  link: z.union([z.literal('').transform(() => undefined), z.url({ protocol: /^https$/ }).max(2000)]),
  message: z.string().trim().min(10).max(2000),
});

export type ContactResult =
  | { ok: true; data: { topic: (typeof TOPICS)[number]; email: string; link: string | undefined; message: string } }
  | { ok: false; errors: ContactErrors };

/** Error values are the field names: the form maps them to `marketing.contact.error.<field>`. */
export function validateContact(input: ContactInput): ContactResult {
  const parsed = schema.safeParse({ ...input, link: input.link.trim(), email: input.email.trim() });
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: ContactErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as ContactField;
    errors[field] ??= field;
  }
  return { ok: false, errors };
}
