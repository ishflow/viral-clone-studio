import { readFileSync } from 'node:fs';
// Run before publishing: node scripts/check-legal.mjs. Owner questions warn without failing.
let placeholders = false;
for (const locale of ['en', 'tr']) {
  const legal = JSON.parse(readFileSync(new URL(`../src/messages/${locale}/marketing.json`, import.meta.url), 'utf8')).legal;
  function visit(value, key) {
    if (typeof value === 'string') {
      if (value.includes('[LEGAL TEXT]')) { console.error(`${locale}:${key}: missing legal text`); placeholders = true; }
      for (const marker of value.match(/\[OWNER TO CONFIRM:[^\]]+\]/g) ?? []) console.warn(`${locale}:${key}: ${marker}`);
    } else for (const [child, content] of Object.entries(value)) visit(content, `${key}.${child}`);
  }
  visit(legal, 'legal');
}
process.exitCode = placeholders ? 1 : 0;
