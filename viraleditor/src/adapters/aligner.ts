// Forced alignment of a KNOWN script on the sound of a clip: starts tools/align/align.py (wav2vec2 CTC through torchaudio) in its own
// Python environment. Optional: when the environment is not there, `ready()` says so and `align` rejects with `not-installed`.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AlignedWord, Aligner } from '../ports.ts';
import { ExecError, runProcess } from './exec.ts';

export type AlignErrorCode = 'not-installed' | 'language-unsupported' | 'bad-media' | 'tool-failed' | 'bad-output' | 'timeout';
export class AlignError extends Error {
  code: AlignErrorCode;
  constructor(code: AlignErrorCode, message: string) { super(message); this.name = 'AlignError'; this.code = code; }
}
export interface AlignerOptions {
  python?: string;      // the environment's interpreter; default tools/align/.venv/bin/python
  script?: string;      // default tools/align/align.py
  timeoutMs?: number;   // one alignment; default 10 minutes
}

const TOOL_DIR = resolve(import.meta.dirname, '../../tools/align');
/** Every child gets these: no library in it may look for anything online. align.py also closes the socket module itself. */
export const ALIGN_ENV = { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', UV_OFFLINE: '1' };
const READY_TIMEOUT_MS = 3 * 60_000;

const Answer = z.object({
  words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number(), score: z.number().min(0).max(1) })),
  model: z.string(),
  seconds: z.number().positive(),
});
const Failure = z.object({ error: z.string(), message: z.string() });
const Ready = z.object({ ready: z.boolean(), note: z.string().nullable() });

export function englishOnly(language: string): boolean {
  return /^en($|[-_])/i.test(language);
}

/**
 * Why `media` may not be handed to the tool, or null. The tool gives it to ffmpeg, which opens a connection for a URL and reads
 * "concat:", "subfile,", "pipe:", "fd:" … as protocols and a leading "-" as an option: only an existing regular file passes.
 */
export function mediaFault(media: string): string | null {
  if (media === '' || media.startsWith('-') || media.startsWith('subfile,') || /^[A-Za-z0-9+.-]*:/.test(media)) return 'not a local file path (a URL, an ffmpeg protocol or an option)';
  try {
    return statSync(media).isFile() ? null : 'not a regular file';
  } catch {
    return 'no such file';
  }
}

/** What is wrong with an answer, or null: one entry per given word with the given text, start < end, no overlap, inside the media. */
function fault(answer: z.infer<typeof Answer>, given: string[]): string | null {
  if (answer.words.length !== given.length) return `${answer.words.length} words for ${given.length} given`;
  let before = 0;
  for (const [i, w] of answer.words.entries()) {
    if (w.text !== given[i]) return `word ${i} is "${w.text}", given "${given[i]}"`;
    if (!(w.start < w.end)) return `word ${i} "${w.text}" has no length (${w.start} … ${w.end})`;
    if (w.start < before) return `word ${i} "${w.text}" starts at ${w.start}, before ${i === 0 ? 'the media' : 'the word before it ends'} (${before})`;
    if (w.end > answer.seconds) return `word ${i} "${w.text}" ends at ${w.end}, after the media (${answer.seconds})`;
    before = w.end;
  }
  return null;
}

export function createAligner(options: AlignerOptions = {}): Aligner {
  const python = options.python ?? resolve(TOOL_DIR, '.venv/bin/python');
  const script = options.script ?? resolve(TOOL_DIR, 'align.py');
  const notInstalled = `no Python environment at ${python}: build it offline with tools/align/setup.sh`;
  return {
    async align(media, words, language) {
      if (!englishOnly(language)) throw new AlignError('language-unsupported', `no alignment model for "${language}": English only`);
      const refused = mediaFault(media);
      if (refused !== null) throw new AlignError('bad-media', `${refused}: ${media.slice(0, 200)}`);
      if (words.length === 0) return [];
      let r;
      try {
        r = await runProcess(python, [script], { input: JSON.stringify({ media: resolve(media), words, language }), env: ALIGN_ENV, timeoutMs: options.timeoutMs ?? 10 * 60_000, killGroup: true });
      } catch (e) {
        if (e instanceof ExecError) {
          if (e.code === 'timeout') throw new AlignError('timeout', e.message);
          if (e.code === 'output-limit') throw new AlignError('tool-failed', e.message);   // it ran, and wrote far too much
          throw new AlignError('not-installed', `${notInstalled} (${e.message})`);
        }
        throw e;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
      if (r.code !== 0) {
        const failure = Failure.safeParse(parsed);
        const code = failure.success && (failure.data.error === 'not-installed' || failure.data.error === 'language-unsupported' || failure.data.error === 'bad-media') ? failure.data.error : 'tool-failed';
        throw new AlignError(code, `align.py exited ${r.code}: ${failure.success ? failure.data.message : (r.stderr || r.stdout).trim().slice(-500)}`);
      }
      const answer = Answer.safeParse(parsed);
      if (!answer.success) throw new AlignError('bad-output', `align.py answered something else than one result object: ${parsed === undefined ? r.stdout.trim().slice(0, 200) : answer.error.message.slice(0, 300)}`);
      const wrong = fault(answer.data, words);
      if (wrong !== null) throw new AlignError('bad-output', `align.py: ${wrong}`);
      return answer.data.words.map((w): AlignedWord => ({ text: w.text, start: w.start, end: w.end, score: w.score }));
    },
    async ready() {
      let r;
      try {
        r = await runProcess(python, [script, '--check'], { env: ALIGN_ENV, timeoutMs: READY_TIMEOUT_MS, killGroup: true });
      } catch (e) {
        if (e instanceof ExecError) return { ready: false, note: e.code === 'spawn-failed' ? notInstalled : e.message };
        throw e;
      }
      try {
        return Ready.parse(JSON.parse(r.stdout));
      } catch {
        return { ready: false, note: `align.py --check exited ${r.code}: ${(r.stderr || r.stdout).trim().slice(-300) || 'no answer'}` };
      }
    },
  };
}
