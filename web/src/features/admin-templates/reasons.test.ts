// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/core/i18n/messages';
import { createTranslate } from '@/core/i18n/translate';
import type { PreparationNote, ScanStopReason } from '@/data/ports';
import { noteLabel, reasonLabel } from './labels';

// Every code of the unions, checked by the compiler: a new code without an entry here does not typecheck.
const NOTES = Object.keys({
  'below-threshold': 1, unsupported: 1, 'split-screen': 1, 'too-long': 1, 'bad-range': 1, 'check-failed': 1, 'source-unavailable': 1, 'llm-invalid': 1, 'daily-cap': 1,
} satisfies Record<PreparationNote, 1>) as PreparationNote[];
const SCAN_REASONS = Object.keys({ 'source-unavailable': 1, 'scan-failed': 1, 'no-matching-industry': 1 } satisfies Record<ScanStopReason, 1>) as ScanStopReason[];

describe.each(['en', 'tr'] as const)('reason messages in %s', (locale) => {
  const messages = loadMessages(locale);
  const t = createTranslate(locale, messages);

  it('every PreparationNote code has its own message', () => {
    for (const code of NOTES) {
      expect(messages[`adminTemplates.preparation.note.${code}`], code).toBeTruthy();
      expect(noteLabel(t, code)).toBe(messages[`adminTemplates.preparation.note.${code}`]);
    }
    expect(noteLabel(t, null)).toBe(messages['adminTemplates.preparation.note.generic']);
  });

  it('every ScanStopReason code has its own message', () => {
    for (const code of SCAN_REASONS) {
      expect(messages[`adminTemplates.reason.${code}`], code).toBeTruthy();
      expect(reasonLabel(t, code)).toBe(messages[`adminTemplates.reason.${code}`]);
    }
    expect(reasonLabel(t, null)).toBe(messages['adminTemplates.reason.generic']);
  });
});
