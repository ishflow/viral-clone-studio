// One-off: gives the templates already made the pictures of their reference video (see `backfillFrames`).
//   VC_DATA_DIR=<data dir> node src/prepare/backfill-frames.ts            dry run: says what it would do, writes nothing
//   VC_DATA_DIR=<data dir> node src/prepare/backfill-frames.ts --apply    takes the frames and writes the card images
// Pause the worker first. Undo: the new files are templates/<id>/poster.jpg (own templates only) and templates/<id>/shots/;
// put the database back from its backup (or set card.image and the shots' image of those rows to null again) and remove them.
import { join } from 'node:path';
import { createMedia } from '../adapters/media.ts';
import { openDb } from '../db/open.ts';
import { dataDir } from '../paths.ts';
import { backfillFrames } from './backfill.ts';

if (!process.env.VC_DATA_DIR) {
  console.error('VC_DATA_DIR is not set: say which data folder to work on (the script never falls back to the repository\'s own data/).');
  process.exit(1);
}
const data = dataDir();
const db = openDb(join(data, 'db.sqlite'));
try {
  const apply = process.argv.includes('--apply');
  const report = await backfillFrames({ db, dataDir: data, media: createMedia('/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe'), clock: { now: () => new Date() } }, { apply }, console.log);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2));
} finally { db.close(); }
