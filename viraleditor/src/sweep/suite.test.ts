import { expect, it } from 'vitest';
import { wrongOf } from './suite.ts';
import type { Case } from './suite.ts';
it('a one-sided render defect still fails the sweep even when classified uneven', () => {
  const wrong = { kind: 'text-rest', frame: 46, element: 'blur-1', promise: 1, shows: 0.98 };
  const c = { analysis: { wrong: [wrong] }, second: { wrong: [] }, uneven: [wrong] } as unknown as Case;
  expect(wrongOf(c, 'text-rest')).toEqual([wrong]);
});
