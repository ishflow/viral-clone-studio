// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { callerBucket } from './caller-bucket';

describe('callerBucket', () => {
  it('an IPv4 address is its own bucket', () => {
    expect(callerBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(callerBucket(' 203.0.113.7 ')).toBe('203.0.113.7');
  });
  it('an IPv6 caller is its /64: the rest of the address is the caller\'s to change', () => {
    const home = callerBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(callerBucket('2001:db8:1:2::1')).toBe(home);
    expect(callerBucket('2001:0DB8:0001:0002:ffff::9')).toBe(home);
    expect(callerBucket('2001:db8:1:3::1')).not.toBe(home);
    expect(callerBucket('2001:db8::1')).toBe(callerBucket('2001:db8:0:0:5::'));
    expect(callerBucket('2001:db8::1')).not.toBe(callerBucket('2001:db8:0:1::1'));
    expect(callerBucket('::1')).toBe(callerBucket('::2'));
  });
  it('what is not one address is no caller: empty, a list, a name, a made-up word', () => {
    for (const value of ['', ' ', '1.2.3.4, 5.6.7.8', '1.2.3.4,5.6.7.8', 'example.com', 'local', '1.2.3', '2001:db8::1 FROM x', undefined, null]) expect(callerBucket(value), String(value)).toBeNull();
  });
});
