// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashPassword, hashPasswordSync, verifyPassword } from './password';

describe('password hashes', () => {
  it('verify the password they were made from, and nothing else', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterx', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('are salted per hash: the same password gives two different strings', async () => {
    const [one, two] = [await hashPassword('same password'), await hashPassword('same password')];
    expect(one).not.toBe(two);
    expect(await verifyPassword('same password', one)).toBe(true);
    expect(await verifyPassword('same password', two)).toBe(true);
  });

  it('carry the parameters and never the password', async () => {
    const hash = await hashPassword('plain-text-secret');
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(hash).not.toContain('plain-text-secret');
  });

  it('the sync form (used to seed the fixtures) makes the same kind of hash', async () => {
    expect(await verifyPassword('seed password', hashPasswordSync('seed password'))).toBe(true);
  });

  it('a malformed stored value verifies nothing and does not throw', async () => {
    for (const bad of ['', 'x', 'scrypt$1$2$3$a$b', 'bcrypt$1$2$3$a$b', 'scrypt$16384$8$1$$']) expect(await verifyPassword('anything', bad)).toBe(false);
  });
});
