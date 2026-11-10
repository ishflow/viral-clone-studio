import { describe, expect, it, vi } from 'vitest';
import { createTranslate, flatten } from '@/core/i18n/translate';
import en from '@/messages/en/common.json';
import tr from '@/messages/tr/common.json';
import { formatCredits, formatDate, formatDateTime, formatUsd, formatDuration, formatName, formatSecondsRange } from './format';

describe('format', () => {
  it('formatDuration', () => {
    const t = createTranslate('en', flatten({ common: en }));
    expect(formatDuration(13, t)).toBe('13 sec');
    expect(formatDuration(75, t)).toBe('1 min 15 sec');
    expect(formatDuration(60, t)).toBe('1 min');
    expect(formatDuration(0, t)).toBe('0 sec');
  });
  it('formatName: the name of a template format in the interface language', () => {
    expect(formatName('no-talking', createTranslate('en', flatten({ common: en })))).toBe('No talking');
    expect(formatName('talking', createTranslate('en', flatten({ common: en })))).toBe('Talking');
    expect(formatName('talking', createTranslate('tr', flatten({ common: tr })))).toBe(tr.format.talking);
  });
  it('formatDuration writes the units of the interface language', () => {
    const t = createTranslate('tr', flatten({ common: tr }));
    expect(formatDuration(13, t)).toBe('13 sn');
    expect(formatDuration(75, t)).toBe('1 dk 15 sn');
    expect(formatDuration(60, t)).toBe('1 dk');
  });
  it('formatSecondsRange: the time of a shot, with the unit of the interface language', () => {
    expect(formatSecondsRange(0, 1.3, createTranslate('en', flatten({ common: en })))).toBe('0.0–1.3 sec');
    expect(formatSecondsRange(1.3, 4, createTranslate('tr', flatten({ common: tr })))).toBe('1.3–4.0 sn');
  });
  it('formatCredits delegates to common.credits', () => {
    const t = vi.fn((k: string, p?: Record<string, string | number>) => `${k}:${p?.count}`);
    expect(formatCredits(12, t)).toBe('common.credits.count:12');
    expect(t).toHaveBeenCalledWith('common.credits.count', { count: 12 });
  });
  it('formatCredits works with the real translator and messages', () => {
    const t = createTranslate('en', flatten({ common: en }));
    expect(formatCredits(1, t)).toBe('1 credit');
    expect(formatCredits(12, t)).toBe('12 credits');
  });
  it('formatDate writes the UTC day, whatever the time zone of the server is', () => {
    expect(formatDate('2026-10-06T20:45:00Z', 'en')).toContain('Oct 6');
    expect(formatDate('2026-10-07T03:00:00Z', 'en')).toContain('Oct 7');
  });
  it('formatDate is locale aware and tolerates bad input', () => {
    expect(formatDate('2026-10-04T10:00:00Z', 'en')).toMatch(/2026/);
    expect(formatDate('2026-10-04T10:00:00Z', 'en')).not.toBe(formatDate('2026-10-04T10:00:00Z', 'tr'));
    expect(formatDate('nope', 'en')).toBe('');
  });
});

describe('formatDateTime and formatUsd', () => {
  it('formatDateTime shows the day and the time in UTC and tolerates bad input', () => {
    expect(formatDateTime('2026-10-04T14:32:00Z', 'en')).toMatch(/2026.*14:32/);
    expect(formatDateTime('nope', 'en')).toBe('');
  });
  it('formatUsd: whole dollars without cents, cents when there are some, null stays null', () => {
    expect(formatUsd(1900, 'en')).toBe('$19');
    expect(formatUsd(1950, 'en')).toBe('$19.50');
    expect(formatUsd(null, 'en')).toBeNull();
  });
});

it('rounds fractional durations and handles non-finite input', () => {
  const t = createTranslate('en', flatten({ common: en }));
  expect(formatDuration(20.433333333333334, t)).toBe('20 sec');
  expect(formatDuration(NaN, t)).toBe('0 sec');
});

it('source counters are compact, correctly labelled and absent when unknown', async () => {
  const { formatReference } = await import('./format');
  const t = createTranslate('en', flatten({ common: en }));
  expect(formatReference({ referenceMetric: { count: 155300, kind: 'likes' } }, t)).toBe('155.3K likes');
  expect(formatReference({ referenceMetric: { count: 1200, kind: 'views' } }, t)).toBe('1.2K views');
  expect(formatReference({ referenceViews: '' }, t)).toBe('');
  expect(formatReference({ referenceMetric: { count: 0, kind: 'likes' } }, t)).toBe('');
  expect(formatReference({ referenceMetric: { count: 1200, kind: 'likes' } }, createTranslate('tr', flatten({ common: tr })))).toBe('1.2K beğeni');
});
