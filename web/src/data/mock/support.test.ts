import { beforeEach, describe, expect, it } from 'vitest';
import { data } from '@/data';
import { resetStore } from './store';

beforeEach(() => resetStore());

describe('the support desk limits an account (N2)', () => {
  const mail = { topic: 'video' as const, email: 'a@b.co', message: 'Something went wrong.', userId: 'usr-demo' };

  it('an account sends only so many messages a day; the same key again still answers with the first reference', async () => {
    const first = await data.support.send({ ...mail, key: 'k-0' });
    for (let i = 1; i < 20; i++) await data.support.send({ ...mail, key: `k-${i}` });
    await expect(data.support.send({ ...mail, key: 'k-20' })).rejects.toThrow('support-full');
    expect(await data.support.send({ ...mail, key: 'k-0' })).toEqual({ reference: first.reference, duplicate: true });
  });
  it('the limit is the account\'s own: another account still sends', async () => {
    for (let i = 0; i < 20; i++) await data.support.send({ ...mail, key: `k-${i}` });
    await expect(data.support.send({ ...mail, userId: 'usr-other', key: 'k-0' })).resolves.toMatchObject({ duplicate: false });
  });
});
