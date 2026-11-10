import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Transcriber, Word } from '../ports.ts';
import { localContainer } from './container.ts';
import { ExecError, runProcess } from './exec.ts';

export type TranscribeErrorCode = 'tool-failed' | 'bad-output' | 'timeout' | 'unsupported-container';
export class TranscribeError extends Error {
  code: TranscribeErrorCode;
  constructor(code: TranscribeErrorCode, message: string) { super(message); this.name = 'TranscribeError'; this.code = code; }
}

/** Every `hyperframes` child gets these three switches (telemetry and the update check off). */
export const HYPERFRAMES_ENV = { HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' };

const TranscriptFile = z.array(z.object({ text: z.string(), start: z.number(), end: z.number() }));

export function whisperModel(language: string): 'small.en' | 'large-v3' {
  return /^en($|[-_])/i.test(language) ? 'small.en' : 'large-v3';
}

/** `bin` is the hyperframes executable. */
export function createTranscriber(bin: string, options: { timeoutMs?: number } = {}): Transcriber {
  return {
    async words(media, language) {
      let admitted = false;
      try { admitted = localContainer(media); } catch { /* missing or unreadable is refused before the CLI */ }
      if (!admitted) throw new TranscribeError('unsupported-container', 'media-container-refused');
      const dir = mkdtempSync(join(tmpdir(), 'viraleditor-transcribe-'));
      try {
        const args = ['transcribe', media, '-d', dir, '--engine', 'whisper', '--model', whisperModel(language), '--language', language, '--json'];
        let r;
        try {
          r = await runProcess(bin, args, { env: HYPERFRAMES_ENV, timeoutMs: options.timeoutMs ?? 30 * 60_000, killGroup: true });   // the recogniser is the CLI's child: a timeout ends it too
        } catch (e) {
          if (e instanceof ExecError) throw new TranscribeError(e.code === 'timeout' ? 'timeout' : 'tool-failed', e.message);
          throw e;
        }
        if (r.code !== 0) throw new TranscribeError('tool-failed', `hyperframes transcribe exited ${r.code}: ${(r.stderr || r.stdout).trim().slice(-500)}`);
        let parsed;
        try {
          parsed = TranscriptFile.parse(JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')));
        } catch (e) {
          throw new TranscribeError('bad-output', `transcript.json missing or malformed: ${(e as Error).message.slice(0, 300)}`);
        }
        return parsed.map((w): Word => ({ text: w.text, start: w.start, end: w.end }));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
