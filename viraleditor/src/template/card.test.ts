import { describe, expect, it } from 'vitest';
import { cardOf } from './card.ts';
import { beatsTemplate, continuingTemplate, speechTemplate } from './fixture.ts';
import { Template } from './schema.ts';

describe('cardOf', () => {
  it('beats: seconds from the last frame and fps, shot ranges, overlapping text, first product, the action of each shot', () => {
    const t = beatsTemplate();
    t.shots = [
      { id: 's1', at: 0, for: 45, products: ['1'], still_prompt: 'PROMPT-STILL-1', motion_prompt: 'PROMPT-MOTION-1', clip_seconds: 2, action: 'A hand lifts the bottle' },
      { id: 's2', at: 45, for: 45, products: [], still_prompt: 'PROMPT-STILL-2', motion_prompt: 'PROMPT-MOTION-2', clip_seconds: 2, action: 'The bottle on a shelf' },
    ];
    t.texts = [{ id: 'x1', at: 0, for: 30, box: { left: 0, top: 0, right: 1, bottom: 1 }, style: 'main', copy: 'Hello', source_copy: 'Hello' }];
    const card = cardOf(Template.parse(t), { image: 'templates/t1/poster.jpg', video: null });
    expect(card.seconds).toBe(3);
    expect(card.format).toBe('no-talking');
    expect(card.image).toBe('templates/t1/poster.jpg');
    expect(card.video).toBeNull();
    expect(card.description).toBe('One bottle, one line.');
    expect(card.shots).toEqual([
      { n: 1, from: 0, to: 1.5, action: 'A hand lifts the bottle', text: 'Hello', product: 1 },
      { n: 2, from: 1.5, to: 3, action: 'The bottle on a shelf', text: '', product: null },
    ]);
  });
  it('a shot that continues a clip shows its owner\'s product (a part names none of its own)', () => {
    const card = cardOf(Template.parse(continuingTemplate()), { image: null, video: null });
    expect(card.shots.map((s) => s.product)).toEqual([1, 1, 1, 1, 1]);              // s2 and s3 continue s1
  });
  it('speech: seconds is the sum of segment seconds, format talking, the action of each shot', () => {
    const t = speechTemplate();
    t.shots[1]!.products = [];
    const card = cardOf(Template.parse(t), { image: null, video: null });
    expect(card.seconds).toBe(11);
    expect(card.format).toBe('talking');
    expect(card.description).toBe('A presenter shows a before and an after.');
    expect(card.shots.map((s) => [s.from, s.to, s.action, s.product])).toEqual([[0, 6, 'She promises a result', 1], [6, 11, 'She names the product', null]]);
  });
  it('products is the number of products every customer of the template gives (products.min)', () => {
    const t = speechTemplate();                                       // takes 1 to 2 products
    expect(cardOf(Template.parse(t), { image: null, video: null }).products).toBe(1);
    t.products = { min: 2, max: 2 };
    expect(cardOf(Template.parse(t), { image: null, video: null }).products).toBe(2);
  });
  it.each([
    [1_900_000, '1.9M'], [8_900_000, '8.9M'], [500_000, '500K'], [999, '999'], [1_000, '1K'], [1_250_000, '1.3M'],
    [0, ''], [5_000_000, '5M'], [19_800_000, '19.8M'], [999_960, '1M'], [2_400_000_000, '2.4B'],
  ])('referenceViews: %d views are shown as "%s"', (views, shown) => {
    const t = beatsTemplate();
    t.source.metrics.views = views;
    expect(cardOf(Template.parse(t), { image: null, video: null }).referenceViews).toBe(shown);
  });
  it('never shows a generation prompt, the lines of the script or the text of the reference', () => {
    const beats = beatsTemplate();
    beats.shots[0]!.still_prompt = 'PROMPT-STILL';
    beats.shots[0]!.motion_prompt = 'PROMPT-MOTION';
    beats.audio.music.prompt = 'PROMPT-MUSIC';
    beats.texts[0]!.source_copy = 'RIVALBRAND original';
    const speech = speechTemplate();
    speech.shots.forEach((shot) => { shot.motion_prompt = 'PROMPT-MOTION'; });
    speech.presenter.still_prompt = 'PROMPT-PRESENTER';
    speech.presenter.voice.sample_text = 'PROMPT-VOICE';
    speech.stills[0]!.prompt = 'PROMPT-STILL';
    speech.audio.music.prompt = 'PROMPT-MUSIC';
    speech.texts[0]!.source_copy = 'RIVALBRAND original';
    for (const template of [beats, speech]) {
      const shown = JSON.stringify(cardOf(Template.parse(template), { image: null, video: null }));
      expect(shown).not.toMatch(/PROMPT|RIVALBRAND|\[hook\]/);
    }
  });
});
