// The real aligner: Python, torchaudio, the wav2vec2 weights, the spike's three stand-in clips. Runs only with VE_ALIGN=1:
//   VE_ALIGN=1 timeout 900 pnpm vitest run src/adapters/aligner.real.test.ts
// The environment is built offline by tools/align/setup.sh; the clips by `node prep.mjs` in spike/viraleditor-speech.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AlignedWord } from '../ports.ts';
import { ALIGN_ENV, createAligner } from './aligner.ts';
import { runProcess } from './exec.ts';

const SPEECH = resolve(import.meta.dirname, '../../../spike/viraleditor-speech');
const TOOL = resolve(import.meta.dirname, '../../tools/align');
const clip = (id: string) => resolve(SPEECH, `assets/720/${id}.mp4`);
const SLOW = 300_000;          // the machine is shared: a limit against hanging, not an expectation

/** The words of each line of script.txt, its marks ([inset], [/card1] …) taken out. */
function scriptWords(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of readFileSync(resolve(SPEECH, 'script.txt'), 'utf8').split('\n')) {
    const head = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (head) out[head[1]] = [...head[2].matchAll(/\[\/?[a-z0-9-]+\]|[^\s[\]]+/g)].map((m) => m[0]).filter((t) => !t.startsWith('['));
  }
  return out;
}
const mean = (words: AlignedWord[]) => words.reduce((sum, w) => sum + w.score, 0) / words.length;

describe.skipIf(process.env.VE_ALIGN !== '1')('the real aligner (VE_ALIGN=1)', () => {
  const aligner = createAligner();
  const script = scriptWords();
  const right: Record<string, AlignedWord[]> = {};
  beforeAll(() => {
    for (const id of ['s1', 's2', 's3']) if (!existsSync(clip(id))) throw new Error(`${clip(id)} is missing: run "node prep.mjs" in spike/viraleditor-speech`);
  });

  it('the environment is there, asked offline', async () => {
    expect(await aligner.ready()).toEqual({ ready: true, note: null });
  }, SLOW);
  it('the pure rules of align.py hold (fold, spell, place)', async () => {
    const r = await runProcess(resolve(TOOL, '.venv/bin/python'), [resolve(TOOL, 'test_rules.py')], { cwd: TOOL, timeoutMs: SLOW });
    expect(r.stderr.trim().slice(-400)).toBe('');
    expect(r.code).toBe(0);
  }, SLOW);
  it.each([['s1', 38], ['s2', 22], ['s3', 28]] as const)('%s: each of the %i script words gets a time, in order', async (id, count) => {
    const given = script[id];
    expect(given).toHaveLength(count);
    const words = await aligner.align(clip(id), given, 'en');
    right[id] = words;
    expect(words.map((w) => w.text)).toEqual(given);
    for (const [i, w] of words.entries()) {
      expect(w.start).toBeLessThan(w.end);
      if (i > 0) expect(w.start).toBeGreaterThanOrEqual(words[i - 1].end);
      expect(w.score).toBeGreaterThan(0);                 // every word of this script can be spelled, so every one is placed by the model
    }
    expect(mean(words)).toBeGreaterThan(0.8);
  }, SLOW);
  it('a number written in digits lands where the spelled word lands', async () => {
    const digits = script.s1.map((w) => ({ four: '4', 'zero.': '0.', 'four.': '4.' })[w] ?? w);
    expect(digits.filter((w) => /\d/.test(w))).toHaveLength(3);
    const words = await aligner.align(clip('s1'), digits, 'en');
    expect(words.map((w) => w.text)).toEqual(digits);
    expect(words.map(({ start, end }) => ({ start, end }))).toEqual(right.s1.map(({ start, end }) => ({ start, end })));
  }, SLOW);
  it('words the model cannot spell share the gap between their neighbours; the other words do not move', async () => {
    const s2 = script.s2;
    const odd = ['→', ...s2.slice(0, 6), '✨', ...s2.slice(6, 9), '%', '2026', ...s2.slice(9), 'сыворотка', '🙂'];
    const words = await aligner.align(clip('s2'), odd, 'en');
    expect(words.map((w) => w.text)).toEqual(odd);
    expect(words.filter((w) => w.score > 0).map(({ text, start }) => ({ text, start }))).toEqual(right.s2.map(({ text, start }) => ({ text, start })));
    const at = (text: string) => words[odd.indexOf(text)];
    for (const text of ['→', '✨', '%', '2026', 'сыворотка', '🙂']) { expect(at(text).score).toBe(0); expect(at(text).start).toBeLessThan(at(text).end); }
    expect(at('✨').start).toBe(at('ACME.').end);
    expect(at('✨').end).toBe(at('Aloe,').start);
    expect(at('%').end).toBe(at('2026').start);          // two in one gap: back to back
    expect(at('2026').end).toBe(at('and').start);
  }, SLOW);
  it('a script that is not what the clip says gets its times anyway, with low scores', async () => {
    const words = await aligner.align(clip('s3'), script.s2, 'en');
    expect(words).toHaveLength(22);
    expect(mean(words)).toBeLessThan(0.5);
    expect(mean(right.s3)).toBeGreaterThan(0.8);
  }, SLOW);
  it('the tool itself refuses a URL before it starts ffmpeg (asked without the adapter)', async () => {
    const request = JSON.stringify({ media: 'http://127.0.0.1:9/x.mp4', words: ['a'], language: 'en' });
    const r = await runProcess(resolve(TOOL, '.venv/bin/python'), [resolve(TOOL, 'align.py')], { input: request, env: ALIGN_ENV, timeoutMs: SLOW });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ error: 'bad-media' });
  }, SLOW);
  it('a local playlist that points at a URL is not followed: ffmpeg may open local files only', async () => {
    const list = join(mkdtempSync(join(tmpdir(), 've-align-real-')), 'list.m3u8');
    writeFileSync(list, '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:9/seg.ts\n#EXT-X-ENDLIST\n');
    const e = await aligner.align(list, ['a'], 'en').catch((x) => x);
    expect(e).toMatchObject({ name: 'AlignError', code: 'tool-failed' });
    expect(e.message).toContain('not on whitelist');          // ffmpeg's own words for a protocol it was not allowed to open
  }, SLOW);
  it('another language is refused', async () => {
    await expect(aligner.align(clip('s1'), script.s1, 'tr')).rejects.toMatchObject({ name: 'AlignError', code: 'language-unsupported' });
  }, SLOW);
});
