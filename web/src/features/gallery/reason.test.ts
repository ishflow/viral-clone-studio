// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/core/i18n/messages';
import { reasonKey } from './reason';

describe.each(['en', 'tr'] as const)('what the customer reads when a preparation failed, in %s', (locale) => {
  const messages = loadMessages(locale);
  it.each(['split-screen', 'bad-range', 'too-long', 'source-unavailable'])('%s has its own message, not the generic one', (code) => {
    expect(reasonKey(code)).toBe(`gallery.reason.${code}`);
    expect(messages[reasonKey(code)]).toBeTruthy();
    expect(messages[reasonKey(code)]).not.toBe(messages['gallery.reason.unknown']);
  });
  it('too-long names both limits and does not claim that no part was picked: a part of a video over 5 minutes is refused with it too', () => {
    const text = messages[reasonKey('too-long')]!;
    expect(text).toContain('60');
    expect(text).toContain(locale === 'en' ? '5 minutes' : '5 dakika');
    expect(text).not.toContain(locale === 'en' ? 'no part was picked' : 'bölüm seçilmemişti');
  });
  it('source-unavailable says the link could not be opened and that the credit was returned, not that the video has no usable structure', () => {
    const text = messages[reasonKey('source-unavailable')]!;
    expect(text).toContain(locale === 'en' ? 'could not open this link' : 'bağlantıyı açamadık');
    expect(text).toContain(locale === 'en' ? 'credit was returned' : 'iade edildi');
  });
  it('an unknown or missing code gets the generic line', () => {
    expect(reasonKey('nope')).toBe('gallery.reason.unknown');
    expect(reasonKey(null)).toBe('gallery.reason.unknown');
  });
});
