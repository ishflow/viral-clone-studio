import { describe, expect, it } from 'vitest';
import { readLocale } from './locale';
import { loadMessages } from './messages';

describe('readLocale', () => {
  it('defaults to en', () => {
    expect(readLocale(undefined)).toBe('en');
    expect(readLocale('fr')).toBe('en');
  });
  it('accepts tr', () => expect(readLocale('tr')).toBe('tr'));
});

describe('loadMessages', () => {
  it('falls back to English for keys missing in Turkish', () => {
    const tr = loadMessages('tr');
    const en = loadMessages('en');
    expect(tr['common.quality.best']).toBe(en['common.quality.best']);
    expect(tr['common.nav.gallery']).toBe('Galeri');
    // every English key exists in the merged Turkish map
    for (const k of Object.keys(en)) expect(tr).toHaveProperty([k]);
  });
});
