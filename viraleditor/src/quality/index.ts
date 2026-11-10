import type { QualityIssue } from './issue.ts';

export type { QualityIssue } from './issue.ts';
export { checkInputs } from './inputs.ts';
export { checkOutput } from './output.ts';

/** `ok` is true when no issue is an error; warnings do not stop a video. */
export function summary(issues: QualityIssue[]): { ok: boolean; errors: number; warnings: number } {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ok: errors === 0, errors, warnings: issues.length - errors };
}
