import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fitText, textWidth, unknownGlyphs } from './index.ts';
import type { FitStyle } from './index.ts';
import metrics from './metrics.json' with { type: 'json' };

// The six copies of spike P7: Inter 800, 36 px, line height 1.2, box 600 px wide.
const P7: FitStyle = { font: 'Inter', weight: 800, size: 36, leading: 1.2 };
const SPIKE: { lines: number; height: number; copy: string; size: number; broken?: string[] }[] = [
  { lines: 1, height: 48, copy: 'Kısa bir cümle', size: 36 },
  { lines: 1, height: 48, copy: "İstanbul'da ışıl ışıl çiçekli güzel bir öğle şöleni", size: 26 },
  { lines: 1, height: 48, copy: 'Bunu mutlaka dene 😍 çok güzel oldu gerçekten', size: 24 },   // 25 before emoji counted 1.25 em instead of 1 em
  { lines: 1, height: 48, copy: 'Çekoslovakyalılaştıramadıklarımızdanmışsınız', size: 25 },
  { lines: 2, height: 92, copy: 'Üç hafta boyunca her gece sürdüm ve sonuç gerçekten çok şaşırtıcı oldu', size: 31, broken: ['Üç hafta boyunca her gece sürdüm', 've sonuç gerçekten çok şaşırtıcı oldu'] },
  { lines: 3, height: 136, copy: 'İlk gün hiçbir şey fark etmedim, ikinci hafta kirpiklerim gözle görülür şekilde uzadı, dördüncü haftada herkes sormaya başladı', size: 27,
    broken: ['İlk gün hiçbir şey fark etmedim, ikinci hafta', 'kirpiklerim gözle görülür şekilde uzadı,', 'dördüncü haftada herkes sormaya başladı'] },
];
const BOX = { width: 600, height: 48 };

