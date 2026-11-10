import { describe, expect, it } from 'vitest';
import { beatsFill, beatsTemplate, continuingFill, continuingTemplate, speechFill, speechTemplate } from '../template/fixture.ts';
import { Fill, Template } from '../template/schema.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { checkFill } from './fill.ts';

type Json = Record<string, any>;
const check = (template: unknown, fill: unknown) => checkFill(template as TemplateJson, fill as FillJson);
/** The codes of what is wrong with a fill, in order; empty: nothing. */
const speech = (change: (f: Json, t: Json) => void = () => {}): string[] => { const f: Json = speechFill(), t: Json = speechTemplate(); change(f, t); return check(t, f).errors.map((error) => error.code); };
const beats = (change: (f: Json, t: Json) => void = () => {}): string[] => { const f: Json = beatsFill(), t: Json = beatsTemplate(); change(f, t); return check(t, f).errors.map((error) => error.code); };
const notes = (change: (f: Json, t: Json) => void) => { const f: Json = speechFill(), t: Json = speechTemplate(); change(f, t); return check(t, f); };
/** The beats fixtures with one generated still that the shot's first frame is made from. */
const lead = (f: Json, t: Json) => { t.stills = [{ id: 'lead', prompt: 'a woman', references: [] }]; t.shots[0].stills = ['lead']; f.stills = { lead: { prompt: 'a woman in a grey coat' } }; };

