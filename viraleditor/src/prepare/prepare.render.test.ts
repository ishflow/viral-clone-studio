// The real pieces (`pnpm test:render`): a golden template, answered by the fake model, goes through the real compose, is written
// with stand-in media made by ffmpeg on this machine, and is checked by the real HyperFrames. Nothing is requested from anyone.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMeasure } from '../adapters/measure.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { getRun } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { Template } from '../template/schema.ts';
import { checkTemplate } from './check.ts';
import { prepareHandler } from './index.ts';
import { localPlaceholders } from './placeholders.ts';
import { EXAMPLES } from './prompts.ts';
import { golden, tempDir, world } from './testing.ts';

const BIN = resolve(import.meta.dirname, '../../node_modules/.bin/hyperframes');
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const CHROME = join(homedir(), '.cache', 'hyperframes', 'chrome');
const available = existsSync(BIN) && existsSync(FFMPEG) && existsSync(FFPROBE) && existsSync(CHROME) && readdirSync(CHROME).length > 0;
const SLOW = 600_000;                                        // the machine is shared

describe.skipIf(!available)('prepare with the real compose and the real check', () => {
  const renderer = createRenderer({ bin: BIN, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure: createMeasure(FFMPEG, FFPROBE) });

  it.each([['layering-01', 'beats'], ['lashly-01', 'speech']] as const)('%s (%s) ends ready', async (id, mode) => {
    const w = world({ llm: [{ score: 88, notes: ['Clear products.'], unsupported: null, mode, brands: [] }, golden(id)] });
    const candidate = w.candidate();
    const run = w.run({ kind: 'prepare', templateId: `real-${id}`, ownerId: null, from: { kind: 'candidate', candidateId: candidate.id, force: false } });
    await prepareHandler({ ...w, renderer, placeholders: localPlaceholders({ ffmpeg: FFMPEG }) })(run);

    const dir = join(w.dataDir, 'templates', `real-${id}`);
    const verdict = existsSync(join(dir, 'check.json')) ? readFileSync(join(dir, 'check.json'), 'utf8') : 'no check.json';
    expect(getRun(w.db, run.id)!.result, verdict).toEqual({ kind: 'prepare', state: 'ready', note: null });
    expect(templates.get(w.db, `real-${id}`)).toMatchObject({ state: 'ready', note: null });
    expect(Template.parse(JSON.parse(readFileSync(join(dir, 'template.json'), 'utf8'))).mode).toBe(mode);
    expect(existsSync(join(dir, 'check', 'index.html'))).toBe(true);
    expect(readdirSync(join(dir, 'check', 'media')).filter((name) => name.endsWith('.mp4')).length).toBe(golden(id).shots.length);
  }, SLOW);

  it.each(['beats', 'speech'] as const)('the worked example of the %s prompt passes the real check: what the model is shown is a template that composes', async (mode) => {
    const check = await checkTemplate({ renderer, placeholders: localPlaceholders({ ffmpeg: FFMPEG }) }, EXAMPLES[mode], tempDir('ve-prepare-example-'));
    expect(check.ok ? [] : check.issues).toEqual([]);
  }, SLOW);
});
