import { describe, expect, it } from 'vitest';
import { Template } from '../template/schema.ts';
import type { TemplateJson } from '../template/schema.ts';
import { COPIED_RUN_WORDS, COPY_CONTAINS_MIN, misplacedPlaceholders, NAME_SUBSTRING_MIN, namesIn, referenceOf, refusalsOf, SAMPLE_RUN_CHARS, takesPlaceholders } from './brand.ts';
import type { ReferenceText } from './brand.ts';
import { golden } from './testing.ts';

const NOTHING: ReferenceText = { names: [], spoken: '', title: '' };
const layering = () => Template.parse(golden('layering-01'));
const lashly = () => Template.parse(golden('lashly-01'));
const named = (...names: string[]): ReferenceText => ({ ...NOTHING, names });
/** Is `written`, put into a prompt, refused for the name? */
const refused = (name: string, written: string): boolean => {
  const template = layering();
  template.shots[1]!.still_prompt = `A hand holds the ${written} bottle over a white sheet.`;
  return refusalsOf(template, named(name)).some((finding) => finding.path === 'shots.1.still_prompt' && finding.kind === 'name');
};
const paths = (template: TemplateJson, reference: ReferenceText) => refusalsOf(template, reference).map((finding) => `${finding.path}: ${finding.kind}`);

describe('refusalsOf: names of the reference', () => {
  it.each(['layering-01', 'lashly-01'] as const)('%s: a golden template carries nothing of its reference outside source_copy', (id) => {
    const template = Template.parse(golden(id));
    const names = ['deo', 'Velmora', 'Mira Lane', 'Luz de Lisboa'];
    expect(refusalsOf(template, { names, spoken: template.texts.map((text) => text.source_copy).join(' '), title: 'the best vanilla girl scent layering combo' })).toEqual([]);
  });

  it(`a name of ${NAME_SUBSTRING_MIN} or more letters is refused wherever its folded form stands: joined, in the plural, in a tag, without its accent`, () => {
    for (const [name, written] of [
      ['Drunk Elephant', 'drunkelephant'], ['Drunk Elephant', 'DrunkElephant'], ['Luz de Lisboa', 'luzdelisboa'], ['Luz de Lisboa', 'LUZ-DE  LISBÓA'],
      ['Rivalbrand', 'rivalbrandhaul'], ['Rivalbrand', 'Rivalbrands'], ['Rivalbrand', 'Rival brand'], ['Rivalbrand', 'Rival-brand'], ['Rivalbrand', '#rivalbrand'],
      ["L'Oréal", 'Loreal'], ['CeraVe', 'Cera Ve'], ['Rivalbrand', 'Ｒｉｖａｌｂｒａｎｄ'],
    ] as const) expect([name, written, refused(name, written)]).toEqual([name, written, true]);
    expect(refused('Luz de Lisboa', 'Luz Lisboa')).toBe(false);
  });

  it('a shorter name is refused only as a whole word, also with s or \'s: "deo" is not found in "videos", "elf" not in "shelf"', () => {
    for (const written of ['elf', 'ELF', 'e.l.f.', "elf's", 'elfs', '#elf']) expect([written, refused('e.l.f.', written)]).toEqual([written, true]);
    for (const written of ['shelf', 'self', 'elfin', 'twelfth']) expect([written, refused('e.l.f.', written)]).toEqual([written, false]);
    const template = layering();
    template.description = 'Short videos of four bottles.';
    expect(refusalsOf(template, named('deo', '', '!'))).toEqual([]);
  });

  it('finds a name in every field a person or a provider reads, a style name included', () => {
    const template = layering();
    template.title = 'Rivalbrand line-up';
    template.tags[0] = 'rivalbrand';
    template.shots[0]!.action = 'All the Rivalbrand bottles stand together';
    template.texts[1]!.copy = 'rivalbrand {product_1}';
    template.audio.music.prompt = 'The Rivalbrand jingle.';
    template.styles = { ...template.styles, rivalbrand: template.styles.nametag! };
    expect(paths(template, named('Rivalbrand'))).toEqual(
      ['title: name', 'tags.0: name', 'shots.0.action: name', 'texts.1.copy: name', 'styles: name', 'audio.music.prompt: name'],
    );
    const speech = lashly();
    speech.presenter!.voice.sample_text = 'I love my Rivalbrand serum.';
    speech.script!.segments[0]!.lines = speech.script!.segments[0]!.lines.replace('everyone', 'Rivalbrand');
    expect(paths(speech, named('Rivalbrand'))).toEqual(['script.segments.0.lines: name', 'presenter.voice.sample_text: name']);
  });

  it("a placeholder is not a name: {benefit} stays when the reference's brand is Benefit", () => {
    const template = layering();
    template.texts[0]!.copy = 'the {benefit} combo';
    template.shots[0]!.still_prompt = 'A vanity with {all_products}, for {benefit}.';
    expect(refusalsOf(template, named('Benefit'))).toEqual([]);
    template.shots[0]!.still_prompt = 'A vanity with the Benefit tint.';
    expect(paths(template, named('Benefit'))).toEqual(['shots.0.still_prompt: name']);
  });

  it('a field whose words the format fixes is not searched: a tag #face or #pop does not make "people" or a "kind" a name', () => {
    const fixed = ['beats', 'speech', 'hands', 'face', 'none', 'all', 'push-in', 'zoom', 'crossfade', 'fade', 'pop', 'dip', 'Inter', 'Montserrat', 'center', 'top-right', 'product', 'still', 'layering-01', 'lashly-01'];
    for (const template of [layering(), lashly()]) {
      const found = paths(template, named(...fixed, template.presenter?.voice.voice_id ?? 'x')).filter((path) => !/^(tags|title|description|category|card)\b|\.(action|copy|lines|prompt|still_prompt|motion_prompt|sample_text)\b/.test(path));
      expect(found).toEqual([]);
    }
    const card = layering();
    card.tags = ['line-up'];
    expect(paths(card, named('no-talking', '1.9M'))).toEqual([]);                                // what the card computes (its format, the views) is not the model's
    const template = layering();
    template.shots[0]!.id = 'rivalbrand';                                                    // an id is the model's own word: it is searched
    expect(paths(template, named('Rivalbrand'))).toEqual(['shots.0.id: name']);
  });

  it('source_copy and the source are where the reference may stand', () => {
    const template = layering();
    expect(template.texts[1]!.source_copy).toContain('deo');
    template.source.url = 'https://example.com/@rivalbrand/video/1';
    expect(refusalsOf(template, named('deo', 'rivalbrand'))).toEqual([]);
  });
});

