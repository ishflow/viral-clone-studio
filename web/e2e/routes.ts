import type { Page } from '@playwright/test';
import { IMAGE_1 } from './helpers';

export type Width = 1440 | 390;
export type Session = 'usr-demo' | 'usr-new' | 'usr-paying' | 'usr-unverified' | 'usr-admin';

/** One screen of the sweep: a route of spec §3 (or a state of it), the fixture session it needs and the canvas board it belongs to. */
export interface Route {
  /** File name stem of the screenshots. */
  name: string;
  path: string;
  /** Canvas board(s) of this screen. */
  board: string;
  /** Which contact sheet: customer + visitor pages, or the admin panel. */
  group: 'site' | 'admin';
  session?: Session;
  /** The cookie notice is answered unless this is false. */
  consent?: false;
  /** HTTP status of the document (default 200). */
  status?: number;
  /** Only at this width (a phone-only or desktop-only screen). */
  only?: Width;
  /**
   * Brings the page into a state the address cannot reach (opens a dialog, shows the form errors).
   * A few routes write to the fake store (`checkout-provider` opens a checkout, the two `…-long-name` routes start a job); the sweep resets the store before every route.
   */
  act?: (page: Page) => Promise<void>;
  /** 'viewport': the shot is the window, not the whole page (an open dialog or menu covers the window, not the page). */
  shot?: 'viewport';
}

const generate = (page: Page) => page.getByRole('button', { name: /^(Generate|Üret)$/ });

/** Review Focus 6 of the plan: a product name of 60 characters, with nowhere to break. */
const LONG_PRODUCT_NAME = 'Overnightrepairhairandscalpserumwithrosemaryandbiotinnumber5';

async function fillOneProduct(page: Page, name = 'Lashly Eyelash Serum'): Promise<void> {
  await page.locator('fieldset').first().locator('input[type="text"]').first().fill(name);
  await page.locator('fieldset').first().locator('input[type="file"]').setInputFiles(IMAGE_1);
}

/** Starts a job whose product has the 60-character name (on the generate form of a one-product template) and waits for its result page. */
async function generateWithLongName(page: Page): Promise<void> {
  await fillOneProduct(page, LONG_PRODUCT_NAME);
  await generate(page).click();
  await page.getByRole('dialog').locator('button[type="submit"]').click();
  await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
  await page.locator('dd', { hasText: LONG_PRODUCT_NAME }).waitFor({ timeout: 30_000 });
}

