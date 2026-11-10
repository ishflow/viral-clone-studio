// A worker wired as worker/main.ts wires it (SIGTERM → the running run is handed back, the loop unwinds, exit 0), whose job runs a
// child through runProcess with killGroup, as every render does: `node shutdown-child.ts <db>` (C6, FINDING 9).
import { openDb } from '../db/open.ts';
import { runProcess } from '../adapters/exec.ts';
import { finish } from '../db/runs.ts';
import { runWorker } from '../worker/loop.ts';
import { exitOnSignals } from '../worker/main.ts';

const db = openDb(process.argv[2]!);
const clock = { now: () => new Date() };
const ok = async () => {};
const worker = runWorker({
  db, clock, workerId: 'worker-S', idleMs: 100, health: async () => ({ provider: 'fake', renderer: 'ready', note: null }),
  handlers: {
    scan: async (run) => {
      console.log('started');
      const r = await runProcess('/bin/sleep', ['3'], { killGroup: true });            // the render
      if (r.code !== 0) throw new Error(`the render exited ${r.code}`);
      finish(db, run.id, { kind: 'scan', checked: 1, aboveThreshold: 0, prepared: 0 }, clock.now());
    },
    produce: ok, prepare: ok, edit: ok,
  },
});
// worker/main.ts, `if (import.meta.main)`: the same call
exitOnSignals(worker);