describe('referenceOf: where the names come from', () => {
  it('takes the names of the score, every @handle of the title and of the speech, the #tags the score names, and the creator of the address', () => {
    expect(namesIn('Rivalbrand haul #rivalbrand #fyp with @rival.creator_x and me@example.com, #1')).toEqual(['rivalbrand', 'fyp', 'rival.creator_x', 'example.com', '1']);
    const reference = referenceOf(
      { title: 'my haul #Rivalshop', words: [{ text: 'thanks', start: 0, end: 1 }, { text: '@otherbrand', start: 1, end: 2 }], url: 'https://www.example.com/@creatorname/video/7' },
      ['Rivalbrand', 'rivalshop'],
    );
    expect(reference).toEqual({ names: ['Rivalbrand', 'rivalshop', 'Rivalshop', 'otherbrand', 'creatorname'], spoken: 'thanks @otherbrand', title: 'my haul #Rivalshop' });
  });

  it('a #tag is a name only when the score answer names it: #rivalbrandhaul with the brand "Rivalbrand" is, #fyp is not', () => {
    const look = { title: 'Rivalbrand haul #rivalbrandhaul #fyp #rival', words: [], url: '' };
    expect(referenceOf(look, ['Rivalbrand']).names).toEqual(['Rivalbrand', 'rivalbrandhaul', 'rival']);
    const template = layering();
    template.tags[0] = 'rivalbrandhaul';
    expect(paths(template, referenceOf(look, ['Rivalbrand']))).toEqual(['tags.0: name']);
  });

  it('a #tag that no brand of the score matches is not a name: a brand the score missed can pass (the limit that stays)', () => {
    const template = layering();
    template.shots[1]!.still_prompt = 'A hand holds the Rivalbrand lotion.';
    expect(paths(template, referenceOf({ title: 'Rivalbrand haul #rivalbrand', words: [], url: '' }, []))).toEqual([]);
  });

  it('an ordinary word that is a tag of the reference (#skincare) is no name: category "skincare" passes', () => {
    const template = layering();
    template.category = 'skincare';
    expect(paths(template, referenceOf({ title: 'my routine #skincare', words: [], url: '' }, []))).toEqual([]);
    expect(paths(template, referenceOf({ title: 'my routine #skincare', words: [], url: '' }, ['Rivalbrand']))).toEqual([]);
  });
});