describe('spike P7 copies', () => {
  for (const c of SPIKE) {
    it(`${c.copy.slice(0, 24)}… fits at ${c.size} px`, () => {
      const r = fitText(c.copy, P7, { width: 600, height: c.height }, { lines: c.lines, shrink: 0.5 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.size).toBe(c.size);
      expect(r.lineHeight).toBe(Math.round(c.size * 1.2));
      if (c.broken) expect(r.lines).toEqual(c.broken);
      else expect(r.lines).toEqual([c.copy]);
      for (const w of r.widths) expect(w).toBeLessThanOrEqual(600 * 0.98);
    });
  }
});

describe('line breaks and limits', () => {
  it("'\\n' forces a break, and \\r\\n too", () => {
    for (const copy of ['one\ntwo', 'one\r\ntwo']) {
      const r = fitText(copy, P7, { width: 600, height: 200 }, { lines: 3, shrink: 0.5 });
      expect(r).toMatchObject({ ok: true, lines: ['one', 'two'], size: 36 });
    }
  });
  it('a forced break counts against the line limit', () => {
    expect(fitText('one\ntwo', P7, { width: 600, height: 200 }, { lines: 1, shrink: 0.5 })).toMatchObject({ ok: false, code: 'text-too-long' });
  });
  it('lines: 1 never wraps: a long copy shrinks instead', () => {
    const r = fitText('word '.repeat(12).trim(), P7, BOX, { lines: 1, shrink: 0.3 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.lines).toHaveLength(1); expect(r.size).toBeLessThan(36); }
  });
  it('a copy that fits at the style size keeps it', () => {
    const r = fitText('Hello', P7, BOX, { lines: 1, shrink: 0.5 });
    expect(r).toMatchObject({ ok: true, size: 36, lines: ['Hello'] });
  });
  it('shrink: 1 never shrinks', () => {
    const long = 'a very long copy that cannot sit on one line at thirty six pixels in this box';
    expect(fitText(long, P7, BOX, { lines: 1, shrink: 1 })).toMatchObject({ ok: false, code: 'text-too-long', smallest: 36 });
    expect(fitText('Hello', P7, BOX, { lines: 1, shrink: 1 })).toMatchObject({ ok: true, size: 36 });
  });
  it('the box height limits the sizes (lines × rounded line height)', () => {
    const r = fitText('Hello', { ...P7, leading: 1 }, { width: 600, height: 20 }, { lines: 1, shrink: 0.3 });
    expect(r).toMatchObject({ ok: true, size: 20, lineHeight: 20 });
  });
  it('the default leading is 1.15', () => {
    const r = fitText('Hello', { font: 'Inter', weight: 400, size: 40 }, BOX, { lines: 1, shrink: 1 });
    expect(r).toMatchObject({ ok: true, lineHeight: 46 });
  });
  it('text-too-long reports the smallest size, the box width needed and the box width', () => {
    const r = fitText('Çekoslovakyalılaştıramadıklarımızdanmışsınız', P7, { width: 300, height: 48 }, { lines: 1, shrink: 0.5 });
    expect(r).toMatchObject({ ok: false, code: 'text-too-long', reason: 'word', smallest: 18, available: 294 });
    if (!r.ok && r.code === 'text-too-long') expect(r.needed).toBeGreaterThan(294);
  });
  it('an empty copy gives no lines', () => {
    expect(fitText('  \n ', P7, BOX, { lines: 1, shrink: 0.5 })).toMatchObject({ ok: true, lines: [], widths: [] });
  });
  it('does not throw on odd numbers', () => {
    for (const style of [{ ...P7, size: 0 }, { ...P7, size: NaN }, { ...P7, weight: NaN }]) {
      expect(() => fitText('Hello world', style, BOX, { lines: 0, shrink: NaN })).not.toThrow();
    }
    expect(() => fitText('Hello world', P7, { width: 0, height: 0 }, { lines: 2, shrink: 0.5 })).not.toThrow();
  });
});

describe('glyphs', () => {
  it('CJK and Arabic give text-glyph naming the character, each once', () => {
    expect(fitText('Hello 漢字 漢', P7, BOX, { lines: 1, shrink: 0.5 })).toEqual({ ok: false, code: 'text-glyph', characters: ['漢', '字'] });
    expect(fitText('مرحبا', P7, BOX, { lines: 1, shrink: 0.5 })).toMatchObject({ ok: false, code: 'text-glyph' });
    expect(unknownGlyphs('a漢b', 'Montserrat')).toEqual(['漢']);
    expect(textWidth('漢', P7, 36)).toBeNull();
  });
  it('an emoji is accepted and counts 1.25 em', () => {
    expect(unknownGlyphs('😍 👩‍👩‍👧', 'Inter')).toEqual([]);
    expect(textWidth('😍', P7, 40)).toBeCloseTo(50, 5);
    expect(textWidth('👩‍👩‍👧', P7, 40)).toBeCloseTo(50, 5);
  });
  it('(c) and (tm) signs use their table width, not the emoji width', () => {
    expect(textWidth('©', P7, 1000)).not.toBe(1000);
  });
  it('Turkish letters are in the table of both fonts', () => {
    for (const font of ['Inter', 'Montserrat'] as const) {
      expect(unknownGlyphs('İıŞşĞğÜüÖöÇç', font)).toEqual([]);
      for (const ch of 'İıŞşĞğÜüÖöÇç') expect((metrics[font].advances as Record<string, number[]>)[ch]).toHaveLength(9);
    }
  });
  it('the table has the candidates of design §5.8 that the font contains (Inter: 328, Montserrat: 329) and the weights 100…900', () => {
    for (const [font, count] of [['Inter', 328], ['Montserrat', 329]] as const) {
      expect(Object.keys(metrics[font].advances)).toHaveLength(count);
      expect(metrics[font].weights).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    }
  });
});

describe('width', () => {
  const adv = (ch: string, i: number) => (metrics.Inter.advances as Record<string, number[]>)[ch][i];
  it('is the table advance × size / 1000 at a table weight', () => {
    expect(textWidth('a', { font: 'Inter', weight: 400, size: 10 }, 20)).toBeCloseTo((adv('a', 3) * 20) / 1000, 9);
  });
  it('interpolates linearly between two table weights', () => {
    const w = textWidth('a', { font: 'Inter', weight: 450, size: 10 }, 1000);
    expect(w).toBeCloseTo((adv('a', 3) + adv('a', 4)) / 2, 9);
    expect(textWidth('a', { font: 'Inter', weight: 425, size: 10 }, 1000)).toBeCloseTo(adv('a', 3) * 0.75 + adv('a', 4) * 0.25, 9);
  });
  it('clamps weights outside 100…900', () => {
    expect(textWidth('a', { font: 'Inter', weight: 1200, size: 10 }, 100)).toBeCloseTo((adv('a', 8) * 100) / 1000, 9);
    expect(textWidth('a', { font: 'Inter', weight: 0, size: 10 }, 100)).toBeCloseTo((adv('a', 0) * 100) / 1000, 9);
  });
  it('tracking adds tracking × size per grapheme (an emoji is one grapheme)', () => {
    const base = textWidth('ab😍', P7, 30) as number;
    expect(textWidth('ab😍', { ...P7, tracking: 0.05 }, 30)).toBeCloseTo(base + 3 * 0.05 * 30, 9);
  });
  it('tracking shrinks the size that fits', () => {
    const copy = 'Tracking makes this copy wider than before';
    const a = fitText(copy, P7, BOX, { lines: 1, shrink: 0.3 });
    const b = fitText(copy, { ...P7, tracking: 0.1 }, BOX, { lines: 1, shrink: 0.3 });
    expect(a.ok && b.ok && b.size < a.size).toBe(true);
  });
});

describe('properties', () => {
  const word = fc.stringMatching(/^[A-Za-zÀ-ÿŞşĞğİı0-9.,!?'-]{1,14}$/);
  const copy = fc.array(word, { minLength: 1, maxLength: 24 }).map((w) => w.join(' '));
  const style = fc.record({
    font: fc.constantFrom('Inter' as const, 'Montserrat' as const),
    weight: fc.integer({ min: 100, max: 900 }),
    size: fc.integer({ min: 12, max: 120 }),
    tracking: fc.option(fc.double({ min: -0.05, max: 0.2, noNaN: true }), { nil: undefined }),
    leading: fc.option(fc.double({ min: 0.9, max: 1.6, noNaN: true }), { nil: undefined }),
  });
  const box = fc.record({ width: fc.integer({ min: 40, max: 1080 }), height: fc.integer({ min: 20, max: 1920 }) });
  const options = fc.record({ lines: fc.integer({ min: 1, max: 5 }), shrink: fc.double({ min: 0.3, max: 1, noNaN: true }) });

  it('an ok result sits in the box, keeps the words in order, and the function is pure', () => {
    fc.assert(fc.property(copy, style, box, options, (c, s, b, o) => {
      const r = fitText(c, s, b, o);
      expect(fitText(c, s, b, o)).toEqual(r);
      if (!r.ok) return;
      expect(r.lines.length).toBeLessThanOrEqual(o.lines);
      expect(r.lines.length * r.lineHeight).toBeLessThanOrEqual(b.height);
      expect(r.widths).toHaveLength(r.lines.length);
      r.lines.forEach((line, i) => {
        expect(r.widths[i]).toBeLessThanOrEqual(b.width * 0.98);
        expect(r.widths[i]).toBe(textWidth(line, s, r.size));
      });
      expect(r.lines.join(' ').split(/\s+/)).toEqual(c.split(/\s+/));
      r.widths.forEach((w) => { expect(Number.isFinite(w) && w > 0).toBe(true); });
      r.lines.forEach((l) => expect(l.length).toBeGreaterThan(0));
      expect(Number.isInteger(r.size)).toBe(true);
      expect(r.size).toBeLessThanOrEqual(s.size);
      expect(r.size).toBeGreaterThanOrEqual(Math.ceil(s.size * o.shrink));
    }), { numRuns: 300 });
  }, 60_000);
  it('is the largest size that fits: the next size up would not', () => {
    fc.assert(fc.property(copy, style, box, options, (c, s, b, o) => {
      const r = fitText(c, s, b, o);
      if (!r.ok || r.size === s.size) return;
      const up = fitText(c, { ...s, size: r.size + 1 }, b, { lines: o.lines, shrink: 1 });
      expect(up.ok).toBe(false);
    }), { numRuns: 200 });
  }, 60_000);
  it('never throws, whatever the characters', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary' }), style, box, options, (c, s, b, o) => {
      expect(() => fitText(c, s, b, o)).not.toThrow();
    }), { numRuns: 300 });
  }, 60_000);
  it('a failure is text-too-long with finite numbers, or text-glyph with characters', () => {
    fc.assert(fc.property(copy, style, box, options, (c, s, b, o) => {
      const r = fitText(c, s, b, o);
      if (r.ok) return;
      if (r.code === 'text-too-long') { expect(Number.isFinite(r.needed)).toBe(true); expect(r.needed).toBeGreaterThan(r.available); }
      else expect(r.characters.length).toBeGreaterThan(0);
    }), { numRuns: 200 });
  }, 60_000);
});

