import { describe, expect, it } from 'vitest';
import { summary } from './index.ts';
import type { QualityIssue } from './issue.ts';

const issue = (severity: 'error' | 'warning'): QualityIssue => ({ code: 'x', severity, message: 'm', fix: 'f', at: null, target: null });

describe('summary', () => {
  it('ok when there is no error; warnings do not count against it', () => {
    expect(summary([])).toEqual({ ok: true, errors: 0, warnings: 0 });
    expect(summary([issue('warning'), issue('warning')])).toEqual({ ok: true, errors: 0, warnings: 2 });
    expect(summary([issue('warning'), issue('error')])).toEqual({ ok: false, errors: 1, warnings: 1 });
  });
});
