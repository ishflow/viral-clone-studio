import { formatDuration } from '@/shared/lib/format';
import type { Translate } from '@/core/i18n/types';
import type { PreparationNote, ScanStopReason, TemplateStatus } from '@/data/ports';

// The codes with a message of their own; any other code gets the generic line.
const SCAN_REASONS: readonly string[] = ['source-unavailable', 'scan-failed', 'no-matching-industry'] satisfies readonly ScanStopReason[];
const NOTES: readonly string[] = [
  'below-threshold', 'unsupported', 'split-screen', 'too-long', 'bad-range', 'check-failed', 'source-unavailable', 'llm-invalid', 'daily-cap',
] satisfies readonly PreparationNote[];

export const statusLabel = (t: Translate, status: TemplateStatus) => t(`adminTemplates.status.${status}`);
export const reasonLabel = (t: Translate, code: ScanStopReason | null) =>
  t(code !== null && SCAN_REASONS.includes(code) ? `adminTemplates.reason.${code}` : 'adminTemplates.reason.generic');
/** Why a template was not prepared, or an edit was not taken over. */
export const noteLabel = (t: Translate, code: PreparationNote | null) =>
  t(code !== null && NOTES.includes(code) ? `adminTemplates.preparation.note.${code}` : 'adminTemplates.preparation.note.generic');
export const secLabel = (t: Translate, seconds: number) => formatDuration(seconds, t);
