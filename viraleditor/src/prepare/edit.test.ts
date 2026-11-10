import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card, RunInput } from '../contracts.ts';
import { getRun } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { cardOf } from '../template/card.ts';
import { paidFor } from '../template/estimate.ts';
import { Template } from '../template/schema.ts';
import type { TemplateJson } from '../template/schema.ts';
import { applyCard, editHandler, EditRefused } from './edit.ts';
import { golden, world } from './testing.ts';
import type { GoldenId, World, WorldOptions } from './testing.ts';

type EditCard = Extract<RunInput, { kind: 'edit' }>['card'];
const parsed = (id: GoldenId): TemplateJson => Template.parse(golden(id));
const cardFor = (template: TemplateJson): EditCard => {
  const { title, category, products, shots, description, tags } = cardOf(template, { image: null, video: null });
  return structuredClone({ title, category, products, shots, description, tags });
};
const refusal = (run: () => unknown): string => { try { run(); } catch (error) { if (error instanceof EditRefused) return error.code; throw error; } return 'not refused'; };

describe('applyCard', () => {
  it('a card that changes nothing gives the same template', () => {
    for (const id of ['layering-01', 'lashly-01'] as const) expect(applyCard(parsed(id), cardFor(parsed(id)))).toEqual(parsed(id));
  });

  it('the title, the category, the description, the tags and the products go into the template', () => {
    const template = parsed('layering-01');
    const edited = applyCard(template, { ...cardFor(template), title: 'Four in a row', category: 'body care', description: 'Four bottles.', tags: ['hands'], products: 5 });
    expect(edited).toMatchObject({ title: 'Four in a row', category: 'body care', description: 'Four bottles.', tags: ['hands'], products: { min: 5, max: 5 } });
    expect(applyCard(template, { ...cardFor(template), products: 3 }).products).toEqual({ min: 3, max: 4 });
    expect(template.title).toBe('Scent layering line-up');                                    // the template handed in is not changed
  });

  it("a shot's action and its text go into the shot and into the text that is on screen with it", () => {
    const template = parsed('layering-01');
    const card = cardFor(template);
    card.shots[1] = { ...card.shots[1]!, action: 'A hand lifts the first product', text: '{brand}: {product_1}' };
    const edited = applyCard(template, card);
    expect(edited.shots[1]!.action).toBe('A hand lifts the first product');
    expect(edited.texts[1]).toMatchObject({ id: 'name-1', copy: '{brand}: {product_1}', source_copy: 'deo vanilla cashmere lotion' });
    expect({ ...edited, shots: template.shots, texts: template.texts }).toEqual(template);
  });

  it('new times of a beats shot become its frames, and the texts and the punch-in of the shot move with it', () => {
    const template = parsed('layering-01');
    template.shots[3]!.motion = { kind: 'punch-in', at: 130 };                               // shot 4 owns the frames 125 … 169
    const card = cardFor(template);
    card.shots[2] = { ...card.shots[2]!, to: 4.5 };                                           // shot 3: 87 … 125 becomes 87 … 135
    card.shots[3] = { ...card.shots[3]!, from: 4.5, to: 6 };                                  // shot 4: 135 … 180
    card.shots[4] = { ...card.shots[4]!, from: 6, to: 8 };                                    // shot 5: 180 … 240
    const edited = applyCard(template, card);
    expect(edited.shots.map((shot) => [shot.at, shot.for])).toEqual([[0, 39], [39, 48], [87, 48], [135, 45], [180, 60]]);
    expect(edited.shots[3]!.motion).toEqual({ kind: 'punch-in', at: 140 });
    expect(edited.texts.map((text) => [text.id, text.at, text.for])).toEqual([['hook', 0, 39], ['name-1', 39, 48], ['name-2', 87, 48], ['name-3', 135, 45], ['name-4', 180, 60]]);
    expect(Template.safeParse(edited).error?.issues ?? []).toEqual([]);
  });

  it('a new length of a talking shot becomes the seconds of its segment and of its clip', () => {
    const template = parsed('lashly-01');
    const card = cardFor(template);
    const before = card.shots[1]!;
    card.shots[1] = { ...before, to: before.to + 1.5 };
    const edited = applyCard(template, card);
    expect(edited.script!.segments[1]!.seconds).toBeCloseTo(template.script!.segments[1]!.seconds + 1.5, 9);
    expect(edited.shots[1]!.clip_seconds).toBe(edited.script!.segments[1]!.seconds);
    expect([edited.script!.segments[0], edited.shots[0], edited.shots[2]]).toEqual([template.script!.segments[0], template.shots[0], template.shots[2]]);
  });

  it('refuses a card that does not name every shot once, and a text for a shot that shows none', () => {
    const template = parsed('layering-01');
    const fewer = cardFor(template); fewer.shots.pop();
    const twice = cardFor(template); twice.shots[1] = { ...twice.shots[1]!, n: 1 };
    expect([refusal(() => applyCard(template, fewer)), refusal(() => applyCard(template, twice))]).toEqual(['edit-shots', 'edit-shots']);
    const speech = parsed('lashly-01');
    const texted = cardFor(speech); texted.shots[0] = { ...texted.shots[0]!, text: 'new words' };
    expect(refusal(() => applyCard(speech, texted))).toBe('edit-text');
  });
});

