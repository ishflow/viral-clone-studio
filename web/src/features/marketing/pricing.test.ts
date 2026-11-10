import { describe, expect, it } from 'vitest';
import { VISITOR_BUY_HREF } from './pricing';

describe('VISITOR_BUY_HREF', () => {
  it('sends a visitor to sign up and back to pricing', () => {
    expect(VISITOR_BUY_HREF).toBe('/signup?next=%2Fpricing');
  });
});
