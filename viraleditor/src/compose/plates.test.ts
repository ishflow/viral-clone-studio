// A text with a plate and more than one line: the plates of its lines never cover each other, whatever the padding and size.
// Live case (6 Oct, HWiuCtazQ6s): style `band` (size 24, padY 0.4) in a box 14-22 % high on 720 × 1280, two lines; the plate of
// line 2 was painted over the foot of line 1 and `hyperframes check` failed with `text_occluded`.
import { describe, expect, it } from 'vitest';
import type { Edit, TextStyle } from '../edit/types.ts';
import { shortEdit, shortFacts } from './fixture.ts';
import { compose } from './index.ts';

const COPY = 'Tan and dead skin bothering you? Try this sponge now';

function linesOf(style: TextStyle, box = { left: 6, top: 14, right: 86, bottom: 22 }, lines = 2) {
  const edit: Edit = {
    ...shortEdit(720), styles: { band: style }, cards: [], captions: undefined, audio: undefined,
    texts: [{ id: 'my-cap', at: 0, for: 90, box, style: 'band', copy: COPY, lines, enter: { kind: 'none' }, exit: { kind: 'none' } }],
  };
  const { timeline } = compose(edit, shortFacts());
  const pad = (size: number) => Math.ceil(style.plate!.padY * size);
  const boxTop = Math.round((box.top / 100) * 1280), boxBottom = Math.round((box.bottom / 100) * 1280);
  return {
    boxTop, boxBottom,
    plates: timeline.texts.map((l) => ({ top: l.rect.y - pad(l.size), bottom: l.rect.y + l.rect.height + pad(l.size) })),
  };
}

describe('a plated text of several lines', () => {
  const band = (padY: number, size = 24): TextStyle => ({ font: 'Inter', weight: 500, size, align: 'center', fill: '#111111', shadows: [], plate: { colour: '#FFFFFF', radius: 0, padX: 0.5, padY } });

  it.each([0.4, 0.5, 0.3, 0.22, 0.1, 0])('the live case: padY %s at size 24, two lines, no plate covers another', (padY) => {
    const { plates } = linesOf(band(padY));
    expect(plates).toHaveLength(2);
    expect(plates[0]!.bottom).toBeLessThanOrEqual(plates[1]!.top);
  });

  it('the plates of three lines at a larger size and padding stand in order, inside the text box', () => {
    const { plates, boxTop, boxBottom } = linesOf(band(0.6, 28), { left: 6, top: 14, right: 86, bottom: 45 }, 3);
    expect(plates.length).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < plates.length; k++) expect(plates[k - 1]!.bottom).toBeLessThanOrEqual(plates[k]!.top);
    expect(plates[0]!.top).toBeGreaterThanOrEqual(boxTop);
    expect(plates.at(-1)!.bottom).toBeLessThanOrEqual(boxBottom);
  });

  it('a single plated line stays where it was: its line box is centred in the text box', () => {
    const { plates, boxTop, boxBottom } = linesOf(band(0.4), { left: 6, top: 14, right: 94, bottom: 22 }, 1);
    expect(plates).toHaveLength(1);
    expect(plates[0]!.top).toBeGreaterThanOrEqual(boxTop);
    expect(plates[0]!.bottom).toBeLessThanOrEqual(boxBottom);
  });
});