const VISITOR: Route[] = [
  { name: 'home', path: '/', board: 'A-Ana-Sayfa', group: 'site' },
  { name: 'home-cookie-notice', path: '/', board: 'A-Cerez', group: 'site', consent: false, shot: 'viewport' },
  {
    name: 'home-language-menu', path: '/', board: 'A-Dil-Menusu', group: 'site', only: 1440, shot: 'viewport',
    act: async (page) => {
      await page.locator('header:visible button[aria-haspopup="menu"]').click();
      await page.getByRole('menu').waitFor();
    },
  },
  {
    name: 'menu-visitor', path: '/', board: 'A-Menu-Ziyaretci-M', group: 'site', only: 390, shot: 'viewport',
    act: async (page) => {
      await page.locator('header:visible button[aria-haspopup="dialog"]').click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { name: 'pricing', path: '/pricing', board: 'A-Fiyatlar', group: 'site' },
  { name: 'login', path: '/login', board: 'A-Giris', group: 'site' },
  { name: 'signup', path: '/signup', board: 'A-Giris', group: 'site' },
  { name: 'legal-terms', path: '/legal/terms', board: 'A-Yasal', group: 'site' },
  { name: 'legal-privacy', path: '/legal/privacy', board: 'A-Yasal', group: 'site' },
  { name: 'legal-refunds', path: '/legal/refunds', board: 'A-Yasal', group: 'site' },
  { name: 'legal-content', path: '/legal/content', board: 'A-Yasal', group: 'site' },
  { name: 'contact', path: '/contact', board: 'A-Iletisim', group: 'site' },
  { name: 'not-found', path: '/no-such-page', board: 'A-404', group: 'site', status: 404 },
  { name: 'verify-email', path: '/verify-email', board: 'A-Eposta-Dogrula', group: 'site', session: 'usr-unverified' },
  { name: 'welcome', path: '/welcome', board: 'A-Karsilama', group: 'site', session: 'usr-new' },
  { name: 'forgot-password', path: '/forgot-password', board: 'A-Sifre-Unuttum', group: 'site' },
  { name: 'forgot-password-sent', path: '/forgot-password/sent?email=demo%40viralclone.app', board: 'A-Sifre-Gonderildi', group: 'site' },
  {
    // The reset link carries a single-use token: the fake outbox has it. The sweep takes the link of the newest reset email and asks for
    // one only when there is none (a reset link is limited to 3 per address in 10 minutes, and the sweep opens this page six times).
    name: 'reset-password', path: '/dev/emails', board: 'A-Sifre-Yeni', group: 'site',
    act: async (page) => {
      const mail = () => page.getByRole('listitem').filter({ hasText: 'demo@viralclone.app' }).filter({ hasText: /^reset/ }).getByRole('link', { name: 'Preview' });
      if ((await mail().count()) === 0) {
        await page.goto('/forgot-password');
        await page.locator('input[name="email"]').fill('demo@viralclone.app');
        await page.locator('form button[type="submit"]').click();
        await page.waitForURL(/\/forgot-password\/sent/);
        await page.goto('/dev/emails');
      }
      await mail().first().click();
      const href = await page.locator('a[href^="/reset-password?token="]').first().getAttribute('href');
      await page.goto(href ?? '/reset-password');
      await page.locator('input[name="repeat"]').waitFor();
    },
  },
  { name: 'reset-password-invalid', path: '/reset-password/invalid', board: 'A-Sifre-Baglanti-Gecersiz', group: 'site' },
  { name: 'verify-link-expired', path: '/verify-email/expired', board: 'A-Baglanti-Gecersiz', group: 'site' },
  { name: 'verify-link-used', path: '/verify-email/expired?state=used', board: 'A-Baglanti-Gecersiz', group: 'site' },
  { name: 'blocked', path: '/blocked', board: 'A-Hesap-Engelli', group: 'site' },
  { name: 'login-session-ended', path: '/login?reason=expired', board: 'A-Oturum-Bitti', group: 'site' },
  {
    name: 'login-wrong-password', path: '/login', board: 'A-Giris-Durumlar', group: 'site',
    act: async (page) => {
      await page.locator('input[name="email"]').fill('demo@viralclone.app');
      await page.locator('input[name="password"]').fill('not-the-password');
      await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
      await page.getByRole('alert').first().waitFor();
    },
  },
  {
    name: 'signup-empty', path: '/signup', board: 'A-Giris-Durumlar', group: 'site',
    act: async (page) => {
      await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
      await page.getByRole('alert').first().waitFor();
    },
  },
  {
    name: 'signup-email-taken', path: '/signup', board: 'A-Giris-Durumlar', group: 'site',
    act: async (page) => {
      await page.locator('input[name="email"]').fill('demo@viralclone.app');
      await page.locator('input[name="password"]').fill('a-long-password');
      await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
      await page.getByRole('alert').first().waitFor();
    },
  },
  { name: 'contact-payment', path: '/contact?topic=payment', board: 'A-Iletisim', group: 'site' },
  {
    name: 'contact-sent', path: '/contact', board: 'A-Iletisim-Durumlar', group: 'site',
    act: async (page) => {
      await page.locator('input[name="email"]').fill('visitor@example.com');
      await page.locator('textarea[name="message"]').fill(`A question about my order (${Date.now()}).`);
      await page.locator('form button[type="submit"]').last().click();
      await page.getByRole('status').first().waitFor();
    },
  },
  { name: 'gallery-visitor', path: '/gallery', board: 'Main', group: 'site' },
  { name: 'template-visitor', path: '/templates/tpl-layering', board: 'A-Detay', group: 'site' },
];

const CUSTOMER: Route[] = [
  { name: 'gallery', path: '/gallery', board: 'Main', group: 'site', session: 'usr-demo' },
  { name: 'gallery-loading', path: '/dev/gallery-check/loading', board: 'A-Galeri-Yukleniyor', group: 'site', session: 'usr-demo' },
  { name: 'gallery-no-results', path: '/gallery?q=zzz', board: 'A-Galeri-Sonuc-Yok', group: 'site', session: 'usr-demo' },
  { name: 'gallery-filtered', path: '/gallery?category=Hair&format=no-talking&sort=used', board: 'Main', group: 'site', session: 'usr-demo' },
  { name: 'template', path: '/templates/tpl-layering', board: 'A-Detay', group: 'site', session: 'usr-demo' },
  {
    name: 'template-player', path: '/templates/tpl-layering', board: 'A-Oynatici', group: 'site', session: 'usr-demo', shot: 'viewport',
    act: async (page) => {
      await page.locator('figure button').first().click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { name: 'template-own', path: '/templates/tpl-own-ready', board: 'A-Detay-Ozel', group: 'site', session: 'usr-demo' },
  // Review Focus 6: a 60-character title with nowhere to break must wrap, not push the page sideways.
  { name: 'template-long-title', path: '/dev/gallery-check/long-title', board: 'A-Detay (60-character title)', group: 'site', session: 'usr-demo' },
  { name: 'template-new', path: '/templates/new', board: 'A-Video-Ekle', group: 'site', session: 'usr-demo' },
  { name: 'generate', path: '/templates/tpl-layering/generate', board: 'A-Form', group: 'site', session: 'usr-demo' },
  {
    name: 'generate-errors', path: '/templates/tpl-layering/generate', board: 'A-Form-Hata', group: 'site', session: 'usr-demo',
    act: async (page) => {
      await generate(page).click();
      await page.getByRole('alert').first().waitFor();
    },
  },
  {
    name: 'generate-confirm', path: '/templates/tpl-eye/generate', board: 'A-Onay', group: 'site', session: 'usr-demo', shot: 'viewport',
    act: async (page) => {
      await fillOneProduct(page);
      await generate(page).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    name: 'generate-not-enough', path: '/templates/tpl-eye/generate', board: 'A-Onay-Yetersiz', group: 'site', session: 'usr-demo', shot: 'viewport',
    act: async (page) => {
      await fillOneProduct(page);
      await page.locator('button[aria-pressed]').nth(1).click(); // Best
      await page.locator('button[aria-pressed]').nth(4).click(); // 3 variants
      await generate(page).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { name: 'job-running', path: '/jobs/job-demo-running', board: 'A-Is-Takibi', group: 'site', session: 'usr-demo' },
  { name: 'job-stopped', path: '/jobs/job-demo-stopped', board: 'A-Is-Durdu', group: 'site', session: 'usr-demo' },
  {
    // Both options of a stopped job ask before they spend: what is generated, the cost, the balance.
    name: 'job-stopped-confirm', path: '/jobs/job-demo-stopped', board: '(not on the canvas: confirmation before a stopped job goes on)', group: 'site', session: 'usr-demo', shot: 'viewport',
    act: async (page) => {
      await page.locator('main section button[type="button"]').first().click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { name: 'job-done', path: '/jobs/job-demo-story', board: 'A-Sonuc', group: 'site', session: 'usr-demo' },
  { name: 'job-done-variants', path: '/jobs/job-paying-shower', board: 'A-Sonuc-Varyant', group: 'site', session: 'usr-paying' },
  {
    // Review Focus 6: the result page prints the product names; a 60-character one must wrap.
    name: 'job-done-long-name', path: '/templates/tpl-eye/generate', board: 'A-Sonuc (60-character product name)', group: 'site', session: 'usr-paying',
    act: generateWithLongName,
  },
  {
    // The same job in the list of My videos.
    name: 'videos-long-name', path: '/templates/tpl-eye/generate', board: 'A-Uretimlerim (60-character product name)', group: 'site', session: 'usr-paying',
    act: async (page) => {
      await generateWithLongName(page);
      await page.goto('/videos');
      await page.getByText(LONG_PRODUCT_NAME).first().waitFor();
    },
  },
  { name: 'compare', path: '/jobs/job-demo-story/compare', board: 'A-Karsilastir', group: 'site', session: 'usr-demo' },
  { name: 'videos', path: '/videos', board: 'A-Uretimlerim', group: 'site', session: 'usr-demo' },
  { name: 'videos-empty', path: '/videos', board: 'A-Uretimlerim-Bos', group: 'site', session: 'usr-new' },
  { name: 'videos-filter-empty', path: '/videos?status=stopped', board: 'A-Uretimlerim', group: 'site', session: 'usr-paying' },
  {
    name: 'menu-customer', path: '/videos', board: 'A-Menu-M', group: 'site', session: 'usr-demo', only: 390, shot: 'viewport',
    act: async (page) => {
      await page.locator('header:visible button[aria-haspopup="dialog"]').click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { name: 'account', path: '/account', board: 'A-Hesap', group: 'site', session: 'usr-demo' },
  {
    name: 'account-delete', path: '/account', board: 'A-Hesap-Sil', group: 'site', session: 'usr-demo', shot: 'viewport',
    act: async (page) => {
      await page.locator('button.text-warn:visible').click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { name: 'pricing-customer', path: '/pricing', board: 'A-Fiyatlar', group: 'site', session: 'usr-demo' },
  { name: 'contact-account', path: '/contact?topic=refund', board: 'A-Iletisim-Durumlar', group: 'site', session: 'usr-demo' },
  ...(['pending', 'cancelled', 'expired'] as const).map((outcome): Route => ({
    // The return page of a checkout the provider has not (or no longer) answered: Buy of the second pack, then the provider's answer.
    name: `checkout-return-${outcome}`, path: '/pricing', board: outcome === 'pending' ? 'A-Odeme-Dogrulaniyor' : 'A-Odeme-Durumlar', group: 'site', session: 'usr-demo',
    act: async (page) => {
      await page.locator('article form button[type="submit"]').nth(1).click();
      await page.waitForURL(/\/checkout\/mock\/[0-9a-f-]{36}/);
      await page.locator(`button[name="outcome"][value="${outcome}"]`).click();
      await page.waitForURL(/\/checkout\/return\?checkout=/);
    },
  })),
  ...(['requested', 'dialog'] as const).map((state): Route => ({
    // A fresh pack is refundable: the confirmation dialog, then the "requested" state of the purchase.
    name: `account-refund-${state}`, path: '/pricing', board: state === 'dialog' ? 'A-Hesap-Iade-Onay' : 'A-Hesap-Durumlar', group: 'site', session: 'usr-demo',
    shot: state === 'dialog' ? 'viewport' : undefined,
    act: async (page) => {
      await page.locator('article form button[type="submit"]').nth(0).click();
      await page.waitForURL(/\/checkout\/mock\/[0-9a-f-]{36}/);
      await page.locator('button[name="outcome"][value="paid"]').click();
      await page.waitForURL(/\/checkout\/success/);
      await page.goto('/account');
      await page.getByRole('button', { name: /^(Request a refund|İade iste)$/ }).first().click();
      await page.getByRole('dialog').waitFor();
      if (state === 'requested') {
        await page.getByRole('dialog').locator('button[type="submit"]').click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' }).catch(() => undefined);
        await page.getByRole('button', { name: /^(Cancel request|İsteği geri al)$/ }).first().waitFor();
      }
    },
  })),
  {
    // A checkout is opened by the Buy form (a POST), not by an address: press Buy of the second pack (Standard).
    name: 'checkout-provider', path: '/pricing', board: '(not on the canvas: fake payment page)', group: 'site', session: 'usr-demo',
    act: async (page) => {
      await page.locator('article form button[type="submit"]').nth(1).click();
      await page.waitForURL(/\/checkout\/mock\/[0-9a-f-]{36}/);
    },
  },
  { name: 'checkout-success', path: '/checkout/success?purchase=pur-demo-standard', board: 'A-Odeme-Basarili', group: 'site', session: 'usr-demo' },
  {
    name: 'checkout-success-waiting', path: '/checkout/success?purchase=pur-demo-standard&returnTo=%2Ftemplates%2Ftpl-layering%2Fgenerate',
    board: 'A-Odeme-Basarili', group: 'site', session: 'usr-demo',
  },
  {
    name: 'checkout-failed', path: '/checkout/failed?purchase=pur-paying-standard&returnTo=%2Ftemplates%2Ftpl-layering%2Fgenerate',
    board: 'A-Odeme-Basarisiz', group: 'site', session: 'usr-paying',
  },
  { name: 'invoice', path: '/invoices/inv-demo-standard', board: 'A-Fatura', group: 'site', session: 'usr-demo' },
  { name: 'email-verify', path: '/dev/emails/verify', board: 'E-Dogrulama', group: 'site' },
  { name: 'email-reset', path: '/dev/emails/reset', board: 'E-Sifre', group: 'site' },
  { name: 'email-ready', path: '/dev/emails/ready', board: 'E-Hazir', group: 'site' },
  { name: 'email-stopped', path: '/dev/emails/stopped', board: 'E-Durdu', group: 'site' },
  { name: 'email-payment', path: '/dev/emails/payment', board: 'E-Odeme', group: 'site' },
];

const ADMIN: Route[] = [
  { name: 'admin-overview', path: '/admin', board: 'A-Admin-Genel', group: 'admin', session: 'usr-admin' },
  { name: 'admin-users', path: '/admin/users', board: 'A-Kullanicilar', group: 'admin', session: 'usr-admin' },
  { name: 'admin-users-empty', path: '/admin/users?q=zzz', board: 'A-Kullanicilar', group: 'admin', session: 'usr-admin' },
  { name: 'admin-user-detail', path: '/admin/users/usr-paying', board: 'A-Kullanici-Detay', group: 'admin', session: 'usr-admin' },
  { name: 'admin-revenue', path: '/admin/revenue', board: 'A-Gelir', group: 'admin', session: 'usr-admin' },
  { name: 'admin-revenue-credits', path: '/admin/revenue/credits', board: 'A-Krediler', group: 'admin', session: 'usr-admin' },
  { name: 'admin-jobs', path: '/admin/jobs', board: 'A-Isler', group: 'admin', session: 'usr-admin' },
  { name: 'admin-templates', path: '/admin/templates', board: 'A-Sablonlar', group: 'admin', session: 'usr-admin' },
  { name: 'admin-templates-inbox', path: '/admin/templates/inbox', board: 'A-Gelen', group: 'admin', session: 'usr-admin' },
  { name: 'admin-template-edit', path: '/admin/templates/tpl-layering', board: 'A-Sablon-Duzenle', group: 'admin', session: 'usr-admin' },
  { name: 'admin-templates-scans', path: '/admin/templates/scans', board: 'A-Tarama', group: 'admin', session: 'usr-admin' },
  { name: 'admin-settings', path: '/admin/settings', board: 'A-Ayarlar', group: 'admin', session: 'usr-admin' },
  {
    name: 'menu-admin', path: '/admin', board: 'A-Menu-Admin-M', group: 'admin', session: 'usr-admin', only: 390, shot: 'viewport',
    act: async (page) => {
      await page.locator('header:visible button[aria-haspopup="dialog"]').click();
      await page.getByRole('dialog').waitFor();
    },
  },
];

export const ROUTES: Route[] = [...VISITOR, ...CUSTOMER, ...ADMIN];
