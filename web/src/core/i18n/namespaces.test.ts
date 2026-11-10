import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGISTERED_NAMESPACES } from './messages';

const files = (l: string) =>
  readdirSync(join(__dirname, '../../messages', l))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort();

describe('message namespaces', () => {
  it('en and tr have the same files', () => {
    expect(files('tr')).toEqual(files('en'));
  });
  it('every message file on disk is registered, in both locales', () => {
    expect(REGISTERED_NAMESPACES('en')).toEqual(files('en'));
    expect(REGISTERED_NAMESPACES('tr')).toEqual(files('tr'));
  });
});