describe('refusalsOf: copied words', () => {
  it(`finds ${COPIED_RUN_WORDS} consecutive words of the speech, of the title or of a source_copy; one word fewer is allowed`, () => {
    const spoken = 'okay so this is the combo that gets me the most compliments every single day';
    const copied = layering();
    copied.shots[0]!.still_prompt = 'A vanity. This is the combo that gets me compliments.';       // 6 words in a row
    expect(refusalsOf(copied, { ...NOTHING, spoken })).toEqual([{ path: 'shots.0.still_prompt', kind: 'copied' }]);
    const near = layering();
    near.shots[0]!.still_prompt = 'A vanity. The combo that gets me compliments.';                 // 5
    expect(refusalsOf(near, { ...NOTHING, spoken })).toEqual([]);
    const title = layering();
    title.description = 'My honest review of the new hair mist, in eight seconds.';
    expect(refusalsOf(title, { ...NOTHING, title: 'my honest review of the new hair mist' })).toEqual([{ path: 'description', kind: 'copied' }]);
    const dodging = layering();
    dodging.shots[0]!.still_prompt = 'This is the {x} combo that gets me compliments.';            // a placeholder does not break the run
    expect(refusalsOf(dodging, { ...NOTHING, spoken })).toEqual([{ path: 'shots.0.still_prompt', kind: 'copied' }]);
  });

  it(`a copy is not its source_copy, and does not contain one of ${COPY_CONTAINS_MIN} or more letters`, () => {
    const same = layering();
    same.texts[3]!.source_copy = 'Day 1!';
    same.texts[3]!.copy = 'day 1 {product_3}';
    expect(refusalsOf(same, NOTHING)).toEqual([{ path: 'texts.3.copy', kind: 'copy-is-source' }]);
    const short = layering();
    short.texts[3]!.source_copy = 'Day 1!';
    short.texts[3]!.copy = 'on day 12 {product_3}';                                                // contains "day1", which is shorter
    expect(refusalsOf(short, NOTHING)).toEqual([]);
    const within = layering();
    within.texts[0]!.source_copy = 'POV: you found the one';
    within.texts[0]!.copy = 'POV: you found the one\n{product_1}';
    expect(refusalsOf(within, NOTHING)).toEqual([{ path: 'texts.0.copy', kind: 'copy-is-source' }]);
    within.texts[0]!.copy = 'when you find {product_1}';
    expect(refusalsOf(within, NOTHING)).toEqual([]);
  });

  it(`sample_text holds no run of ${SAMPLE_RUN_CHARS} letters of what is said`, () => {
    const spoken = 'I tested a lash serum for four weeks and wow';
    const template = lashly();
    template.presenter!.voice.sample_text = 'So, I tested a lash serum for a while.';              // "itestedalashserumfor": 20 letters
    expect(refusalsOf(template, { ...NOTHING, spoken })).toEqual([{ path: 'presenter.voice.sample_text', kind: 'copied' }]);
    template.presenter!.voice.sample_text = 'So, I tested a lash tint for a while.';
    expect(refusalsOf(template, { ...NOTHING, spoken })).toEqual([]);
  });
});

describe('placeholders', () => {
  it('a {placeholder} stands only where a fill replaces it', () => {
    for (const path of ['texts.0.copy', 'shots.3.still_prompt', 'shots.3.motion_prompt', 'audio.music.prompt', 'script.segments.1.lines', 'presenter.still_prompt', 'stills.0.prompt']) expect([path, takesPlaceholders(path)]).toEqual([path, true]);
    for (const path of ['title', 'description', 'category', 'tags.0', 'shots.0.action', 'presenter.voice.sample_text', 'shots.0.id', 'styles']) expect([path, takesPlaceholders(path)]).toEqual([path, false]);
    expect(misplacedPlaceholders(layering())).toEqual([]);
    expect(misplacedPlaceholders(lashly())).toEqual([]);
  });

  it('elsewhere it is refused: title, description, category, tags, action, sample_text', () => {
    const template = lashly();
    template.title = '{brand} in four weeks';
    template.description = 'A presenter shows {product}.';
    template.category = '{category}';
    template.tags[0] = '{tag}';
    template.shots[0]!.action = 'She holds {product}';
    template.presenter!.voice.sample_text = 'Hello, this is {brand}.';
    const expected = ['title', 'description', 'category', 'tags.0', 'shots.0.action', 'presenter.voice.sample_text'].map((path) => ({ path, kind: 'placeholder' }));
    expect(misplacedPlaceholders(template)).toEqual(expected);
    expect(refusalsOf(template, NOTHING)).toEqual(expected);
  });
});
