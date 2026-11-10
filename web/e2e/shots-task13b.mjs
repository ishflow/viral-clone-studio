// Task 13, fix round 4: the five admin pages at 390x844 dark and 1440x900 light, full page, plus the phone table checks.
// `node e2e/shots-task13b.mjs before` writes into task13b/before (desktop baseline taken before the round).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = 'http://localhost:3123';
const sub = process.argv[2];
const out = sub ? `e2e/__shots__/task13b/${sub}` : 'e2e/__shots__/task13b';
mkdirSync(out, { recursive: true });
const routes = { genel: '/admin', users: '/admin/users', detay: '/admin/users/usr-demo', gelir: '/admin/revenue', krediler: '/admin/revenue/credits' };

/** Runs in the page. Returns the failures and, per table, the measured widths. */
function check() {
  const fails = [];
  const root = document.documentElement;
  if (root.scrollWidth !== 390) fails.push(`page scrollWidth ${root.scrollWidth}`);
  const hidden = (el) => el.closest('.sr-only') !== null;
  const tables = [...document.querySelectorAll('table')].map((table) => {
    const box = table.parentElement;
    const name = table.querySelector('caption')?.textContent ?? '?';
    if (table.scrollWidth < box.clientWidth) fails.push(`${name}: table ${table.scrollWidth} narrower than its box ${box.clientWidth}`);
    if (getComputedStyle(box).overflowX !== 'auto') fails.push(`${name}: box does not scroll`);
    const boxRect = box.getBoundingClientRect();
    if (boxRect.left < 0 || boxRect.right > 390) fails.push(`${name}: box leaves the page (${boxRect.left} to ${boxRect.right})`);
    for (const cell of table.querySelectorAll('td, th')) {
      const label = `${name} / "${cell.textContent.trim().slice(0, 24)}"`;
      const truncated = cell.querySelector('a[title], span[title]');
      if (cell.scrollWidth > cell.clientWidth && !truncated) fails.push(`${label}: cell clips (${cell.scrollWidth} > ${cell.clientWidth})`);
      // No element inside a cell may cut its own text, except the email / user link.
      for (const el of cell.querySelectorAll('*')) {
        if (hidden(el) || el.hasAttribute('title')) continue;
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') fails.push(`${label}: <${el.tagName.toLowerCase()}> clips its text`);
      }
      // No text may wrap onto a second line.
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || hidden(node.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (tops.size > 1) fails.push(`${label}: "${node.textContent.trim().slice(0, 24)}" wraps onto ${tops.size} lines`);
      }
    }
    // The email / user link: one line, ellipsis, full text in `title`, at most 12rem (192 px) on the phone.
    for (const el of table.querySelectorAll('[title]')) {
      const cs = getComputedStyle(el);
      if (cs.textOverflow !== 'ellipsis' || cs.whiteSpace !== 'nowrap' || cs.maxWidth !== '192px') fails.push(`${name} / "${el.textContent}": not a 12rem ellipsis line (${cs.maxWidth}, ${cs.textOverflow}, ${cs.whiteSpace})`);
      if (el.title !== el.textContent) fails.push(`${name} / "${el.textContent}": title is not the full text`);
    }
    const truncatedLinks = [...table.querySelectorAll('[title]')].map((el) => Math.round(el.getBoundingClientRect().width));
    return { name, minWidth: table.style.minWidth, table: table.scrollWidth, box: box.clientWidth, scrolls: table.scrollWidth > box.clientWidth, widestEmail: Math.max(0, ...truncatedLinks) };
  });
  return { fails, tables };
}

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
for (const [scheme, w, h] of [['dark', 390, 844], ['light', 1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
  await ctx.addCookies([
    { name: 'vc_session', value: 'usr-admin', url: base },
    { name: 'vc_theme', value: scheme, url: base },
  ]);
  const page = await ctx.newPage();
  for (const [name, path] of Object.entries(routes)) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none }' }); // the dev-only Next.js badge
    await page.screenshot({ path: `${out}/${name}-${scheme}-${w}.png`, fullPage: true });
    if (w !== 390) continue;
    const { fails, tables } = await page.evaluate(check);
    console.log(`${name} (${path}) ${fails.length === 0 ? 'PASS' : 'FAIL'}`);
    for (const t of tables) console.log(`  table "${t.name}": min-width ${t.minWidth}, table ${t.table}, box ${t.box}, scrolls ${t.scrolls}, widest email link ${t.widestEmail}`);
    for (const f of fails) console.log(`  FAIL ${f}`);
    failed += fails.length;
    // Second shot with every table scrolled to its right end: the columns that were out of the box are whole.
    await page.evaluate(() => document.querySelectorAll('table').forEach((table) => table.parentElement.scrollTo({ left: table.scrollWidth })));
    await page.screenshot({ path: `${out}/${name}-${scheme}-${w}-scrolled.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(failed === 0 ? 'ALL PHONE CHECKS PASS' : `${failed} FAILURES`);
process.exitCode = failed === 0 ? 0 : 1;
