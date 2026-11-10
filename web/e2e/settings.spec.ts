import { expect, test } from '@playwright/test';
import { header, resetStore, setCookies } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetStore(request);
});

test('language menu of the header: Türkçe turns the navigation Turkish and a reload keeps it', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { consent: 'necessary' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(header(page).getByRole('link', { name: 'Pricing' })).toBeVisible();

  await header(page).getByRole('button', { name: 'Language: English. Change' }).click();
  const menu = page.getByRole('menu', { name: 'Site language' });
  await expect(menu.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: 'Türkçe' }).click();

  const turkish = async () => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    const nav = header(page).getByRole('navigation', { name: 'Ana menü' });
    await expect(nav.getByRole('link')).toHaveText(['Galeri', 'Nasıl çalışır', 'Fiyatlar']);
    await expect(header(page).getByRole('link', { name: 'Giriş yap' })).toBeVisible();
    await expect(header(page).getByRole('button', { name: 'Dil: Türkçe. Değiştir' })).toHaveText('TR');
  };
  await turkish();
  await page.reload();
  await turkish();
  // Another page is Turkish too.
  await header(page).getByRole('link', { name: 'Fiyatlar' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('language row of the menu: Türkçe turns the menu Turkish', async ({ page, context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-demo' });
    await page.goto('/videos');
    await header(page).getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Main menu' });
    await expect(menu.getByRole('navigation').getByRole('link')).toHaveText(['Gallery', 'My videos', 'Pricing', 'Account']);
    await menu.getByRole('button', { name: 'Language: English. Change' }).click();
    await menu.getByRole('menuitemradio', { name: 'Türkçe' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Videolarım');
    await header(page).getByRole('button', { name: 'Menüyü aç' }).click();
    await expect(page.getByRole('dialog', { name: 'Ana menü' }).getByRole('navigation').getByRole('link')).toHaveText(['Galeri', 'Videolarım', 'Fiyatlar', 'Hesap']);
  });

  test('the language chosen in the menu is the one the Account form shows; saving the profile keeps it', async ({ page, context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-demo' });
    await page.goto('/account');
    await expect(page.getByLabel('Interface language')).toHaveValue('en');
    // Switch in the menu, with the Account page open.
    await header(page).getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Main menu' });
    await menu.getByRole('button', { name: 'Language: English. Change' }).click();
    await menu.getByRole('menuitemradio', { name: 'Türkçe' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await page.keyboard.press('Escape');

    // The form follows the site (the user record still says English), so Save does not flip the site back.
    await expect(page.getByLabel('Arayüz dili')).toHaveValue('tr');
    await page.getByLabel('Ad', { exact: true }).fill('Demo Kullanıcı');
    await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Kaydedildi.' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByLabel('Arayüz dili')).toHaveValue('tr');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hesap');
    await expect(page.getByLabel('Arayüz dili')).toHaveValue('tr');
    await expect(page.getByLabel('Ad', { exact: true })).toHaveValue('Demo Kullanıcı');
  });
});

test('Account → Interface language: Türkçe turns the site Turkish and a reload keeps it', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { session: 'usr-demo' });
  await page.goto('/account');
  await page.getByLabel('Interface language').selectOption({ label: 'Türkçe' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const turkish = async () => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hesap');
    await expect(header(page).getByRole('navigation', { name: 'Ana menü' }).getByRole('link')).toHaveText(['Galeri', 'Videolarım', 'Fiyatlar']);
    await expect(header(page)).toContainText('19 kredi');
    await expect(page.getByLabel('Arayüz dili')).toHaveValue('tr');
  };
  await turkish();
  await expect(page.getByRole('status').filter({ hasText: 'Kaydedildi.' })).toBeVisible();
  await page.reload();
  await turkish();
});

test('Account → Appearance: Light sets html[data-theme="light"], a reload keeps it, System removes it', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { session: 'usr-demo' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/account');
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();

  await page.getByLabel('Appearance').selectOption({ label: 'Light' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  // The select keeps the saved choice, so saving again (here: a new name) does not put the theme back.
  await expect(page.getByLabel('Appearance')).toHaveValue('light');
  await page.getByLabel('Name').fill('Demo User Two');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Demo User Two');
  await expect(html).toHaveAttribute('data-theme', 'light');
  const light = await background();
  expect(light).not.toBe(dark);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.getByLabel('Appearance')).toHaveValue('light');
  expect(await background()).toBe(light);
  // The choice follows the visitor to the public pages.
  await page.goto('/pricing');
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.goto('/account');
  await page.getByLabel('Appearance').selectOption({ label: 'System' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  expect(await background()).toBe(dark);
});

test('cookie notice: answered once, it stays away after a reload and on other pages', async ({ page }) => {
  await page.goto('/pricing');
  const notice = page.getByRole('region', { name: 'Cookie notice' });
  await expect(notice).toBeVisible();
  // Not answered: it is still there on the next page.
  await page.goto('/');
  await expect(notice).toBeVisible();

  await notice.getByRole('button', { name: 'Accept all' }).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(notice).toHaveCount(0);
  await page.goto('/gallery');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(notice).toHaveCount(0);
});
