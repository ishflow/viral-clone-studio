import { describe, expect, it } from 'vitest';
import { checkFill } from '../resolve/index.ts';
import { beatsTemplate, continuingTemplate, speechTemplate } from '../template/fixture.ts';
import { Fill, Template } from '../template/schema.ts';
import { placeholdersIn } from '../template/values.ts';
import { sampleFill } from './sample.ts';
import { golden } from './testing.ts';

describe('sampleFill', () => {
  it.each(['layering-01', 'lashly-01'] as const)('%s: a complete fill of the golden template, with nothing left out', (id) => {
    const template = Template.parse(golden(id));
    const fill = sampleFill(template);
    expect(Fill.safeParse(fill).error?.issues ?? []).toEqual([]);
    expect(checkFill(template, fill)).toEqual({ errors: [], notes: [] });
    expect(placeholdersIn(JSON.stringify(fill))).toEqual([]);
  });

  it('prompts for every shot that owns a clip and none for a shot that continues one: a fill checkFill takes', () => {
    const template = Template.parse(continuingTemplate());
    const fill = sampleFill(template);
    expect(Object.keys(fill.shots)).toEqual(['s1', 's4', 's5']);
    expect(checkFill(template, fill)).toEqual({ errors: [], notes: [] });
  });

  it('a placeholder becomes its own name, so a text keeps the length its pattern shows', () => {
    const fill = sampleFill(Template.parse(golden('layering-01')));
    expect(fill.texts.hook).toBe('the best quality\ncategory combo');
    expect(fill.texts['name-1']).toBe('brand product 1');
    expect(fill.shots.s2!.still_prompt).toContain('holds product 1 upright');
  });

  it('gives as many products as the template takes at most, and every photograph a card, a window or a still names', () => {
    const lashly = sampleFill(Template.parse(golden('lashly-01')));
    expect(lashly.products).toEqual([{ name: 'Sample product 1', images: ['uploads/sample/product-1-1.png', 'uploads/sample/product-1-2.png', 'uploads/sample/product-1-3.png'] }]);
    const two = sampleFill(Template.parse(speechTemplate()));        // products 1 … 2
    expect(two.products.map((product) => product.images.length)).toEqual([1, 1]);
  });

  it('keeps the marks of a script and fills only what the mode has', () => {
    const speech = sampleFill(Template.parse(speechTemplate()));
    expect(speech.script).toEqual({ open: '[hook]I tried product for two weeks.[/hook] [proof]Look at this.[/proof]', close: 'It is [name]the product.[/name]' });
    expect(speech.presenter).toEqual({ still_prompt: 'a woman holds product' });
    expect(speech.stills).toEqual({ skin: { prompt: 'a close picture of skin' } });
    expect(speech.shots.s1).toEqual({ motion_prompt: 'she leans in' });
    const beats = sampleFill(Template.parse(golden('layering-01')));
    expect([beats.script, beats.presenter, beats.stills]).toEqual([undefined, undefined, undefined]);
  });

  it('beats: a template with stills gets a prompt for every still', () => {
    const lead = { id: 'lead', prompt: 'a woman who holds {product}', references: [] };
    const template = Template.parse({ ...beatsTemplate(), stills: [lead], shots: [{ ...beatsTemplate().shots[0]!, stills: ['lead'] }] });
    const fill = sampleFill(template);
    expect(fill.stills).toEqual({ lead: { prompt: 'a woman who holds product' } });
    expect(checkFill(template, fill)).toEqual({ errors: [], notes: [] });
  });
});
