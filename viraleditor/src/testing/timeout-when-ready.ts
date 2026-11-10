import { vi } from 'vitest';

const realSetTimeout = globalThis.setTimeout;
const pause = (ms: number): Promise<void> => new Promise((resolve) => realSetTimeout(resolve, ms));

/**
 * Starts a run (`start` calls `runProcess` with a `timeoutMs`) so that its timeout counts from the moment the child is up, not from the spawn.
 * How long a `node` child takes to start depends on the load of the machine (at a load of 100 it took more than 400 ms to print its first
 * line), and a timeout test needs the child to be there, doing what it does, when the timeout fires. Only setTimeout / clearTimeout are
 * faked while this runs: the timer the run arms is held until `ready()` says so, then it is fired by `timeoutMs`.
 */
export async function timeoutWhenReady<T>(start: () => Promise<T>, ready: () => boolean | Promise<boolean>, timeoutMs: number): Promise<T> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    let ended = false;
    const run = start();
    run.then(() => { ended = true; }, () => { ended = true; });
    while (!ended && !(await ready())) await pause(10);
    vi.advanceTimersByTime(timeoutMs);
    return await run;
  } finally {
    vi.useRealTimers();
  }
}
