// compose parses the document once: validate runs on the parsed copy, not on a second parse of it (review C7a, M9).
import { describe, expect, it, vi } from 'vitest';
import { parseEdit } from '../edit/schema.ts';
import { shortEdit, shortFacts } from './fixture.ts';
import { compose } from './index.ts';

vi.mock('../edit/schema.ts', async (original) => {
  const schema = await original<typeof import('../edit/schema.ts')>();
  return { ...schema, parseEdit: vi.fn(schema.parseEdit) };
});

describe('compose: one parse of the document', () => {
  it('calls parseEdit once, and refuses a document that does not parse as before', () => {
    vi.mocked(parseEdit).mockClear();
    compose(shortEdit(), shortFacts());
    expect(parseEdit).toHaveBeenCalledTimes(1);
    vi.mocked(parseEdit).mockClear();
    expect(() => compose({ ...shortEdit(), version: 2 } as never, shortFacts())).toThrow();
    expect(parseEdit).toHaveBeenCalledTimes(1);
  });
});
