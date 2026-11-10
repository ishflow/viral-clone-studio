// The guide (docs/guide/viraleditor.md) is the whole experience of an agent that uses the editor, so what it shows must
// be real: its excerpts are lines of the examples, its commands and flags exist, its issues are what `check` says.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { everyCode } from './commands/codes.ts';
import { COMMANDS } from './commands.ts';
import { EXAMPLE_NAMES, exampleFile, mediaNeeds, readExample } from './examples.ts';
import type { ExampleName } from './examples.ts';
import { reference } from './reference.ts';
import { STREAMS, ask, fakeContext } from './testing.ts';

vi.setConfig({ testTimeout: 60_000 });
const guide = readFileSync(fileURLToPath(new URL('../../../docs/guide/viraleditor.md', import.meta.url)), 'utf8');

describe('the guide', () => {
  it('fits one read', () => {
    expect(guide.split('\n').length).toBeLessThanOrEqual(290);
  });

  it('quotes the examples line for line', () => {
    const quotes = [...guide.matchAll(/<!-- from: ([a-z-]+)(, whole)? -->\n```json\n([\s\S]*?)\n```/g)];
    expect(quotes.map((quote) => quote[1])).toEqual(['product-beats', 'talking-captions', 'before-after']);
    for (const [, name, whole, block] of quotes) {
      const file = readFileSync(exampleFile(name as ExampleName), 'utf8');
      if (whole) expect(`${block}\n`, name).toBe(file);
      else for (const line of block!.split('\n').filter((written) => written.trim() !== '…')) expect(file.split('\n'), `${name}: ${line}`).toContain(line);
    }
    for (const name of EXAMPLE_NAMES) expect(guide.includes(`viraleditor/examples/${name}/edit.json`), `viraleditor/examples/${name}/edit.json`).toBe(true);
  });

  it('names only commands and flags that exist', () => {
    const written = [...guide.matchAll(/`viraleditor ([a-z][a-z-]*)([^`]*)`/g)];
    expect(written.length).toBeGreaterThan(20);
    for (const [all, name, rest] of written) {
      const command = COMMANDS.find((candidate) => candidate.name === name);
      expect(command, all).toBeDefined();
      for (const [, flag] of rest!.matchAll(/--([a-z-]+)/g)) expect([...command!.flags.map((known) => known.name), 'json', 'help'], all).toContain(flag);
    }
    for (const command of COMMANDS) expect(guide.includes(`\`viraleditor ${command.name}`), command.name).toBe(true);           // and every command has its line
    expect(guide).toContain('`viraleditor words');
  });

  it('names only codes the editor gives', () => {
    const codes = new Set(everyCode().map((row) => row.code));
    for (const code of ['text-too-long', 'outside-safe-area', 'black-frames', 'frozen-frames', 'wrong-footage', 'text-missing', 'silent', 'clipping', 'low-contrast',
      'dark-footage', 'still-footage', 'too-quiet', 'too-loud', 'media-fps', 'media-size', 'media-keyframes', 'media-colour', 'image-small', 'text-glyph',
      'output-mismatch', 'text-unverified', 'media-short', 'word-unplaced']) {
      expect(guide.includes(`\`${code}\``), code).toBe(true);
      expect(codes.has(code), code).toBe(true);
    }
  });

  it('shows the issues `check` really gives for the three faults it describes', async () => {
    const { edit } = readExample('product-beats');
    edit.texts![0]!.copy = 'The serum everyone keeps asking about, and why it sold out three times in one single month';
    edit.texts![1]!.box.right = 99;
    edit.cards![0]!.media = 'bottle';
    const dir = mkdtempSync(join(tmpdir(), 've-cli-guide-'));
    mkdirSync(join(dir, 'assets'));
    const needs = mediaNeeds(readExample('product-beats').edit);
    for (const need of needs) writeFileSync(join(dir, 'assets', need.file), '');
    writeFileSync(join(dir, 'faulty.json'), JSON.stringify(edit, null, 2));
    const streams = Object.fromEntries(needs.map((need) => [need.file, need.kind === 'image' ? STREAMS['still.png']! : need.kind === 'music' ? { ...STREAMS['tone.mp3']!, seconds: need.seconds }
      : { ...STREAMS['clip.mp4']!, frames: need.seconds * 30, seconds: need.seconds, keyframes: [0, 30, 60, 90] }]));
    const ran = await ask(fakeContext({ streams }).context, ['check', join(dir, 'faulty.json')]);
    expect(ran.exit).toBe(1);
    expect(ran.json.issues.map((found: { code: string }) => found.code)).toEqual(['outside-safe-area', 'media-unknown', 'text-too-long']);
    for (const found of ran.json.issues) {
      expect(guide.includes(`"path": ${JSON.stringify(found.path)}`), found.code).toBe(true);
      expect(guide.includes(`"message": ${JSON.stringify(found.message)}`), found.code).toBe(true);
      expect(guide.includes(`"fix": ${JSON.stringify(found.fix)}`), found.code).toBe(true);
    }
  });

  it('gives the presets and the safe area as the editor has them', () => {
    for (const style of reference().styles) expect(guide.includes(`| \`${style.name}\` | ${style.font} ${style.weight}, ${style.size1080} px`), style.name).toBe(true);
    const both = reference().safeAreas.find((row) => row.safe === 'both')!;
    expect(both).toEqual({ safe: 'both', area: 'left 6, top 14, right 94, bottom 65', buttons: 'left 86, top 45, right 100, bottom 65' });
    expect(guide.includes('inside the rectangle from 6 to 94 across and from 14 to 65 down'), 'inside the rectangle from 6 to 94 across and from 14 to 65 down').toBe(true);
    expect(guide.includes('from 86 across to the edge, from 45 down'), 'from 86 across to the edge, from 45 down').toBe(true);
    expect(reference().safeAreas.find((row) => row.safe === 'tiktok')!.area).toBe('left 6, top 8, right 94, bottom 78');
    expect(guide.includes('(8 to 78 down)'), '(8 to 78 down)').toBe(true);
  });
});
