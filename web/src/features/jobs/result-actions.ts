'use server';

import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { data } from '@/data';
import { InsufficientCreditsError, NotFoundError, PriceChangedError, type ProblemKind } from '@/data/ports';

const KINDS: readonly ProblemKind[] = ['looks-different', 'text-wrong', 'does-not-play', 'other', 'not-me'];
const MAX_NOTE = 1000;

export type ReportOutcome = { status: 'sent' } | { status: 'closed' } | { status: 'error' };

/**
 * "Report a problem" of a delivered video: the job id goes with it, the note is optional. The same `key` (one per window) is one report.
 * `closed`: the window of `RULES.reportDays` after delivery is over, or the video is not one that was delivered.
 */
export async function reportProblem(jobId: unknown, kind: unknown, note: unknown, key: unknown): Promise<ReportOutcome> {
  const user = await requireUser();
  if (typeof jobId !== 'string' || typeof key !== 'string' || key === '' || !KINDS.includes(kind as ProblemKind)) return { status: 'error' };
  const text = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE) : '';
  try {
    await data.support.report(user.id, jobId, kind as ProblemKind, text, key);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    return { status: error instanceof Error && error.message === 'report-closed' ? 'closed' : 'error' };
  }
  return { status: 'sent' };
}

export type DeleteOutcome = { status: 'error' };

/** "Delete video": the delivered job and its videos go from the customer's lists (the credits are not returned), then My videos. An answer means nothing was deleted. */
export async function deleteJobVideo(jobId: unknown): Promise<DeleteOutcome> {
  const user = await requireUser();
  if (typeof jobId !== 'string' || jobId === '') return { status: 'error' };
  try {
    await data.jobs.deleteVideo(jobId, user.id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    return { status: 'error' };
  }
  refreshShell();
  redirect('/videos');
}

export type RegenerateOutcome =
  | { status: 'ok' }
  | { status: 'price-changed'; cost: number; balance: number }
  | { status: 'insufficient'; cost: number; balance: number }
  | { status: 'images-expired' }
  | { status: 'error'; providerCap?: boolean };

/**
 * "Generate the missing variant again": only that variant is made again, for the price the dialog showed (`confirmedCost`); at another
 * price nothing is charged and the answer carries the price of now. The job stays delivered.
 */
export async function regenerateVariant(jobId: unknown, variantId: unknown, confirmedCost: unknown): Promise<RegenerateOutcome> {
  const user = await requireUser();
  if (typeof jobId !== 'string' || typeof variantId !== 'string' || typeof confirmedCost !== 'number' || !Number.isInteger(confirmedCost) || confirmedCost < 0) return { status: 'error' };
  try {
    await data.jobs.regenerateVariant(jobId, user.id, variantId, confirmedCost);
  } catch (error) {
    if (error instanceof Error && error.message === 'provider-cap') return { status: 'error', providerCap: true };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof PriceChangedError) return { status: 'price-changed', cost: error.cost, balance: await data.ledger.balance(user.id) };
    if (error instanceof InsufficientCreditsError) return { status: 'insufficient', cost: error.needed, balance: error.balance };
    if (error instanceof Error && error.message === 'images-expired') return { status: 'images-expired' };
    return { status: 'error' };
  }
  refreshShell();
  return { status: 'ok' };
}
