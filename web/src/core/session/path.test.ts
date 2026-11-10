import { describe, expect, it } from 'vitest';
import { pathFromRequest } from './path';

describe('pathFromRequest', () => {
  it('keeps path and query, drops origin and hash', () => {
    expect(pathFromRequest('http://localhost:3100/account?tab=x#top')).toBe('/account?tab=x');
    expect(pathFromRequest('/videos')).toBe('/videos');
    expect(pathFromRequest('https://a.b/')).toBe('/');
  });
});
