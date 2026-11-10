'use server';

import { notFound } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { data } from '@/data';
import { InsufficientCreditsError, NotFoundError, PriceChangedError } from '@/data/ports';

export type ResumeOutcome =
  | { status: 'ok' }
  | { status: 'price-changed'; cost: number; balance: number }
  | { status: 'insufficient'; cost: number; balance: number }
  | { status: 'error'; providerCap?: boolean; swapClosed?: boolean };

/**
 * "Confirm and continue" of a stopped job. "Continue with the backup model" and "Try again" both end here: the fake has one resume path.
 * `confirmedCost` is the cost the confirmation showed. The job runner charges only while the cost is still that one;
 * otherwise nothing is spent and the answer carries the cost of now. `swapClosed`: a person swap, and person swap was switched off since the
 * page was read; nothing is spent and the page is read again, where it says so.
 */
export async function resumeJob(id: string, confirmedCost: number): Promise<ResumeOutcome> {
  const user = await requireUser();
  if (typeof id !== 'string' || !Number.isInteger(confirmedCost) || confirmedCost < 0) return { status: 'error' };
  try {
    await data.jobs.resume(id, user.id, confirmedCost);
  } catch (error) {
    if (error instanceof Error && error.message === 'provider-cap') return { status: 'error', providerCap: true };
    if (error instanceof Error && error.message === 'swap-closed') {
      refreshShell();
      return { status: 'error', swapClosed: true };
    }
    if (error instanceof NotFoundError) notFound();
    if (error instanceof PriceChangedError) return { status: 'price-changed', cost: error.cost, balance: await data.ledger.balance(user.id) };
    if (error instanceof InsufficientCreditsError) return { status: 'insufficient', cost: error.needed, balance: error.balance };
    return { status: 'error' };
  }
  refreshShell();
  return { status: 'ok' };
}

export type CloseOutcome = { status: 'ok' } | { status: 'error' };

/**
 * "Close the job" of a stopped job (`A-Is-Kapat-Onay`): the saved parts are deleted, nothing is charged, the credits that came back stay.
 * Only a stopped job closes; the owner only (someone else's job is a 404). A job that is already closed is returned as it is.
 */
export async function closeJob(id: string): Promise<CloseOutcome> {
  const user = await requireUser();
  if (typeof id !== 'string') return { status: 'error' };
  try {
    await data.jobs.close(id, user.id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    return { status: 'error' };
  }
  refreshShell();
  return { status: 'ok' };
}
