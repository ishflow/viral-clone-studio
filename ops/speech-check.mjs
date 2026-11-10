import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createTranscriber } from '../viraleditor/src/adapters/transcriber.ts';
import { alignmentShare, parseScript } from '../viraleditor/src/resolve/index.ts';
import { SPOKEN_SHARE } from '../viraleditor/src/produce/speech.ts';

const USAGE = `usage: ops/speech-check.sh <clip.mp4> "<line>" [--language en]

Listens to a local clip with the engine's own whisper and says whether it speaks the line.
Prints: heard words, expected words, share, threshold, verdict (speaks its lines / does not speak).
Exit 0 when the measurement was made (whatever the verdict); non-zero when the tool could not run.
Offline: no network, no keys, nothing written outside the system temp folder. A whisper model that is not on this machine is not downloaded.`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
const li = args.indexOf('--language');
let language = 'en';
if (li !== -1) { language = args[li + 1] ?? ''; args.splice(li, 2); }
const [clip, line, ...rest] = args;
if (!clip || line === undefined || rest.length > 0 || !language) { console.error(USAGE); process.exit(2); }

try {
  const file = resolve(clip);
  if (!existsSync(file)) throw new Error(`clip not found: ${file}`);
  const expected = parseScript(line).words;
  if (expected.length === 0) throw new Error('the line has no words');
  const bin = join(import.meta.dirname, '../viraleditor/node_modules/.bin/hyperframes');
  if (!existsSync(bin)) throw new Error(`hyperframes CLI not found: ${bin}`);
  const heard = await createTranscriber(bin).words(file, language);
  const share = alignmentShare(expected, heard);
  console.log(`heard:     ${heard.map((w) => w.text).join(' ') || '(nothing)'}`);
  console.log(`expected:  ${expected.join(' ')}`);
  console.log(`share: ${Number(share.toFixed(2))}`);
  console.log(`threshold: ${SPOKEN_SHARE}`);
  console.log(share >= SPOKEN_SHARE ? 'verdict: speaks its lines' : 'verdict: does not speak');
} catch (e) {
  console.error(`speech-check could not run: ${e instanceof Error ? (e.code ? `${e.code}: ` : '') + e.message : String(e)}`);
  process.exit(1);
}
