import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { framesOf } from './commands/words.ts';
import { ask, fakeContext } from './testing.ts';
import type { Fakes } from './testing.ts';

const dir = mkdtempSync(join(tmpdir(), 've-words-'));
const media = (name = 'tone.mp3') => { writeFileSync(join(dir, name), ''); return join(dir, name); };
const script = (text: string) => { const file = join(dir, `script-${Math.random().toString(36).slice(2)}.txt`); writeFileSync(file, text); return file; };
const aligner = (over: Partial<Fakes['aligner']>): Partial<Fakes> => ({ aligner: { ready: true, note: null, fails: null, unplaced: [], ...over } });

describe('words', () => {
  it('turns seconds into the frame a word starts on and its length, at least one frame', () => {
    expect(framesOf({ text: 'a', start: 0.5, end: 0.51 })).toEqual({ frame: 15, frames: 1 });
    expect(framesOf({ text: 'a', start: 0.2, end: 0.2 })).toEqual({ frame: 6, frames: 1 });
    expect(framesOf({ text: 'a', start: 1, end: 1.5 })).toEqual({ frame: 30, frames: 15 });
  });

  it('answers with the transcriber\'s words, their frames and the source', async () => {
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['words', media(), '--language', 'ru']);
    expect(ran.exit).toBe(0);
    expect(Object.keys(ran.json.result)).toEqual(['words', 'source', 'seconds', 'next']);
    expect(ran.json.result.source).toBe('transcriber');
    expect(ran.json.result.words).toEqual([{ text: 'Hello', start: 0.1, end: 0.5, frame: 3, frames: 12 }, { text: 'there.', start: 0.6, end: 1.2, frame: 18, frames: 18 }]);
    expect(calls.map((c) => c.tool)).toEqual(['measure.streams', 'transcriber.words']);
    expect(calls[1]!.args[1]).toBe('ru');
  });

  it('places exactly the words of a script, marks and line breaks are not words', async () => {
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['words', media(), '--script', script('It is [name]the new\nserum.[/name]\n\n Try it.\n')]);
    expect(ran.exit).toBe(0);
    expect(ran.json.result.source).toBe('aligner');
    expect(ran.json.result.words.map((w: { text: string }) => w.text)).toEqual(['It', 'is', 'the', 'new', 'serum.', 'Try', 'it.']);
    expect(ran.json.result.words[1]).toEqual({ text: 'is', start: 0.5, end: 0.9, frame: 15, frames: 12, score: 0.9 });
    expect(calls.find((c) => c.tool === 'aligner.align')!.args).toEqual([expect.stringContaining('tone.mp3'), ['It', 'is', 'the', 'new', 'serum.', 'Try', 'it.'], 'en']);
    expect(ran.json.warnings).toEqual([]);
  });

  it('names a word the aligner did not place in a warning, and still answers with exit 0', async () => {
    const ran = await ask(fakeContext(aligner({ unplaced: [1] })).context, ['words', media(), '--script', script('one two three')]);
    expect(ran.exit).toBe(0);
    expect(ran.json.warnings).toHaveLength(1);
    expect(ran.json.warnings[0]).toMatchObject({ code: 'word-unplaced', target: 'words[1]' });
    expect(ran.json.warnings[0].message).toContain('"two"');
    expect(ran.json.result.words[1].score).toBe(0);
  });

  it('stops with a code and a fix: no sound, an empty or faulty script, a script that is not there', async () => {
    const { context } = fakeContext();
    const silent = await ask(context, ['words', media('clip.mp4')]);
    expect([silent.exit, silent.json.issues[0].code]).toEqual([1, 'media-silent']);
    const empty = await ask(context, ['words', media(), '--script', script('  [a][/a]\n')]);
    expect([empty.exit, empty.json.issues[0].code]).toEqual([1, 'script-invalid']);       // a mark around nothing
    const none = await ask(context, ['words', media(), '--script', script(' \n\t')]);
    expect([none.exit, none.json.issues[0].code]).toEqual([1, 'script-empty']);
    const broken = await ask(context, ['words', media(), '--script', script('Hello [oops there')]);
    expect([broken.exit, broken.json.issues[0].code]).toEqual([1, 'script-invalid']);
    const gone = await ask(context, ['words', media(), '--script', join(dir, 'nothing.txt')]);
    expect([gone.exit, gone.json.issues[0].code]).toEqual([1, 'file-missing']);
    const missing = await ask(context, ['words', join(dir, 'nothing.mp3')]);
    expect([missing.exit, missing.json.issues[0].code]).toEqual([1, 'file-missing']);
    for (const ran of [silent, empty, none, broken, gone]) expect(ran.json.issues[0].fix.length).toBeGreaterThan(10);
  });

  it('stops when the aligner is not set up, has no model for the language, or fails; the transcriber failing is a tool failure', async () => {
    const file = script('one two');
    const absent = await ask(fakeContext(aligner({ ready: false, note: 'no Python environment' })).context, ['words', media(), '--script', file]);
    expect([absent.exit, absent.json.issues[0].code]).toEqual([3, 'aligner-missing']);
    expect(absent.json.issues[0].fix).toContain('tools/align/setup.sh');
    const language = await ask(fakeContext(aligner({ fails: 'language-unsupported' })).context, ['words', media(), '--script', file, '--language', 'ru']);
    expect([language.exit, language.json.issues[0].code]).toEqual([2, 'language-unsupported']);
    const failed = await ask(fakeContext(aligner({ fails: 'tool-failed' })).context, ['words', media(), '--script', file]);
    expect([failed.exit, failed.json.issues[0].code]).toEqual([3, 'tool-failed']);
    const { context } = fakeContext();
    context.tools.transcriber = { words: async () => { const { TranscribeError } = await import('../adapters/transcriber.ts'); throw new TranscribeError('tool-failed', 'whisper exited 1'); } };
    const heard = await ask(context, ['words', media()]);
    expect([heard.exit, heard.json.issues[0].code]).toEqual([3, 'tool-failed']);
  });
});
