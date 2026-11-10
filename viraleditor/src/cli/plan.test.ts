// `plan`: what a job of a template would ask from the paid services. It counts; it sends nothing.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { paidFor } from '../template/estimate.ts';
import { beatsTemplate, speechTemplate } from '../template/fixture.ts';
import { Template } from '../template/schema.ts';
import { ask, fakeContext, fixture } from './testing.ts';

vi.setConfig({ testTimeout: 60_000 });
/** A JSON file in a temp dir. */
function written(value: unknown, name = 'template.json'): string {
  const file = join(mkdtempSync(join(tmpdir(), 've-cli-plan-')), name);
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
}

describe('plan', () => {
  it('counts what one variant of a beats template asks for, and lists the requests by kind', async () => {
    const file = written(beatsTemplate());
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['plan', file]);
    expect(ran.exit, JSON.stringify(ran.json.issues)).toBe(0);
    expect(Object.keys(ran.json)).toEqual(['ok', 'command', 'issues', 'warnings', 'result']);
    expect(ran.json.result).toMatchObject({ template: file, id: 't1', mode: 'beats', variants: 1, sent: 0 });
    expect(ran.json.result.paid).toEqual({ images: 1, clips: 1, clipSeconds: 4, music: 1, voice: 0 });     // a clip of 3 s is billed as 4
    expect(ran.json.result.requests).toEqual({
      image: [{ variant: 1, for: 's1' }], clip: [{ variant: 1, for: 's1', seconds: 4 }], music: [{ variant: 1, for: 'the video' }], voice: [],
    });
    expect(calls).toEqual([]);                                                                             // no tool, no network: it reads one file
  });

  it('multiplies by --variants, and its list adds up to what paidFor says', async () => {
    const template = speechTemplate();
    const ran = await ask(fakeContext().context, ['plan', written(template), '--variants', '3']);
    expect(ran.exit, JSON.stringify(ran.json.issues)).toBe(0);
    const paid = paidFor(Template.parse(template), 3);
    expect(ran.json.result.paid).toEqual(paid);
    const { image, clip, music, voice } = ran.json.result.requests;
    expect([image.length, clip.length, music.length, voice.length]).toEqual([paid.images, paid.clips, paid.music, paid.voice]);
    expect(clip.reduce((sum: number, request: { seconds: number }) => sum + request.seconds, 0)).toBe(paid.clipSeconds);
    expect(image.filter((request: { variant: number }) => request.variant === 3).map((request: { for: string }) => request.for)).toContain('presenter');
  });

  it('refuses a number of variants a job cannot have', async () => {
    const file = written(beatsTemplate());
    for (const variants of ['0', '4', 'two']) {
      const ran = await ask(fakeContext().context, ['plan', file, '--variants', variants]);
      expect(ran.exit, variants).toBe(2);
      expect(ran.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--variants' });
    }
  });

  it('names what is wrong with the file: missing, not JSON, not a template, an edit document', async () => {
    const { context } = fakeContext();
    const none = await ask(context, ['plan']);
    expect(none.exit).toBe(2);
    expect(none.json.issues[0].code).toBe('argument-missing');
    const missing = await ask(context, ['plan', join(tmpdir(), 'no-such-template.json')]);
    expect(missing.exit).toBe(1);
    expect(missing.json.issues[0].code).toBe('file-missing');
    const broken = await ask(context, ['plan', written('{ "id": ')]);
    expect(broken.exit).toBe(1);
    expect(broken.json.issues[0].code).toBe('json-invalid');

    const faulty = beatsTemplate() as Record<string, unknown>;
    delete faulty.mode;
    const wrong = await ask(context, ['plan', written(faulty)]);
    expect(wrong.exit).toBe(1);
    expect(wrong.json.issues.map((found: { code: string }) => found.code)).toContain('template-invalid');
    expect(wrong.json.issues.some((found: { path: string }) => found.path === 'mode')).toBe(true);
    for (const found of wrong.json.issues) expect(found.fix.length).toBeGreaterThan(10);

    const edit = await ask(context, ['plan', written(fixture('small'), 'edit.json')]);
    expect(edit.exit).toBe(1);
    expect(edit.json.issues[0].code).toBe('template-invalid');
    expect(edit.json.issues[0].fix).toContain('This is an edit document, not a template');
  });
});