describe('checkFill', () => {
  it('finds nothing wrong with the fills that belong to the fixtures, and has nothing to note', () => {
    expect(check(Template.parse(beatsTemplate()), Fill.parse(beatsFill()))).toEqual({ errors: [], notes: [] });
    expect(check(Template.parse(speechTemplate()), Fill.parse(speechFill()))).toEqual({ errors: [], notes: [] });
    const f: Json = beatsFill(), t: Json = beatsTemplate();
    lead(f, t);
    expect(check(Template.parse(t), Fill.parse(f))).toEqual({ errors: [], notes: [] });
  });
  it('says everything that is wrong, each with a code and a sentence, and never throws', () => {
    const { errors } = notes((f) => { delete f.texts.x1; f.music.prompt = 'music for {brand}'; f.script.close = 'It is [name]the Glow Serum.'; });
    expect(errors.map((error) => error.code)).toEqual(['fill-missing', 'unfilled:brand', 'mark-unbalanced']);
    for (const error of errors) expect(error.message.length).toBeGreaterThan(10);
  });
  it('a shot that continues a clip: the fill has prompts for every shot that owns a clip and none for a part', () => {
    const parts = (change: (f: Json) => void = () => {}) => { const f: Json = continuingFill(); change(f); return check(Template.parse(continuingTemplate()), Fill.parse(f)).errors; };
    expect(parts()).toEqual([]);
    expect(parts((f) => { delete f.shots.s4; })).toEqual([{ code: 'fill-missing', message: 'the fill has no shots.s4' }]);
    expect(parts((f) => { f.shots.s2 = { still_prompt: 'a bottle', motion_prompt: 'a push' }; })).toEqual([
      { code: 'fill-unknown', message: 'shots.s2: the shot continues the clip of "s1" and has no prompts of its own' },
    ]);
    expect(parts((f) => { f.shots.s3 = { motion_prompt: 'a push' }; }).map((error) => error.code)).toEqual(['fill-unknown']);
  });
  it('product-count: fewer or more products than the template takes', () => {
    expect(speech((f) => { f.products.push(f.products[0], f.products[0]); })).toEqual(['product-count']);
    expect(beats((_f, t) => { t.products = { min: 2, max: 3 }; })).toEqual(['product-count']);
  });
  it('fill-missing: a text, a shot, a still prompt, the presenter, a still or a segment of the template has no entry', () => {
    expect(speech((f) => { delete f.texts.x1; })).toEqual(['fill-missing']);
    expect(speech((f) => { delete f.shots.s2; })).toEqual(['fill-missing']);
    expect(beats((f) => { delete f.shots.s1.still_prompt; })).toEqual(['fill-missing']);
    expect(speech((f) => { delete f.presenter; })).toEqual(['fill-missing']);
    expect(speech((f) => { delete f.stills; })).toEqual(['fill-missing']);
    expect(beats((f, t) => { lead(f, t); delete f.stills; })).toEqual(['fill-missing']);             // a beats template has stills too
    expect(beats((f, t) => { lead(f, t); f.stills = {}; })).toEqual(['fill-missing']);
    expect(speech((f) => { delete f.script.close; })).toEqual(['fill-missing']);
    expect(speech((f) => { delete f.script; })).toEqual(['fill-missing', 'fill-missing']);
  });
  it('an id that is a property of every object finds nothing', () => {
    expect(speech((f, t) => { delete f.texts.x1; t.texts[0].id = 'constructor'; })).toEqual(['fill-missing']);
  });
  it('fill-unknown: an entry for an id the template does not have', () => {
    expect(speech((f) => { f.texts.x9 = 'Hello'; })).toEqual(['fill-unknown']);
    expect(speech((f) => { f.shots.s9 = { motion_prompt: 'she waves' }; })).toEqual(['fill-unknown']);
    expect(speech((f) => { f.stills.sky = { prompt: 'a sky' }; })).toEqual(['fill-unknown']);
    expect(speech((f) => { f.script.outro = 'Bye now.'; })).toEqual(['fill-unknown']);
    expect(beats((f) => { f.texts.x9 = 'Hello'; })).toEqual(['fill-unknown']);
    expect(beats((f) => { f.stills = { skin: { prompt: 'skin' } }; })).toEqual(['fill-unknown']);
    expect(beats((f, t) => { lead(f, t); f.stills.skin = { prompt: 'skin' }; })).toEqual(['fill-unknown']);
  });
  it('fill-unknown: a field of the other format', () => {
    expect(speech((f) => { f.shots.s1.still_prompt = 'a woman'; })).toEqual(['fill-unknown']);
    expect(beats((f) => { f.script = { open: 'Hello there.' }; })).toEqual(['fill-unknown']);
    expect(beats((f) => { f.presenter = { still_prompt: 'a woman' }; })).toEqual(['fill-unknown']);
  });
  it('unfilled:<placeholder>: a placeholder left in a copy, a prompt or the lines', () => {
    expect(speech((f) => { f.texts.x1 = 'I tried {product}'; })).toEqual(['unfilled:product']);
    expect(speech((f) => { f.shots.s1.motion_prompt = 'she holds {product}'; })).toEqual(['unfilled:product']);
    expect(beats((f) => { f.shots.s1.still_prompt = '{product} on a shelf'; })).toEqual(['unfilled:product']);
    expect(beats((f, t) => { lead(f, t); f.stills.lead.prompt = 'a woman with {product}'; })).toEqual(['unfilled:product']);
    expect(speech((f) => { f.music.prompt = 'music for {brand}'; })).toEqual(['unfilled:brand']);
    expect(speech((f) => { f.presenter.still_prompt = 'a woman with {product}'; })).toEqual(['unfilled:product']);
    expect(speech((f) => { f.stills.skin.prompt = '{before_subject}'; })).toEqual(['unfilled:before_subject']);
    expect(speech((f) => { f.script.close = 'It is [name]the {product}.[/name]'; })).toEqual(['unfilled:product']);
  });
  it('unfilled: every placeholder the editor would refuse, not only lower-case names', () => {
    for (const name of ['Product', 'product-name', '1', 'a.b', 'x:y']) {
      expect(speech((f) => { f.texts.x1 = `Try {${name}} now`; })).toEqual([`unfilled:${name}`]);
      expect(speech((f) => { f.script.close = `It is [name]the {${name}}.[/name]`; })).toEqual([`unfilled:${name}`]);
    }
  });
  it('copy-is-source: a copy that repeats the text of the reference video, whatever its case and spacing', () => {
    // the fixture's source_copy is "I tried Rivalbrand"
    expect(speech((f) => { f.texts.x1 = 'I tried Rivalbrand'; })).toEqual(['copy-is-source']);
    expect(speech((f) => { f.texts.x1 = '  i TRIED   rivalbrand '; })).toEqual(['copy-is-source']);
    expect(speech((f) => { f.texts.x1 = 'I tried\nRivalbrand'; })).toEqual(['copy-is-source']);
    expect(speech((f, t) => { t.texts[0].source_copy = 'I  tried\n GLOW serum'; })).toEqual(['copy-is-source']);
    expect(speech((f) => { f.texts.x1 = 'I tried Rivalbrand too'; })).toEqual([]);
    expect(speech((f, t) => { t.texts[0].source_copy = ''; f.texts.x1 = ' '; })).toEqual([]);          // no reference text: nothing to repeat
    expect(beats((f, t) => { f.texts.x1 = 'HI'; t.texts[0].source_copy = 'Hi'; })).toEqual(['copy-is-source']);
  });
  it('copy-is-source: dodges (punctuation, emoji, quotes, zero-width space, casing, width forms) are refused', () => {
    for (const dodge of ['I tried Rivalbrand.', 'I tried Rivalbrand 😍', '\u201cI tried Rivalbrand\u201d', 'I tried\u200B Rivalbrand', 'I TRIED RIVALBRAND!!!', '\uFF29 tried Rivalbrand', 'I-tried, Rivalbrand']) {
      expect(speech((f) => { f.texts.x1 = dodge; }), dodge).toEqual(['copy-is-source']);
    }
    expect(speech((f) => { f.texts.x1 = 'I tried Rivalbrand 2'; })).toEqual([]);
    expect(speech((f) => { f.texts.x1 = 'Totally different words'; })).toEqual([]);
    for (const only of ['...', '😍', '"!?"']) expect(speech((f, t) => { t.texts[0].source_copy = only; f.texts.x1 = '🔥!'; }), only).toEqual([]);
  });
  it('mark-lost: the script lost a mark of the template, or moved it to another segment', () => {
    expect(speech((f) => { f.script.open = '[hook]I tried Glow Serum for two weeks.[/hook] Look at this.'; })).toEqual(['mark-lost']);
    expect(speech((f) => { f.script.open = '[hook]I tried it.[/hook] Look.'; f.script.close = '[proof]It is[/proof] [name]the Glow Serum.[/name]'; })).toEqual(['mark-lost']);
    const { errors } = notes((f) => { f.script.open = 'I tried it. [proof]Look.[/proof]'; });
    expect(errors[0]!.message).toMatch(/segment "open" lost the mark \[hook\]/);
  });
  it('a mark the template does not have is allowed', () => {
    expect(speech((f) => { f.script.close = '[extra]It is[/extra] [name]the Glow Serum.[/name]'; })).toEqual([]);
  });
  it('what parseScript refuses: an unbalanced, an empty or a twice-used mark, a segment without words', () => {
    expect(speech((f) => { f.script.open = '[hook]I tried it. [proof]Look.[/proof]'; })).toEqual(['mark-unbalanced']);
    expect(speech((f) => { f.script.close = 'It is [name][/name] this.'; })).toEqual(['mark-empty']);
    expect(speech((f) => { f.script.close = '[hook]It is[/hook] [name]this.[/name]'; })).toEqual(['mark-duplicate']);
    expect(speech((f) => { f.script.close = '   '; })).toEqual(['segment-empty']);
  });
  it('window-overlap: the fill moved two window marks onto the same words', () => {
    expect(speech((f, t) => {
      t.windows.push({ mark: 'hook', corner: 'top-right', behind: 'still:skin' });
      f.script.open = '[hook]I tried Glow Serum for [proof]two weeks.[/proof][/hook] Look at this.';
    })).toEqual(['window-overlap']);
  });

  describe('notes: what this customer will not get, said before anything is paid', () => {
    const card = (image: string, id = 'c2') => ({ id, mark: 'hook', image, box: { left: 60, top: 27, right: 86, bottom: 50 } });
    it('left-out: a card on a product the customer did not give (the template takes 1 to 2)', () => {
      const result = notes((_f, t) => { t.cards.push(card('product:2')); });
      expect(result.errors).toEqual([]);
      expect(result.notes).toEqual([{ code: 'left-out', kind: 'card', element: 'c2', picture: 'product:2', message: expect.stringContaining('product 2') }]);
    });
    it('left-out: a card or a window on a photograph the customer did not give', () => {
      const result = notes((f, t) => { t.cards.push(card('product:1.2')); t.windows[0].behind = 'product:1.3'; t.stills = []; delete f.stills; });
      expect(result.errors).toEqual([]);
      expect(result.notes.map(({ kind, element, picture }) => [kind, element, picture])).toEqual([['card', 'c2', 'product:1.2'], ['window', 'proof', 'product:1.3']]);
    });
    it('nothing to note when the customer gave the product and the photograph', () => {
      const result = notes((f, t) => {
        t.cards.push(card('product:2'), card('product:1.2', 'c3'));
        f.products = [{ name: 'Glow Serum', images: ['uploads/u1/a.png', 'uploads/u1/b.png'] }, { name: 'Glow Cream', images: ['uploads/u1/c.png'] }];
      });
      expect(result).toEqual({ errors: [], notes: [] });
    });
  });
});
