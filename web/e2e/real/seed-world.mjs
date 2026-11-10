// Seeds a temp data dir for the real e2e: the engine's own seed over the golden templates only (no productions, no candidates),
// both scan sources off, and a scripted-LLM answers file. Run by world.ts as a child process: `node seed-world.mjs <dir>`, cwd viraleditor.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = resolve(process.argv[2]);
const engine = resolve(process.cwd(), 'src');
const load = (file) => import(pathToFileURL(join(engine, file)).href);
const { openDb } = await load('db/open.ts');
const { createMedia } = await load('adapters/media.ts');
const { seed } = await load('seed/seed.ts');
const { readSettings, writeSettings } = await load('db/settings.ts');

const find = (name) => ['/opt/homebrew/bin/', '/usr/local/bin/', '/usr/bin/'].map((p) => p + name).find((p) => { try { readFileSync(p); return true; } catch { return false; } }) ?? name;
const db = openDb(join(dir, 'db.sqlite'));
const empty = (name) => { const p = join(dir, '_seed-' + name); mkdirSync(p, { recursive: true }); return p; };
await seed(
  { db, media: createMedia(find('ffmpeg'), find('ffprobe')), clock: { now: () => new Date() }, dataDir: dir },
  { golden: join(engine, 'resolve', 'golden'), productions: empty('productions'), candidates: empty('candidates') },
);
writeSettings(db, { ...readSettings(db), sources: { topads: false, shorts: false } });

// The scripted LLM: one fill per template id (the prompt contains the template id), one variant.
const answers = ['layering-01', 'lashly-01'].map((id) => {
  const fill = JSON.parse(readFileSync(join(engine, 'resolve', 'golden', id, 'fill.json'), 'utf8'));
  const rest = { ...fill };
  delete rest.language;
  delete rest.products;
  return { match: id, answer: { fills: [rest] } };
});
writeFileSync(join(dir, 'answers.json'), JSON.stringify({ answers }));
// the seed leaves templates `ready` (waiting for the admin to publish); the customer sees `published` ones
db.prepare("UPDATE templates SET state = 'published' WHERE state = 'ready'").run();
const rows = db.prepare('SELECT id, state FROM templates').all();
console.log(JSON.stringify(rows));
db.close();
