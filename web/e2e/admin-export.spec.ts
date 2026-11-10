import { expect, test } from '@playwright/test';
import { sessionCookie } from './session';

const EXPORTS = ['/admin/users/export', '/admin/users/export?filter=paying&q=demo', '/admin/revenue/export', '/admin/revenue/export?period=all'];

for (const path of EXPORTS) {
  test(`${path}: 403 for a signed-out visitor and a customer, text/csv for the admin`, async ({ request }) => {
    const visitor = await request.get(path);
    expect(visitor.status()).toBe(403);
    const customer = await request.get(path, { headers: { cookie: `vc_session=${sessionCookie('usr-demo')}` } });
    expect(customer.status()).toBe(403);
    const admin = await request.get(path, { headers: { cookie: `vc_session=${sessionCookie('usr-admin')}` } });
    expect(admin.status()).toBe(200);
    expect(admin.headers()['content-type']).toContain('text/csv');
    expect(admin.headers()['content-disposition']).toContain('attachment');
    expect(await admin.text()).toMatch(/^(email|date),/);
  });
}
