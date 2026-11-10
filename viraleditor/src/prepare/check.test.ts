import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeRenderer } from '../adapters/fakes.ts';
import { RenderError } from '../ports.ts';
import type { Generator } from '../ports.ts';
import { checkTemplate, writeVerdict } from './check.ts';
import type { TemplateCheck } from './check.ts';
import type { Placeholders } from './placeholders.ts';
import { FakePlaceholders, golden, tempDir } from './testing.ts';

const PASS = { ok: true, issues: [] };
function setup(verdict: { ok: boolean; issues: { code: string; message: string; target: string | null; second: number | null }[] } | Error = PASS) {
  const dir = join(tempDir(), 'check');
  const renderer = new FakeRenderer({ checks: [verdict] });
  const placeholders = new FakePlaceholders();
  return { dir, renderer, placeholders, deps: { renderer, placeholders } };
}
const issuesOf = (check: TemplateCheck) => (check.ok ? [] : check.issues);

describe('checkTemplate', () => {
  it('a golden beats template passes: it is composed with a sample fill, written with stand-in media and handed to the renderer', async () => {
    const { dir, deps, renderer, placeholders } = setup();
    const result = await checkTemplate(deps, golden('layering-01'), dir);
    expect(result).toMatchObject({ ok: true, notes: [] });
    expect(result.ok && result.template.id).toBe('layering-01');
    expect(renderer.calls).toEqual([{ kind: 'check', dir }]);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('the best quality');
    expect(existsSync(join(dir, 'timeline.json'))).toBe(true);
    const [made] = placeholders.calls;
    expect(made!.canvas).toEqual({ width: 720, height: 1280, fps: 30 });
    expect(made!.needs.filter((need) => need.kind === 'clip')).toEqual(
      ['s1', 's2', 's3', 's4', 's5'].map((id) => ({ kind: 'clip', file: `clip-${id}.mp4`, seconds: 4, sound: false })),
    );
    expect(made!.needs.filter((need) => need.kind === 'music')).toEqual([{ kind: 'music', file: 'music.mp3', seconds: 8 }]);
    for (const need of made!.needs) expect(existsSync(join(dir, 'assets', need.file))).toBe(true);
  });

  it('a golden speech template passes: its clips carry sound, and every still and photograph has a stand-in', async () => {
    const { dir, deps, placeholders } = setup();
    const result = await checkTemplate(deps, golden('lashly-01'), dir);
    expect(result).toMatchObject({ ok: true, notes: [] });
    const needs = placeholders.calls[0]!.needs;
    expect(needs.filter((need) => need.kind === 'clip').every((need) => need.kind === 'clip' && need.sound && Number.isInteger(need.seconds) && need.seconds >= 4)).toBe(true);
    expect(needs.filter((need) => need.kind === 'image').map((need) => need.file).sort()).toEqual(
      ['product-1-1.png', 'product-1-2.png', 'product-1-3.png', 'still-proof-after.png', 'still-proof-before.png'],
    );
  });

  it('schema: an unknown key stops the chain before anything is written', async () => {
    const { dir, deps, renderer, placeholders } = setup();
    const result = await checkTemplate(deps, { ...golden('layering-01'), extra: 1 }, dir);
    expect(result).toMatchObject({ ok: false, step: 'schema', issues: [{ code: 'schema', path: '' }] });
    expect(issuesOf(result)[0]!.message).toContain('extra');
    expect([renderer.calls, placeholders.calls, existsSync(dir)]).toEqual([[], [], false]);
  });

  it('schema: every broken rule is an issue with its path (a shot that leaves a gap, a text that ends after the video)', async () => {
    const template = golden('layering-01');
    template.shots[1]!.at = 45;
    template.texts[4]!.for = 900;
    const result = await checkTemplate(setup().deps, template, join(tempDir(), 'check'));
    expect(result).toMatchObject({ ok: false, step: 'schema' });
    expect(issuesOf(result).map((issue) => [issue.code, issue.path])).toEqual([['schema', 'shots.1.at'], ['schema', 'shots.2.at'], ['schema', 'texts.4.for']]);
    for (const issue of issuesOf(result)) expect(Object.keys(issue)).toEqual(['code', 'path', 'message', 'fix']);
  });

  it('placeholders: a {placeholder} in a field that is shown or sent as it is (title, tags, action, sample_text) is refused', async () => {
    const beats = golden('layering-01');
    beats.title = '{brand} line-up';
    beats.tags[0] = '{category}';
    beats.shots[0]!.action = 'A hand holds {product_1}';
    const { dir, deps, renderer } = setup();
    const result = await checkTemplate(deps, beats, dir);
    expect(result).toMatchObject({ ok: false, step: 'placeholders' });
    expect(issuesOf(result).map((issue) => [issue.code, issue.path])).toEqual([['placeholder', 'title'], ['placeholder', 'tags.0'], ['placeholder', 'shots.0.action']]);
    expect(renderer.calls).toEqual([]);
    const speech = golden('lashly-01');
    speech.presenter!.voice.sample_text = 'Let me tell you about {product}.';
    expect(issuesOf(await checkTemplate(setup().deps, speech, join(tempDir(), 'check'))).map((issue) => issue.path)).toEqual(['presenter.voice.sample_text']);
  });

  it('fill: a copy that is the text of the reference is refused', async () => {
    const template = golden('layering-01');
    template.texts[0]!.copy = template.texts[0]!.source_copy;
    const { dir, deps, renderer } = setup();
    expect(await checkTemplate(deps, template, dir)).toMatchObject({ ok: false, step: 'fill', issues: [{ code: 'copy-is-source' }] });
    expect(renderer.calls).toEqual([]);
  });

  it('compose: a text outside the safe area is refused by the editor, with its place and what to change', async () => {
    const template = golden('layering-01');
    template.texts[0]!.box = { left: 14, top: 1, right: 86, bottom: 9 };
    const { dir, deps, renderer } = setup();
    const result = await checkTemplate(deps, template, dir);
    expect(result).toMatchObject({ ok: false, step: 'compose' });
    const [first] = issuesOf(result);
    expect(first!.code).toMatch(/^[a-z][a-z-]+$/);
    expect(first!.path).toContain('texts[0]');
    expect(first!.fix.length).toBeGreaterThan(10);
    expect(renderer.calls).toEqual([]);
  });

  it('renderer: every issue is kept with its code, its target and its second', async () => {
    const issues = [
      { code: 'layout_overflow', message: 'the text leaves its box', target: '#hook', second: 0.5 },
      { code: 'another', message: 'second', target: null, second: null },
    ];
    const { dir, deps } = setup({ ok: false, issues });
    expect(await checkTemplate(deps, golden('layering-01'), dir)).toEqual({ ok: false, step: 'renderer', issues: [
      { code: 'layout_overflow', path: '#hook', message: 'the text leaves its box (at 0.5 s)', fix: '' },
      { code: 'another', path: '', message: 'second', fix: '' },
    ] });
  });

  it('renderer: a text hidden beneath another element names what the template can change (the finding has no fix of its own)', async () => {
    const hidden = { code: 'text_occluded', message: 'Text is hidden beneath an opaque element.', target: 'index.html', second: 5.5 };
    const { dir, deps } = setup({ ok: false, issues: [hidden] });
    const result = await checkTemplate(deps, golden('layering-01'), dir);
    const [issue] = issuesOf(result);
    expect(issue).toMatchObject({ code: 'text_occluded', path: 'index.html', message: 'Text is hidden beneath an opaque element. (at 5.5 s)' });
    expect(issue!.fix).toContain('move its box');
    expect(issue!.fix).not.toContain('padY');
  });

  it('renderer: a check that cannot run is a failure of the chain, not a crash', async () => {
    const { dir, deps } = setup(new RenderError('hyperframes check exited 1'));
    expect(await checkTemplate(deps, golden('layering-01'), dir)).toEqual({ ok: false, step: 'renderer', issues: [{ code: 'check-not-run', path: '', message: 'hyperframes check exited 1', fix: '' }] });
  });

  it('writeVerdict: check.json is { at, issues }; a check that passed leaves no issue of an older one', () => {
    const dir = tempDir();
    const at = new Date('2026-10-04T10:00:00.000Z');
    const issue = { code: 'layout_overflow', path: '#hook', message: 'the text leaves its box', fix: '' };
    writeVerdict(dir, { ok: false, step: 'renderer', issues: [issue] }, at);
    expect(JSON.parse(readFileSync(join(dir, 'check.json'), 'utf8'))).toEqual({ at: '2026-10-04T10:00:00.000Z', issues: [issue] });
    writeVerdict(dir, { ok: true, template: golden('layering-01'), notes: [] }, at);
    expect(JSON.parse(readFileSync(join(dir, 'check.json'), 'utf8'))).toEqual({ at: '2026-10-04T10:00:00.000Z', issues: [] });
  });

  it('a generator cannot be handed in as the maker of the stand-in media', () => {
    const generator = {} as Generator;
    // @ts-expect-error a Generator sends paid requests: it is not a Placeholders
    const wrong: Placeholders = generator;
    expect(wrong).toBe(generator);
  });
});
