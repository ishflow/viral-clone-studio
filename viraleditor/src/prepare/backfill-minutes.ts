// One-off: writes the minutes of the estimate again for the templates already made (see `backfillMinutes`).
//   VC_DATA_DIR=<data dir> node src/prepare/backfill-minutes.ts            dry run: says what it would do, writes nothing
//   VC_DATA_DIR=<data dir> node src/prepare/backfill-minutes.ts --apply    writes the minutes
// Offline: no download, no model, no paid call, no key. It writes the `minutes` column of `templates` and nothing else; a run
// after it finds nothing to do. Undo: put the database back from its backup (the dry run lists the old minutes of each row).
import { join } from 'node:path';
import { openDb } from '../db/open.ts';
import { dataDir } from '../paths.ts';
import { backfillMinutes } from './backfill.ts';

if (!process.env.VC_DATA_DIR) {
  console.error('VC_DATA_DIR is not set: say which data folder to work on (the script never falls back to the repository\'s own data/).');
  process.exit(1);
}
const data = dataDir();
const db = openDb(join(data, 'db.sqlite'));
try {
  const apply = process.argv.includes('--apply');
  const report = backfillMinutes({ db, dataDir: data }, { apply }, console.log);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2));
} finally { db.close(); }
