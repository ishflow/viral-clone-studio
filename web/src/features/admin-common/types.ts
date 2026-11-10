/** One line of a confirmation: a label and its value. */
export type ActionRow = { label: string; value: string };

/**
 * What a server action of the admin panel answers to the confirmation dialog (contract §12, B25).
 * `done`: it worked; `detail` is what the result summary shows. `already`: it had been done at `at`, nothing changed now.
 * `failed`: it did not go through and nothing was changed.
 * `refused`: it was sent and the other side said no; what was changed on the way was put back, and the same try cannot be sent again.
 * `why` names the other side's reason, where it gave one the admin can act on.
 */
export type ActionResult<D = null> = { status: 'done'; at: string; detail: D } | { status: 'already'; at: string } | { status: 'failed' } | { status: 'refused'; why?: string };

/** The reason an admin writes: required, trimmed, at most 200 characters. */
export const REASON_MAX = 200;

/** Turns a data-layer `AdminResult` (or an error) into the answer above. `failed` for anything unexpected. */
export async function settle<T, D>(run: () => Promise<{ outcome: 'done' | 'already-done'; at: string; value: T }>, detail: (value: T) => D | Promise<D>): Promise<ActionResult<D>> {
  try {
    const result = await run();
    if (result.outcome === 'already-done') return { status: 'already', at: result.at };
    return { status: 'done', at: result.at, detail: await detail(result.value) };
  } catch {
    return { status: 'failed' };
  }
}
