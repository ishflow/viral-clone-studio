// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as entry from './index';

describe('the public entry of the data layer', () => {
  it('exports `data` and nothing else: a feature reaches the engine through a port, never directly', () => {
    expect(Object.keys(entry)).toEqual(['data']);
  });
});
