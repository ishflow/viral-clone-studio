import { forbidden, redirect } from 'next/navigation';
import type { User } from '@/data/ports';
import { getSessionState } from './session';

/**
 * The signed-in user with a verified email.
 * Signed out → /login (with `?next=<path>` when the caller gives the path to come back to).
 * Signed in but the email is not verified → /verify-email (spec §2: verification is mandatory). The verify page itself, logging out
 * and "use another email" do not use this guard, so they stay reachable.
 * Pages pass their own path; server actions call it without one. `nextPath` is server-supplied, never user input.
 */
export async function requireUser(nextPath?: string): Promise<User> {
  const state = await getSessionState();
  if (state.kind === 'blocked') redirect('/blocked');
  if (state.kind === 'expired') redirect(nextPath ? `/login?reason=expired&next=${encodeURIComponent(nextPath)}` : '/login?reason=expired');
  if (state.kind !== 'active') redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login');
  const user = state.user;
  if (!user.emailVerified) redirect('/verify-email');
  return user;
}

/** Admin access fails closed; blocked and expired sessions retain their dedicated recovery routes. */
export async function requireAdmin(): Promise<User> {
  const state = await getSessionState();
  if (state.kind === 'blocked') redirect('/blocked');
  if (state.kind === 'expired') redirect('/login?reason=expired');
  if (state.kind !== 'active' || state.user.role !== 'admin' || !state.user.emailVerified) forbidden();
  return state.user;
}