describe('fix round 1', () => {
  const adv = (ch: string, i: number) => (metrics.Inter.advances as Record<string, number[]>)[ch][i];
  const roundTrips = (r: unknown) => expect(JSON.parse(JSON.stringify(r))).toEqual(r);

  it('1: a 200 000-word copy returns a result instead of overflowing the stack', () => {
    const copy = Array.from({ length: 200_000 }, () => 'ab').join(' ');
    const r = fitText(copy, P7, BOX, { lines: 1, shrink: 0.5 });
    expect(r).toMatchObject({ ok: false, code: 'text-too-long', reason: 'lines' });
  }, 60_000);

  it('2: negative tracking does not count the trailing tracking (the last glyph ink does not move)', () => {
    const style: FitStyle = { ...P7, weight: 400, tracking: -0.05 };
    const sum = adv('a', 3) + adv('b', 3) + adv('c', 3);
    expect(textWidth('abc', style, 100)).toBeCloseTo((sum * 100) / 1000 - 0.05 * 100 * 2, 9);
    expect(textWidth('a', style, 100)).toBeCloseTo((adv('a', 3) * 100) / 1000, 9);
    // positive tracking keeps the trailing one (the safe side)
    expect(textWidth('abc', { ...style, tracking: 0.05 }, 100)).toBeCloseTo((sum * 100) / 1000 + 0.05 * 100 * 3, 9);
  });
  it('2: wrapping with negative tracking measures each line the way textWidth does', () => {
    const style: FitStyle = { ...P7, tracking: -0.05 };
    const r = fitText('one two three four five six seven eight nine ten eleven', style, { width: 300, height: 400 }, { lines: 6, shrink: 0.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.lines.forEach((line, i) => { expect(r.widths[i]).toBe(textWidth(line, style, r.size)); expect(r.widths[i]).toBeLessThanOrEqual(300 * 0.98); });
  });

  it('3: every form of emoji counts 1.25 em', () => {
    for (const e of ['😍', '🇹🇷', '1️⃣', '#️⃣', '👍🏽', '👩‍👩‍👧', '❤️', '©️', '™️', '🏳️‍🌈']) {
      expect(unknownGlyphs(e, 'Inter'), e).toEqual([]);
      expect(textWidth(e, P7, 40), e).toBeCloseTo(50, 9);
    }
    expect(textWidth('©', P7, 1000)).not.toBe(1250);
  });
  it('3: NFC, and the lines are the normalised text', () => {
    const r = fitText('Café Şehir', P7, BOX, { lines: 1, shrink: 0.5 });
    expect(r).toMatchObject({ ok: true, lines: ['Café Şehir'] });
  });
  it('3: a base letter with combining marks takes the base advance (i̇ from İ.toLowerCase())', () => {
    const dotted = 'İ'.toLowerCase();
    expect(unknownGlyphs(dotted, 'Inter')).toEqual([]);
    expect(textWidth(dotted, P7, 1000)).toBeCloseTo(textWidth('i', P7, 1000) as number, 9);
    expect(unknownGlyphs('x̣́', 'Montserrat')).toEqual([]);
  });
  it('3: zero-width characters are removed from the copy', () => {
    for (const z of ['​', '‌', '‍', '﻿', '⁠']) {
      const r = fitText(`ab${z}c d${z}`, P7, BOX, { lines: 1, shrink: 0.5 });
      expect(r, JSON.stringify(z)).toMatchObject({ ok: true, lines: ['abc d'] });
      expect(textWidth(`a${z}b`, P7, 36)).toBe(textWidth('ab', P7, 36));
    }
  });
  it('3: unknownGlyphs gives each unknown grapheme once, invisible and control ones as U+XXXX', () => {
    expect(unknownGlyphs('漢 漢 字 \u0007 \u0007 ‮ \u0085', 'Inter')).toEqual(['漢', '字', 'U+0007', 'U+202E', 'U+0085']);
    expect(unknownGlyphs('\u0007', 'Montserrat')).toEqual(['U+0007']);
  });

  it('4: text-too-long says why: word', () => {
    const r = fitText('Çekoslovakyalılaştıramadıklarımızdanmışsınız', P7, { width: 300, height: 400 }, { lines: 3, shrink: 0.5 });
    expect(r).toMatchObject({ ok: false, code: 'text-too-long', reason: 'word', smallest: 18, available: 294 });
    if (!r.ok && r.code === 'text-too-long') expect(r.needed).toBeGreaterThan(r.available);
  });
  it('4: text-too-long says why: lines', () => {
    const r = fitText('word '.repeat(30).trim(), P7, { width: 600, height: 2000 }, { lines: 2, shrink: 0.5 });
    expect(r).toMatchObject({ ok: false, code: 'text-too-long', reason: 'lines', smallest: 18, available: 2 });
    if (!r.ok && r.code === 'text-too-long') expect(r.needed).toBeGreaterThan(2);
  });
  it('4: text-too-long says why: height', () => {
    const r = fitText('Hello', P7, { width: 600, height: 10 }, { lines: 1, shrink: 0.5 });
    expect(r).toMatchObject({ ok: false, code: 'text-too-long', reason: 'height', smallest: 18, needed: 22, available: 10 });
  });

  it('5: garbage in gives sane numbers out', () => {
    const base = fitText('Hello world', { ...P7, weight: 400, leading: undefined }, BOX, { lines: 1, shrink: 0.5 });
    for (const leading of [NaN, 0, -1, Infinity]) {
      const r = fitText('Hello world', { ...P7, weight: 400, leading }, BOX, { lines: 1, shrink: 0.5 });
      expect(r).toEqual(base); roundTrips(r);
    }
    for (const weight of [NaN, Infinity]) {
      const r = fitText('Hello world', { ...P7, weight }, BOX, { lines: 1, shrink: 0.5 });
      expect(r).toEqual(fitText('Hello world', { ...P7, weight: 400 }, BOX, { lines: 1, shrink: 0.5 })); roundTrips(r);
    }
    for (const size of [NaN, 0, -5, Infinity]) {
      const r = fitText('Hello', { ...P7, size }, BOX, { lines: 1, shrink: 0.5 });
      expect(r).toMatchObject({ ok: false, code: 'text-too-long' }); roundTrips(r);
    }
    for (const width of [NaN, 0, -5, Infinity]) {
      const r = fitText('Hello', P7, { width, height: 100 }, { lines: 1, shrink: 0.5 });
      expect(r).toMatchObject({ ok: false, code: 'text-too-long' }); roundTrips(r);
      if (!r.ok && r.code === 'text-too-long') expect(r.needed).toBeGreaterThan(r.available);
    }
    for (const height of [NaN, 0, -5, Infinity]) {
      const r = fitText('Hello', P7, { width: 600, height }, { lines: 1, shrink: 0.5 });
      expect(r).toMatchObject({ ok: false, code: 'text-too-long' }); roundTrips(r);
    }
    for (const lines of [NaN, 0, -3, Infinity]) {
      const r = fitText('Hello world', P7, { width: 600, height: 400 }, { lines, shrink: 0.5 });
      expect(r).toEqual(fitText('Hello world', P7, { width: 600, height: 400 }, { lines: 1, shrink: 0.5 })); roundTrips(r);
    }
    for (const shrink of [NaN, -1, 2, Infinity]) {
      const r = fitText('Hello world', P7, BOX, { lines: 1, shrink });
      expect(r).toEqual(fitText('Hello world', P7, BOX, { lines: 1, shrink: 1 })); roundTrips(r);
    }
  });

  it('7: the table has no entry for ŉ in Inter (Inter has no glyph for it)', () => {
    expect(Object.hasOwn(metrics.Inter.advances, 'ŉ')).toBe(false);
    expect(Object.hasOwn(metrics.Montserrat.advances, 'ŉ')).toBe(true);      // Montserrat has the glyph
    expect(unknownGlyphs('ŉ', 'Inter')).toEqual(['ŉ']);
  });

  it('round 2 / 1: a combining mark on whitespace, at the start, or after a newline is an unknown glyph', () => {
    for (const copy of ['a \u0301 b', 'a\u00A0\u0301', '\u0301abc', 'abc\n\u0301def', 'a \u0301']) {
      const r = fitText(copy, P7, BOX, { lines: 3, shrink: 0.5 });
      expect(r, JSON.stringify(copy)).toMatchObject({ ok: false, code: 'text-glyph' });
      if (!r.ok && r.code === 'text-glyph') for (const c of r.characters) expect(c).toMatch(/U\+[0-9A-F]{4}/);
      expect(unknownGlyphs(copy, 'Inter').length, JSON.stringify(copy)).toBeGreaterThan(0);
    }
    expect(fitText('a\u0301 b', P7, BOX, { lines: 1, shrink: 0.5 })).toMatchObject({ ok: true });    // a mark on a letter is fine
  });
  it('round 2 / 2: a huge size returns (it is invalid, not a loop)', () => {
    for (const size of [1e17, 2001, 1e300]) {
      const r = fitText('Hello', { ...P7, size }, BOX, { lines: 1, shrink: 0.5 });
      expect(r, String(size)).toMatchObject({ ok: false, code: 'text-too-long', reason: 'height' });
    }
    expect(fitText('Hello', { ...P7, size: 2000 }, { width: 20000, height: 20000 }, { lines: 1, shrink: 1 })).toMatchObject({ ok: true, size: 2000 });
  });
  it('round 2 / 3: an invalid size still has needed > available in the unit of its reason; a size below 1 is invalid', () => {
    for (const size of [NaN, 0, -5, 0.5, 0.99, 1e17, 2001]) {
      for (const height of [100, 1e17, 0.3]) {
        const r = fitText('Hello', { ...P7, size }, { width: 600, height }, { lines: 1, shrink: 0.5 });
        expect(r, `${size} ${height}`).toMatchObject({ ok: false, code: 'text-too-long', reason: 'height' });
        if (!r.ok && r.code === 'text-too-long') { expect(r.needed).toBeGreaterThan(r.available); roundTrips(r); }
      }
    }
    expect(fitText('Hello', { ...P7, size: 1 }, BOX, { lines: 1, shrink: 1 })).toMatchObject({ ok: true, size: 1 });
  });
});
