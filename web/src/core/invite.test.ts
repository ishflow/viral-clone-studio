// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invited, inviteOnly } from './invite';

afterEach(() => vi.unstubAllEnvs());
const realMail = (allow: string) => {
  for (const [name, value] of Object.entries({ VC_MAIL: 'resend', RESEND_API_KEY: 'test-placeholder', MAIL_FROM: 'no-reply@ishflow.com', VC_MAIL_ALLOW: allow })) vi.stubEnv(name, value);
};

describe('invite mode: with real mail the list of VC_MAIL_ALLOW is the guest list', () => {
  it('a list of addresses: only they are invited, whatever the capitals', () => {
    realMail('guest@example.com, second@example.org');
    expect(inviteOnly()).toBe(true);
    expect(invited('guest@example.com')).toBe(true);
    expect(invited('Guest@Example.COM')).toBe(true);
    expect(invited('stranger@example.com')).toBe(false);
    expect(invited('guest@example.com.evil.test')).toBe(false);
  });
  it('a domain on the list invites its addresses and nobody else', () => {
    realMail('example.org');
    expect(inviteOnly()).toBe(true);
    expect(invited('anyone@example.org')).toBe(true);
    expect(invited('anyone@sub.example.org')).toBe(false);
  });
  it('`*` invites everyone: not invite mode', () => {
    realMail('*');
    expect(inviteOnly()).toBe(false);
    expect(invited('stranger@example.com')).toBe(true);
  });
  it('without real mail (the demo, the tests) there is no list: sign-up is open', () => {
    vi.stubEnv('VC_MAIL_ALLOW', 'guest@example.com');
    for (const mode of ['fake', undefined]) {
      vi.stubEnv('VC_MAIL', mode as string);
      expect(inviteOnly(), String(mode)).toBe(false);
      expect(invited('stranger@example.com'), String(mode)).toBe(true);
    }
  });
});
