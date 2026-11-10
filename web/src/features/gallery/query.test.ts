// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Template } from '@/data/ports';
import { galleryHref, parseGalleryQuery, sortTemplates } from './query';

const cats = ['Lashes', 'Hair'];

describe('parseGalleryQuery', () => {
  it('reads q, category, format and sort; unknown values fall back to the defaults', () => {
    expect(parseGalleryQuery({ q: ' pet ', category: 'Hair', format: 'talking', sort: 'used' }, cats)).toEqual({
      q: 'pet', category: 'Hair', format: 'talking', sort: 'used',
    });
    expect(parseGalleryQuery({ category: 'Nope', format: 'x', sort: 'y' }, cats)).toEqual({ q: '', category: '', format: '', sort: 'newest' });
    expect(parseGalleryQuery({ q: ['a', 'b'] }, cats).q).toBe('a');
  });
});

describe('galleryHref', () => {
  const base = { q: '', category: '', format: '' as const, sort: 'newest' as const };
  it('is /gallery with no filters and keeps the others when one changes', () => {
    expect(galleryHref(base, {})).toBe('/gallery');
    expect(galleryHref({ ...base, q: 'pet food', format: 'talking' }, { category: 'Hair' })).toBe(
      '/gallery?q=pet+food&category=Hair&format=talking',
    );
    expect(galleryHref({ ...base, category: 'Hair', sort: 'used' }, { category: '' })).toBe('/gallery?sort=used');
    expect(galleryHref({ ...base, q: 'pet' }, { q: '' })).toBe('/gallery');
  });
});

describe('sortTemplates', () => {
  const make = (id: string, editedAt: string, timesGenerated: number) => ({ id, editedAt, timesGenerated }) as Template;
  const list = [make('a', '2026-01-01', 5), make('b', '2026-03-01', 1), make('c', '2026-02-01', 9)];
  it('newest sorts by editedAt, most used by timesGenerated, without changing the input', () => {
    expect(sortTemplates(list, 'newest').map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(sortTemplates(list, 'used').map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(list.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});
