// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv([['a', 'b,c', 'd"e', 'f\ng']])).toBe('a,"b,c","d""e","f\ng"\r\n');
  });
  it('defuses cells a spreadsheet would run as a formula', () => {
    expect(toCsv([['=SUM(A1)', '+1', '-1', '@x', 'ok']])).toBe("'=SUM(A1),'+1,'-1,'@x,ok\r\n");
  });
});
