// Local C1d diagnostic. No dependencies fetched, upstream files changed, or evidence removed.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, readdirSync, readFileSync, appendFileSync, statfsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const [compositionArg, countArg = '40', quality = 'draft', loadArg = '8', archiveArg] = process.argv.slice(2);
if (!compositionArg || !archiveArg) {
  throw Error('Usage: node src/sweep/capture-investigation.mjs <composition> <count> <draft|looks> <load threads> <new archive>');
}
const iterations = Number(countArg);
const loadThreads = Number(loadArg);
if (!['draft', 'looks'].includes(quality) || !Number.isInteger(iterations) || iterations < 1 || iterations > 200
  || !Number.isInteger(loadThreads) || loadThreads < 0 || loadThreads > 8) {
  throw Error('Invalid bounded investigation options');
}
const composition = resolve(compositionArg);
const root = resolve(archiveArg);
if (root === composition || root.startsWith(composition + '/')) throw Error('Archive must be outside the composition');
mkdirSync(root, { recursive: true });
if (readdirSync(root).length) throw Error('Archive must be empty; retained evidence is never overwritten');
const timeline = JSON.parse(readFileSync(join(composition, 'timeline.json'), 'utf8'));
const frameCount = timeline.frames;
if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 1800 || timeline.fps !== 30) {
  throw Error('Requires a bounded 30-fps timeline');
}
const bin = fileURLToPath(new URL('../../node_modules/.bin/hyperframes', import.meta.url));
const ffmpeg = process.env.VE_FFMPEG ?? 'ffmpeg';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const env = {
  ...process.env, KEEP_TEMP: '1', HYPERFRAMES_NO_TELEMETRY: '1',
  HYPERFRAMES_NO_UPDATE_CHECK: '1', DO_NOT_TRACK: '1', NO_COLOR: '1',
};
const version = spawnSync(bin, ['--version'], { env, encoding: 'utf8', timeout: 30_000 });
if (version.status !== 0 || version.stdout.trim() !== '0.8.120') throw Error('Requires installed HyperFrames 0.8.120');
writeFileSync(join(root, 'manifest.json'), JSON.stringify({
  hyperframes: version.stdout.trim(), composition, iterations, quality, loadThreads,
  workers: 4, frames: frameCount, fps: 30, debug: false, keepTemp: true,
}, null, 2));
cpSync(composition, join(root, 'composition'), { recursive: true, dereference: true, errorOnExist: true, force: false });

// KEEP_TEMP retains normal capture files without --debug logging. Later CLI startups still sweep old work-* dirs.
const workDirectories = () => readdirSync(root)
  .filter(name => (name.startsWith('work-') || name.startsWith('.tmp-render-')) && statSync(join(root, name)).isDirectory());
function decoded(file) {
  const result = spawnSync(ffmpeg, [
    '-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', file,
    '-map', '0:v:0', '-f', 'framemd5', '-',
  ], { encoding: 'utf8', maxBuffer: 1 << 24, timeout: 120_000 });
  if (result.status !== 0) throw Error(result.stderr || 'Frame decoding failed');
  return result.stdout.split('\n').filter(line => line && !line.startsWith('#'))
    .map(line => line.split(',').at(-1).trim());
}
function inputHash() {
  const entries = [];
  function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      const info = statSync(file);
      if (info.isDirectory()) visit(file);
      else if (info.isFile()) entries.push([file.slice(composition.length), hash(readFileSync(file))]);
    }
  }
  visit(composition);
  return hash(Buffer.from(JSON.stringify(entries)));
}
function checkCapacity() {
  // Fixed command, no caller input enters the shell. Keep T1's official counter verbatim.
  const counter = spawnSync('sh', ['-c',
    "ps -axo command | grep -E '[v]itest run|playwright test|[v]ite-node|hyperframes render|[c]li/main.ts (render|produce)' | grep -v 'sh -c' | grep -v -E 'grep|Renderer|--type=renderer' | wc -l",
  ], { encoding: 'utf8', timeout: 10_000 });
  const jobs = Number(counter.stdout.trim());
  if (counter.status !== 0 || !Number.isInteger(jobs) || jobs > 1) {
    throw Error('Test/render slots occupied; restart with a fresh archive after a slot is available');
  }
  const disk = statfsSync(root);
  if (disk.bavail * disk.bsize < 10 * 1024 ** 3) throw Error('Less than 10 GiB available; evidence retained, render stopped');
}

checkCapacity();
const burners = Array.from({ length: loadThreads }, () => new Worker(new URL('./capture-load.mjs', import.meta.url)));
let reference;
try {
  for (let n = 1; n <= iterations; n++) {
    checkCapacity();
    const before = workDirectories();
    const output = join(root, `render-${n}.mp4`);
    const compositionHash = inputHash();
    const result = spawnSync(bin, [
      'render', composition, '--fps', '30', '--quality', quality, '--workers', '4', '--output', output,
    ], { env, encoding: 'utf8', timeout: 120_000, maxBuffer: 1 << 24 });
    writeFileSync(join(root, `render-${n}.log`), `${result.stdout}\n${result.stderr}`);
    if (result.status !== 0) throw Error(`Render ${n} failed ${result.status}`);
    const retained = workDirectories().filter(dir => !before.includes(dir));
    const logged = (result.stdout + '\n' + result.stderr).match(/"workDir":"([^"]+)"/g)?.at(-1);
    const work = retained[0] ? join(root, retained[0]) : logged ? JSON.parse(`{${logged}}`).workDir : null;
    if (!work) throw Error('Cannot locate retained work directory');
    const captures = join(root, `capture-${n}`);
    // Preserve bytes before the next normal CLI startup sweeps abandoned work directories.
    cpSync(join(work, 'captured-frames'), captures, { recursive: true, errorOnExist: true, force: false });
    const names = readdirSync(captures).filter(file => /^frame_.*\.(jpg|png)$/.test(file)).sort();
    const raw = names.map(file => hash(readFileSync(join(captures, file))));
    const picture = decoded(output);
    reference ??= { raw, picture, compositionHash };
    const changed = (current, baseline) => current.flatMap((value, frame) => value !== baseline[frame] ? [frame] : []);
    const row = {
      n, quality, compositionHash, compositionChanged: compositionHash !== reference.compositionHash,
      work, captures, rawFrames: raw.length, rawHashes: raw, pictureHashes: picture,
      rawChanged: changed(raw, reference.raw), pictureChanged: changed(picture, reference.picture),
    };
    appendFileSync(join(root, 'frames.jsonl'), JSON.stringify(row) + '\n');
    console.log(JSON.stringify({
      n, quality, rawFrames: raw.length, compositionChanged: row.compositionChanged,
      rawChanged: row.rawChanged, pictureChanged: row.pictureChanged,
    }));
    if (raw.length !== frameCount || picture.length !== frameCount) throw Error('Incomplete frame archive');
    if (row.compositionChanged || row.rawChanged.length || row.pictureChanged.length) {
      process.exitCode = 1;
      break;
    }
  }
} finally {
  for (const worker of burners) await worker.terminate();
}