describe('editHandler', () => {
  /** A published template on disk with its row, and the card the site has already written for the edit. */
  function setup(change: (card: EditCard) => void, options: WorldOptions = {}) {
    const w = world(options);
    const template = parsed('layering-01');
    const dir = join(w.dataDir, 'templates', template.id);
    mkdirSync(dir, { recursive: true });
    const text = `${JSON.stringify(template, null, 2)}\n`;
    writeFileSync(join(dir, 'template.json'), text);
    const media = { image: 'templates/layering-01/poster.jpg', video: 'templates/layering-01/sample.mp4' };
    const card = cardFor(template);
    change(card);
    const siteCard: Card = { ...cardOf(template, media), ...card };
    templates.upsert(w.db, { id: template.id, state: 'published', owner: null, sourceKind: 'seed', sourceUrl: null, note: null, card: siteCard, estimate: paidFor(template, 1), minutes: 8, timesGenerated: 3 }, w.clock.now());
    return { w, template, dir, text, media, card };
  }
  const verdict = (dir: string) => JSON.parse(readFileSync(join(dir, 'check.json'), 'utf8')) as { at: string; issues: { code: string; path: string; message: string; fix: string }[] };
  async function edit(w: World, card: EditCard) {
    const run = w.run({ kind: 'edit', templateId: 'layering-01', card });
    await editHandler(w)(run);
    return getRun(w.db, run.id)!;
  }

  it('applies the card to template.json, checks it and writes the card of the new template', async () => {
    const { w, dir, media, card } = setup((c) => { c.title = 'Four in a row'; c.shots[0] = { ...c.shots[0]!, text: 'my {quality}\n{category} four' }; });
    const run = await edit(w, card);
    expect([run.state, run.result]).toEqual(['done', { kind: 'edit', ok: true, note: null }]);
    const written = Template.parse(JSON.parse(readFileSync(join(dir, 'template.json'), 'utf8')));
    expect([written.title, written.texts[0]!.copy]).toEqual(['Four in a row', 'my {quality}\n{category} four']);
    const row = templates.get(w.db, 'layering-01')!;
    expect(row).toMatchObject({ state: 'published', note: null, timesGenerated: 3, estimate: paidFor(written, 1) });
    expect(row.card).toEqual(cardOf(written, media));
    expect(existsSync(join(dir, 'edit.json'))).toBe(false);
    expect(verdict(dir)).toEqual({ at: w.clock.now().toISOString(), issues: [] });
    expect(w.renderer.calls).toEqual([{ kind: 'check', dir: join(dir, 'check') }]);
  });

  it('the frames of the shots stay in the card after an edit', async () => {
    const { w, card } = setup((c) => { c.title = 'Four in a row'; c.shots[2] = { ...c.shots[2]!, to: 4.5 }; c.shots[3] = { ...c.shots[3]!, from: 4.5 }; });
    const row = templates.get(w.db, 'layering-01')!;
    templates.setCard(w.db, row.id, { ...row, card: { ...row.card, shots: row.card.shots.map((shot) => ({ ...shot, image: `templates/layering-01/shots/${shot.n}.jpg` })) } }, w.clock.now());
    expect((await edit(w, card)).result).toEqual({ kind: 'edit', ok: true, note: null });
    const after = templates.get(w.db, 'layering-01')!.card.shots;
    expect(after.map((shot) => shot.image)).toEqual(after.map((shot) => `templates/layering-01/shots/${shot.n}.jpg`));
  });

  it('an edit that moves a shot outside the video: ok false, and the old template and the old card stay', async () => {
    const { w, template, dir, text, media, card } = setup((c) => { c.shots[4] = { ...c.shots[4]!, from: 100, to: 102 }; });
    const run = await edit(w, card);
    expect(run.state).toBe('done');
    expect(run.result).toEqual({ kind: 'edit', ok: false, note: 'check-failed' });
    expect(verdict(dir).issues[0]).toMatchObject({ code: 'schema', path: 'shots.4.at' });
    expect(readFileSync(join(dir, 'template.json'), 'utf8')).toBe(text);
    const row = templates.get(w.db, 'layering-01')!;
    expect(row).toMatchObject({ state: 'published', note: 'check-failed', timesGenerated: 3 });
    expect(row.card).toEqual(cardOf(template, media));
    expect(JSON.parse(readFileSync(join(dir, 'edit.json'), 'utf8')).shots[4].at).toBe(3000);
    expect(w.renderer.calls).toEqual([]);
  });

  it('a refused shot edit restores persisted sample freshness and never clears a later edit', async () => {
    for (const later of [false, true]) {
      const { w, card } = setup(c => { c.shots.pop(); });
      const run = w.run({ kind: 'edit', templateId: 'layering-01', card, shotsChanged: true, sampleChangedBefore: null });
      const mark = later ? '2099-01-01T00:00:00.000Z' : run.createdAt;
      w.db.prepare('UPDATE templates SET sample_changed_at = ? WHERE id = ?').run(mark, 'layering-01');
      await editHandler(w)(run);
      expect((w.db.prepare('SELECT sample_changed_at FROM templates WHERE id = ?').get('layering-01') as { sample_changed_at: string | null }).sample_changed_at).toBe(later ? mark : null);
    }
  });

  it('an edit the renderer refuses leaves nothing half-made either', async () => {
    const issue = { code: 'layout_overflow', message: 'the text leaves its box', target: '#hook', second: 0.5 };
    const { w, template, dir, text, media, card } = setup((c) => { c.title = 'Four in a row'; }, { checks: [{ ok: false, issues: [issue] }] });
    const run = await edit(w, card);
    expect(run.result).toEqual({ kind: 'edit', ok: false, note: 'check-failed' });
    expect(readFileSync(join(dir, 'template.json'), 'utf8')).toBe(text);
    expect(templates.get(w.db, 'layering-01')!.card).toEqual(cardOf(template, media));
    expect(verdict(dir)).toEqual({ at: w.clock.now().toISOString(), issues: [{ code: 'layout_overflow', path: '#hook', message: 'the text leaves its box (at 0.5 s)', fix: '' }] });
  });

  it('a card the template cannot take is refused before any check', async () => {
    const { w, template, dir, text, media, card } = setup((c) => { c.shots.pop(); });
    const run = await edit(w, card);
    expect(run.result).toEqual({ kind: 'edit', ok: false, note: 'check-failed' });
    expect(verdict(dir).issues).toMatchObject([{ code: 'edit-shots', path: 'shots' }]);
    expect(readFileSync(join(dir, 'template.json'), 'utf8')).toBe(text);
    expect(templates.get(w.db, 'layering-01')).toMatchObject({ note: 'check-failed', card: cardOf(template, media) });
  });

  it('a card that is not a card (the site sent no tags, a shot without its times) ends as ok false, never as a throw', async () => {
    const { w, template, dir, text, media, card } = setup(() => {});
    const broken = { ...card, tags: undefined, shots: card.shots.map(({ from: _from, ...shot }) => shot) } as unknown as EditCard;
    const run = await edit(w, broken);
    expect([run.state, run.result]).toEqual(['done', { kind: 'edit', ok: false, note: 'check-failed' }]);
    expect(verdict(dir).issues[0]).toMatchObject({ code: 'edit-card' });
    expect(readFileSync(join(dir, 'template.json'), 'utf8')).toBe(text);
    expect(templates.get(w.db, 'layering-01')).toMatchObject({ state: 'published', note: 'check-failed', card: cardOf(template, media) });
    expect(w.renderer.calls).toEqual([]);
  });

  it('a placeholder in the title is refused: the site shows a title as it is', async () => {
    const { w, dir, text, card } = setup((c) => { c.title = '{brand} line-up'; });
    expect((await edit(w, card)).result).toEqual({ kind: 'edit', ok: false, note: 'check-failed' });
    expect(verdict(dir).issues).toMatchObject([{ code: 'placeholder', path: 'title' }]);
    expect(readFileSync(join(dir, 'template.json'), 'utf8')).toBe(text);
  });

  it('what the site did to the row during the check is kept: a hidden template stays hidden, a deleted one is not brought back', async () => {
    const hiding = setup((c) => { c.title = 'Four in a row'; });
    const during = (w: World, act: () => void) => ({ ...w, renderer: { ...w.renderer, check: async () => { act(); return { ok: true, issues: [] }; } } as unknown as World['renderer'] });
    const hidden = hiding.w.run({ kind: 'edit', templateId: 'layering-01', card: hiding.card });
    await editHandler(during(hiding.w, () => templates.setState(hiding.w.db, 'layering-01', 'hidden', null, hiding.w.clock.now())))(hidden);
    expect(getRun(hiding.w.db, hidden.id)!.result).toEqual({ kind: 'edit', ok: true, note: null });
    expect(templates.get(hiding.w.db, 'layering-01')).toMatchObject({ state: 'hidden', owner: null, timesGenerated: 3, card: { title: 'Four in a row' } });

    const deleting = setup((c) => { c.title = 'Four in a row'; });
    const deleted = deleting.w.run({ kind: 'edit', templateId: 'layering-01', card: deleting.card });
    await editHandler(during(deleting.w, () => { deleting.w.db.prepare('DELETE FROM templates WHERE id = ?').run('layering-01'); }))(deleted);
    expect(getRun(deleting.w.db, deleted.id)!.result).toEqual({ kind: 'edit', ok: false, note: 'template-missing' });
    expect(templates.list(deleting.w.db)).toEqual([]);
    expect(readFileSync(join(deleting.dir, 'template.json'), 'utf8')).toBe(deleting.text);
  });

  it('a template that is not there: ok false + template-missing', async () => {
    const w = world();
    const run = w.run({ kind: 'edit', templateId: 'gone', card: cardFor(parsed('layering-01')) });
    await editHandler(w)(run);
    expect(getRun(w.db, run.id)!.result).toEqual({ kind: 'edit', ok: false, note: 'template-missing' });
  });
});
