import { expect, it } from 'vitest';
import { dodoAddress } from './dodo-address';

it('an address of more than 2000 characters is not kept: the longest one that is kept has 2000', () => {
  const start = 'https://test.dodopayments.com/';
  expect(dodoAddress(start + 'i'.repeat(2000 - start.length))).toHaveLength(2000);
  expect(dodoAddress(start + 'i'.repeat(2001 - start.length))).toBeNull();
});
