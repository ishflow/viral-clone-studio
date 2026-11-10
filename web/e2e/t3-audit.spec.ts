import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { resetStore, setCookies } from './helpers';
import { ROUTES, type Route } from './routes';

/** T3 audit (scratch): accessible names, tap targets, alt text, h1, labels, duplicate ids, focus ring, per route and variant. Writes JSON, never fails. */
const OUT = path.join(__dirname, '__shots__', 'audit.json');
const VARIANTS = [
  { width: 390, height: 844, theme: 'dark', locale: 'en' },
  { width: 390, height: 844, theme: 'light', locale: 'tr' },
  { width: 1440, height: 900, theme: 'light', locale: 'en' },
  { width: 1440, height: 900, theme: 'dark', locale: 'tr' },
] as const;

const found: Record<string, string[]> = {};

for (const route of ROUTES as Route[]) {
  test(`audit ${route.name}`, async ({ browser, baseURL, request }) => {
    test.setTimeout(240_000);
    await resetStore(request);
    for (const v of VARIANTS) {
      if (route.only && route.only !== v.width) continue;
      const label = `${route.name} ${v.width} ${v.theme} ${v.locale}`;
      const issues: string[] = [];
      const context = await browser.newContext({ baseURL, viewport: { width: v.width, height: v.height }, colorScheme: v.theme, reducedMotion: 'reduce' });
      await setCookies(context, baseURL, { session: route.session, theme: v.theme, locale: v.locale, consent: route.consent === false ? undefined : 'necessary' });
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('[i18n] missing')) issues.push(`console ${m.type()}: ${m.text().slice(0, 160)}`); });
      page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));
      try {
        await page.goto(route.path, { waitUntil: 'load' });
        await page.waitForTimeout(300);
        if (route.act) await route.act(page);
        await page.waitForTimeout(200);
        await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
        const result = await page.evaluate((width) => {
          const out: string[] = [];
          const vis = (el: Element) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
          };
          const desc = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}]`;
          const nameOf = (el: Element): string => {
            const aria = el.getAttribute('aria-label'); if (aria?.trim()) return aria;
            const by = el.getAttribute('aria-labelledby');
            if (by) { const t = by.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t; }
            if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
              const labels = el.labels ? Array.from(el.labels).map((l) => l.textContent ?? '').join(' ').trim() : '';
              if (labels) return labels;
              if (el instanceof HTMLInputElement && ['submit', 'button'].includes(el.type) && el.value) return el.value;
            }
            const text = (el.textContent ?? '').trim(); if (text) return text;
            const img = el.querySelector('img[alt]'); if (img?.getAttribute('alt')?.trim()) return img.getAttribute('alt')!;
            const title = el.getAttribute('title'); if (title?.trim()) return title;
            return '';
          };
          const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=radio]';
          const els = Array.from(document.querySelectorAll(sel)).filter(vis);
          for (const el of els) {
            if (!nameOf(el)) out.push(`no accessible name: ${desc(el)} <${el.outerHTML.slice(0, 110).replace(/\s+/g, ' ')}>`);
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            const inline = s.display === 'inline' && el.tagName === 'A';
            const sr = el.closest('.sr-only') || (r.width <= 1 && r.height <= 1);
            const hiddenInput = el instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(el.type);
            let h = r.height, w = r.width;
            if (hiddenInput) { const l = el.closest('label'); if (l) { const lr = l.getBoundingClientRect(); h = lr.height; w = lr.width; } }
            if (!inline && !sr && (h < 43.5 || w < 43.5) && width <= 480) out.push(`tap target ${Math.round(w)}x${Math.round(h)}: ${desc(el)}`);
            if (!inline && !sr && width > 480 && (h < 24 || w < 24)) out.push(`tiny target ${Math.round(w)}x${Math.round(h)}: ${desc(el)}`);
          }
          for (const img of Array.from(document.images)) if (!img.hasAttribute('alt')) out.push(`img without alt: ${img.getAttribute('src')?.slice(0, 60)}`);
          const h1 = Array.from(document.querySelectorAll('h1')).filter(vis).length;
          if (h1 !== 1) out.push(`h1 count ${h1}`);
          const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(vis).map((h) => Number(h.tagName[1]));
          for (let i = 1; i < levels.length; i++) if (levels[i]! - levels[i - 1]! > 1) { out.push(`heading jump h${levels[i - 1]} → h${levels[i]}`); break; }
          const ids = new Map<string, number>(); document.querySelectorAll('[id]').forEach((e) => ids.set(e.id, (ids.get(e.id) ?? 0) + 1));
          for (const [id, n] of ids) if (n > 1) out.push(`duplicate id ${id} ×${n}`);
          if (!document.title.trim()) out.push('empty <title>');
          if (document.querySelectorAll('main').length !== 1) out.push(`main count ${document.querySelectorAll('main').length}`);
          out.push(`lang=${document.documentElement.lang}`);
          return out;
        }, v.width);
        issues.push(...result);
        // keyboard: every one of the first 15 tab stops shows a ring
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        const noRing: string[] = [];
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press('Tab');
          const info = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return null;
            const s = getComputedStyle(el);
            const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== '');
            const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
            const r = el.getBoundingClientRect();
            return { ring, name: `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}]`, visible: r.width > 0 && r.height > 0, offscreen: r.bottom < 0 || r.top > innerHeight, parentRing: parent ? parent.boxShadow !== 'none' : false };
          });
          if (info && info.visible && !info.ring && !info.parentRing) noRing.push(info.name);
        }
        if (noRing.length) issues.push(`no focus ring: ${[...new Set(noRing)].join(', ')}`);
      } catch (e) {
        issues.push(`error: ${(e as Error).message.split('\n')[0]}`);
      } finally {
        await context.close();
      }
      found[label] = issues;
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify(found, null, 1));
    }
  });
}
