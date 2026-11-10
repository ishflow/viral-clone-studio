// timeline.json against edit.json for every sweep document, without a render: compose writes the timeline, promise.ts
// works out from the edit alone what it must say. The falsified tables show that one frame off in any list is caught.
import { describe, expect, it } from 'vitest';
import { compose } from '../compose/index.ts';
import { parseEdit } from '../edit/schema.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { ComposeFacts, Edit } from '../edit/types.ts';
import * as D from './documents.ts';
import { promiseErrors } from './promise.ts';

const FACTS: Record<string, ComposeFacts> = {};
for (const k of ['va', 'vb', 'vc', 'vx', 'vy', 'vz']) FACTS[k] = { frames: 150, audio: false };
for (const k of ['img-p', 'img-q', 'img-r', 'img-s', 'img-t', 'img-u']) FACTS[k] = { frames: 0, audio: false, width: 720, height: 1280 };
FACTS['card-wide'] = { frames: 0, audio: false, width: 480, height: 320 };
FACTS['card-tall'] = { frames: 0, audio: false, width: 300, height: 500 };
for (const k of ['m-loop', 'fx-a', 'fx-b']) FACTS[k] = { frames: 70, audio: true };
FACTS['m-b'] = { frames: 150, audio: true };       // document 13 plays it from frame 10 for 100 frames, without loop

const DOCUMENTS: Record<string, () => Edit> = {
  '01': D.cuts, '02': D.transitionsVideoImage, '03': D.transitionsVideoVideo, '04': D.transitionsImageImage, '05': D.textsAtCuts, '06': D.textExits,
  '07': D.captionsPill, '08': D.captionsFill, '09': D.cardsOnWords, '10': D.windowsImage, '11': D.windowsVideo, '12': D.musicLoop, '13': D.musicCaptions, '14': D.longDocument,
};
function composed(build: () => Edit): { edit: Edit; timeline: Timeline } {
  const parsed = parseEdit(build());
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues).slice(0, 500));
  return { edit: parsed.edit, timeline: compose(parsed.edit, FACTS).timeline };
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('timeline.json says in frames what edit.json says', () => {
  for (const [name, build] of Object.entries(DOCUMENTS)) {
    it(`document ${name}`, () => {
      const { edit, timeline } = composed(build);
      expect(promiseErrors(edit, timeline)).toEqual([]);
    });
  }
});

describe('a timeline one frame off (or empty) is caught', () => {
  const cases: [string, () => Edit, (t: Timeline) => void, RegExp][] = [
    ['a shot one frame late', D.cuts, (t) => { t.shots[2]!.at += 1; }, /shot s3/],
    ['a shot from one source frame later', D.cuts, (t) => { t.shots[3]!.from += 1; }, /shot s4/],
    ['a transition one frame longer', D.transitionsVideoImage, (t) => { t.transitions[0]!.for += 1; }, /transition into s2/],
    ['a text line whose rest starts one frame late', D.textsAtCuts, (t) => { t.texts[1]!.rest.at += 1; t.texts[1]!.rest.for -= 1; }, /text lines line 2/],
    ['a text one frame shorter', D.textExits, (t) => { t.texts[0]!.for -= 1; }, /text fade line 1/],
    ['a caption word one frame early', D.captionsPill, (t) => { t.captions[1]!.words[1]!.at -= 1; t.captions[1]!.words[0]!.for -= 1; t.captions[1]!.words[1]!.for += 1; }, /caption words/],
    ['a caption group one frame longer', D.captionsFill, (t) => { t.captions[4]!.for += 1; t.captions[4]!.rest.for += 1; t.captions[4]!.words[0]!.for += 1; }, /caption group 5/],
    ['two caption words swapped', D.captionsPill, (t) => { const w = t.captions[0]!.words; [w[1]!.text, w[2]!.text] = [w[2]!.text, w[1]!.text]; }, /caption words/],
    ['a card one frame late', D.cardsOnWords, (t) => { t.cards[1]!.at += 1; }, /card cb/],
    ['a window swap one frame late', D.windowsImage, (t) => { const p = t.windows[1]!.pictures; p[0]!.for += 1; p[1]!.at += 1; p[1]!.for -= 1; }, /window of s1 at 44/],
    ['no texts', D.textExits, (t) => { t.texts = []; }, /texts: the edit has 4, the timeline none/],
    ['no caption groups', D.captionsPill, (t) => { t.captions = []; }, /captions: the edit has 13 words, the timeline no group/],
    ['no cards', D.cardsOnWords, (t) => { t.cards = []; }, /cards: the edit has 3, the timeline none/],
    ['no windows', D.windowsVideo, (t) => { t.windows = []; }, /windows: the edit has 3, the timeline none/],
  ];
  for (const [title, build, falsify, expected] of cases) {
    it(title, () => {
      const { edit, timeline } = composed(build);
      const t = clone(timeline);
      falsify(t);
      const errors = promiseErrors(edit, t);
      expect(errors.some((e) => expected.test(e)), errors.join('\n')).toBe(true);
    });
  }
});
