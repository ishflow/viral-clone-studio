import type { EditIssue } from '../edit/types.ts';

/** What compose throws: every issue of the document at once (design §6). `code` is the first issue's code. */
export class ComposeError extends Error {
  code: string;
  issues: EditIssue[];
  constructor(issues: EditIssue[]) {
    const first = issues[0];
    super(first ? `${first.code}: ${first.message}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}` : 'the edit document is not valid');
    this.name = 'ComposeError';
    this.code = first?.code ?? 'schema';
    this.issues = issues;
  }
}
