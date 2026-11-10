import path from 'node:path';
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { sessionCookie } from './session';

/** Small product photos for the generate form. */
export const IMAGE_1 = path.join(__dirname, 'fixtures', 'product-1.png');
export const IMAGE_2 = path.join(__dirname, 'fixtures', 'product-2.png');

/**
 * The fake store starts again from the fixtures (dev-only route).
 * The specs wait about 20 seconds for a job: the server must run the fake time at 20× or faster (`VC_FAKE_SPEED=20`, set by playwright.config.ts
 * for the server it starts itself).
 */
export async function resetStore(request: APIRequestContext): Promise<void> {
  const response = await request.post('/dev/reset');
  expect(response.status(), 'POST /dev/reset').toBe(200);
  const { speed } = (await response.json()) as { speed: number };
  expect(speed, 'The server on this port runs without VC_FAKE_SPEED=20. Stop it (pnpm e2e starts its own), or start it with VC_FAKE_SPEED=20 pnpm dev -p 3100.').toBeGreaterThanOrEqual(20);
}

export interface Cookies { session?: string; theme?: 'dark' | 'light'; locale?: 'en' | 'tr'; consent?: 'all' | 'necessary' }

/** Sets the cookies the site reads: who is signed in (a fixture user id, signed here like the site signs it), the theme, the language, the answer to the cookie notice. */
export async function setCookies(context: BrowserContext, baseURL: string | undefined, { session, theme, locale, consent }: Cookies): Promise<void> {
  const url = baseURL ?? 'http://localhost:3100';
  const pairs: [string, string | undefined][] = [['vc_session', session ? sessionCookie(session) : undefined], ['vc_theme', theme], ['vc_locale', locale], ['vc_cookies', consent]];
  await context.addCookies(pairs.flatMap(([name, value]) => (value ? [{ name, value, url }] : [])));
}

/** The header that is on screen (the page holds a desktop and a phone header; one of them is hidden). */
export const header = (page: Page) => page.locator('header:visible').first();

/** Fills product `n` (1-based) of the generate form: a name and one image. */
export async function fillProduct(page: Page, n: number, name: string, image: string): Promise<void> {
  const block = page.getByRole('group', { name: `Product ${n}`, exact: true });
  await block.getByLabel('Product name').fill(name);
  await block.getByLabel('Add image').setInputFiles(image);
  await expect(block.getByAltText('Uploaded product image')).toHaveCount(1);
}

/** The credit activity card of the Account page. */
export const creditActivity = (page: Page) => page.getByRole('region', { name: 'Credit activity' });

/** A photograph made in the page (a plain canvas): the browser reads its real size, as it does a customer's. */
export async function photo(page: Page, name: string, width: number, height: number) {
  const base64 = await page.evaluate(([w, h]) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#b08968';
    context.fillRect(0, 0, w!, h!);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }, [width, height]);
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}
