// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { AdminUserRow } from '@/data/ports';
import { usersCsv } from './csv';

const row = (over: Partial<AdminUserRow['user']> = {}, rest: Partial<AdminUserRow> = {}): AdminUserRow => ({
  user: { id: 'u1', email: 'a@x.com', name: 'Ann, "A"', role: 'customer', emailVerified: true, blocked: false, freeVideoAvailable: false, locale: 'en', joinedAt: '2026-09-01T10:00:00Z', lastActiveAt: '2026-09-02T10:00:00Z', authProvider: 'password', pendingEmail: null, block: null, ...over },
  balance: 12, paidTotal: null, creditsSpent: 8, videos: 3, ...rest,
});

describe('usersCsv', () => {
  it('has email, name, joined, verified, balance, credits spent, videos, status and no money column', () => {
    const lines = usersCsv([row(), row({ email: 'b@x.com', blocked: true, emailVerified: false })]).trim().split('\r\n');
    expect(lines[0]).toBe('email,name,joined,verified,balance,credits_spent,videos,status');
    expect(lines[1]).toBe('a@x.com,"Ann, ""A""",2026-09-01,yes,12,8,3,active');
    expect(lines[2]).toContain('b@x.com');
    expect(lines[2]).toMatch(/,no,12,8,3,blocked$/);
  });
});
