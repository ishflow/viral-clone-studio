import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMedia } from '../adapters/media.ts';
import { openDb } from '../db/open.ts';
import { dataDir } from '../paths.ts';
import { formatReport, seed } from './seed.ts';

const src = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(src, '..', '..', '..');
const data = dataDir();

const report = await seed(
  {
    db: openDb(join(data, 'db.sqlite')),
    media: createMedia('/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe'),
    clock: { now: () => new Date() },
    dataDir: data,
  },
  {
    golden: join(src, '..', 'resolve', 'golden'),
    productions: join(repoRoot, 'productions'),
    candidates: join(repoRoot, 'references', '_candidates', '2026-10-03-secim'),
  },
);
console.log(process.argv.includes('--json') ? JSON.stringify(report) : formatReport(report));
