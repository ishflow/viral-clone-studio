'use server';

import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import { settle, type ActionResult } from '../admin-common/types';
import { accessSchema, addCreditsSchema, type AddCreditsInput } from './schema';

export type ResetState = { status: 'idle' | 'sent' | 'error' };

/**
 * Adds credits by hand, with the reason the dialog asked for. Validated here, not in the browser; the dialog's key makes a retry write once.
 * No refresh here: the dialog shows its result first and refreshes the page when it closes.
 */
export async function addCredits(input: AddCreditsInput): Promise<ActionResult<{ credits: number; balanceAfter: number }>> {
  const admin = await requireAdmin();
  const parsed = addCreditsSchema.safeParse(input);
  if (!parsed.success) return { status: 'failed' };
  const { userId, credits, reason, key } = parsed.data;
  return settle(
    async () => {
      const entry = await data.admin.addCredits(admin.id, userId, credits, reason, key);
      return { outcome: 'done' as const, at: entry.at, value: entry };
    },
    (entry) => ({ credits, balanceAfter: entry.balanceAfter }),
  );
}

export async function sendPasswordReset(_previous: ResetState, form: FormData): Promise<ResetState> {
  await requireAdmin();
  const user = await data.auth.getUser(String(form.get('userId') ?? ''));
  if (!user) return { status: 'error' };
  try {
    await data.auth.requestPasswordReset(user.email);
  } catch {
    return { status: 'error' };
  }
  return { status: 'sent' };
}

/** Blocks or unblocks a user, with a reason. An admin cannot block their own account (the data layer refuses: `self`). */
export async function setAccess(input: { userId: string; blocked: boolean; reason: string }): Promise<ActionResult<{ blocked: boolean }>> {
  const admin = await requireAdmin();
  const parsed = accessSchema.safeParse(input);
  if (!parsed.success) return { status: 'failed' };
  const { userId, blocked, reason } = parsed.data;
  return settle(() => data.admin.setAccess(admin.id, userId, blocked, reason), (user) => ({ blocked: user.blocked }));
}
