import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropAllDrafts, dropDraft, readDraft, writeDraft } from './session-draft';

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('session draft', () => {
  it('what is written is read back; a dropped draft reads as null', () => {
    writeDraft('k', { name: 'Oil', n: [1, 2] });
    expect(readDraft('k')).toEqual({ name: 'Oil', n: [1, 2] });
    expect(readDraft('other')).toBeNull();
    dropDraft('k');
    expect(readDraft('k')).toBeNull();
  });

  it('dropAllDrafts removes every form kept for a person (vc:draft:…) and nothing else', () => {
    writeDraft('vc:draft:generate:usr-1:tpl-a', { a: 1 });
    writeDraft('vc:draft:add-video:usr-1', { link: 'x' });
    window.sessionStorage.setItem('theme', 'dark');
    dropAllDrafts();
    expect(readDraft('vc:draft:generate:usr-1:tpl-a')).toBeNull();
    expect(readDraft('vc:draft:add-video:usr-1')).toBeNull();
    expect(window.sessionStorage.getItem('theme')).toBe('dark');
  });

  it('a broken value reads as null', () => {
    window.sessionStorage.setItem('k', '{not json');
    expect(readDraft('k')).toBeNull();
  });

  it('a storage that throws never throws to the caller', () => {
    const boom = () => { throw new Error('denied'); };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    expect(readDraft('k')).toBeNull();
    expect(() => writeDraft('k', { a: 1 })).not.toThrow();
    expect(() => dropDraft('k')).not.toThrow();
    expect(() => dropAllDrafts()).not.toThrow();
  });

  it('a value that cannot be turned into text is not kept and does not throw', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => writeDraft('k', loop)).not.toThrow();
    expect(readDraft('k')).toBeNull();
  });
});
