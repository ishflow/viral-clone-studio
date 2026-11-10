// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { sign, verify } from './signature';
it('authenticates id, time and exact bytes; rejects missing, stale, future, wrong and rewritten signatures', () => {
  const secret=randomBytes(32).toString('hex'), raw='{ "value": 1 }', time=Date.now();
  const headers=new Headers({'webhook-id':'evt-1','webhook-timestamp':String(Math.floor(time/1000))});
  headers.set('webhook-signature',sign(raw,headers,secret));
  expect(verify(raw,headers,secret,time)).toBe(true);
  expect(verify(JSON.stringify(JSON.parse(raw)),headers,secret,time)).toBe(false);
  expect(verify(raw,headers,randomBytes(32).toString('hex'),time)).toBe(false);
  expect(verify(raw,headers,secret,time+301000)).toBe(false);
  expect(verify(raw,headers,secret,time-301000)).toBe(false);
  expect(verify(raw,new Headers(),secret,time)).toBe(false);
});
