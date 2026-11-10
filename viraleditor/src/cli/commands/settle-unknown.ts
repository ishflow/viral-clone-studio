import { join } from 'node:path';
import { openDb } from '../../db/open.ts';
import { dataDir } from '../../paths.ts';
import { refundProvider } from '../../robust/provider-budget.ts';
import { providerCaps } from '../../robust/provider-policy.ts';
import { settleUnknown } from '../../robust/settle-unknown.ts';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { Stop, issue } from '../issue.ts';
import { pathOf } from '../project.ts';

const WHY: Record<string, string> = {
  'not-settleable': 'The run is not a stopped produce run with the stop reason submission-unknown.',
  'not-unknown': 'The run has no request in the unknown state (or a --keys entry is not one): nothing to settle.',
  'has-ticket': 'An unknown request of this run has a ticket: the provider accepted it. It is asked for by its ticket, never settled.',
  'by-required': 'Say who settles it: --by needs a name.',
};

export const settleUnknownCommand: Command<Context> = {
  name: 'settle-unknown',
  summary: 'After a produce run stopped with submission-unknown, say that the provider has no task for the request (look in its task list first): each unknown request becomes failed and the run can be continued. Records who and when. Paying twice is on you if the task exists.',
  args: [{ name: 'run', help: 'the id of the stopped produce run' }],
  flags: [
    { name: 'by', type: 'string', value: '<name>', required: true, help: 'who looked at the provider\'s task list and settles it; written into the request' },
    { name: 'keys', type: 'string', value: '<k1,k2>', help: 'settle only these requests (by key, e.g. v1:image:s2); default every unknown one' },
    { name: 'data-dir', type: 'string', value: '<dir>', help: 'the installation data directory; otherwise VC_DATA_DIR or the engine default' },
  ],
  async run(input, context) {
    const root = input.flags['data-dir'] === undefined ? dataDir() : pathOf(context, String(input.flags['data-dir']));
    const keys = input.flags.keys === undefined ? undefined : String(input.flags.keys).split(',').map((key) => key.trim()).filter(Boolean);
    const db = openDb(join(root, 'db.sqlite'));
    try {
      const caps = process.env.VC_PROVIDER === 'magnific' ? providerCaps(process.env) : null;
      const done = settleUnknown(db, caps ? (key, units, at) => refundProvider(db, caps, key, units, at) : null, { runId: input.args.run!, by: String(input.flags.by), at: context.clock.now(), ...(keys ? { keys } : {}) });
      return { result: { runId: input.args.run, settled: done.keys, unitsGivenBack: done.refunded, dataDir: root } };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (WHY[code]) throw new Stop([issue('argument-value', { target: 'settle-unknown' }, WHY[code]!)]);
      throw error;
    } finally { db.close(); }
  },
};
