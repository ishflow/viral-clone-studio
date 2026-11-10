// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flatten } from '../core/i18n/translate';
import type { LedgerType } from '../data/ports';

const root = __dirname;
const load = (l: string, ns: string) =>
  flatten(JSON.parse(readFileSync(join(root, l, `${ns}.json`), 'utf8')));
const namespaces = readdirSync(join(root, 'en'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .sort();

// Values that are the same in Turkish everywhere (format and quality names, codes, language names shown in their own language).
const SAME_VALUES = new Set(['Fast', 'Best', 'EN', 'TR', '720p', '1080p', 'mp4', 'PDF', 'English', 'Türkçe']);
// Key-scoped exceptions ("namespace.key"), each with its reason.
const SAME_KEYS = new Set([
  // only parameters and symbols: the duration word comes from the shared duration format
  'generate.confirm.finalValue',
  'jobs.result.leadNoLength',
  // scan-source names are TikTok / YouTube product names, same in Turkish (owner's design keeps them)
  'adminSettings.scanning.topads',
  'adminSettings.scanning.shorts',
  'adminTemplates.source.topads',
  'adminTemplates.source.shorts',
  'adminTemplates.source.topadsShort',
  'adminTemplates.source.shortsShort',
  'adminTemplates.inbox.sourceFilter.topads',
  'adminTemplates.inbox.sourceFilter.shorts',
  // same word in Turkish
  'gallery.filters.format',
  // a URL prefix, not a word
  'gallery.add.linkPlaceholder',
  'adminJobs.table.video',
  'adminTemplates.list.col.format',
  'adminTemplates.edit.format',
  'adminUsers.detail.jobs.format',
  'checkout.invoice.no',
  // currency code, same in Turkish
  'adminActions.chart.axis',
  // typed confirmation word, must match what the account form asks for
  'account.delete.word',
  // sample data, not interface copy: template title and pack name stay English (the fake catalog is English only)
  'emails.sample.title',
  'emails.sample.pack',
  // Brand attribution is fixed by the owner in both languages.
  'emails.footer.company',
]);
// Exception to "running = Üretiliyor": gallery.add.step.running stays "sürüyor" (a preparation step is not a generation).
// Pure numbers, symbols, bracket-only placeholders, bare {param} values.
const NEUTRAL = /^(?:[\s#\d.,:;/\-–—+×x%$€£•·|()[\]{}]*|(?:\[[A-Z0-9 _-]+\]|\{\w+\})(?:[\s/·|,-]+(?:\[[A-Z0-9 _-]+\]|\{\w+\}))*)$/;

const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const brackets = (s: string) => [...s.matchAll(/\[[A-Z0-9 _-]+\]/g)].map((m) => m[0]).sort();

describe.each(namespaces)('messages: %s', (ns) => {
  const en = load('en', ns);
  const tr = load('tr', ns);

  it('has the same flattened keys (plural categories included)', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty values', () => {
    for (const [loc, m] of [['en', en], ['tr', tr]] as const) {
      const empty = Object.entries(m).filter(([, v]) => v.trim() === '').map(([k]) => k);
      expect(empty, loc).toEqual([]);
    }
  });

  it('plural objects have "other" in Turkish', () => {
    const plural = Object.keys(en).filter((k) => k.includes('#')).map((k) => k.split('#')[0]);
    for (const base of new Set(plural)) expect(tr[`${base}#other`], base).toBeTruthy();
  });

  it('uses the same {params} in both languages', () => {
    const bad = Object.keys(en).filter((k) => tr[k] !== undefined && params(en[k]!).join() !== params(tr[k]!).join());
    expect(bad).toEqual([]);
  });

  it('keeps [PLACEHOLDERS] unchanged', () => {
    const bad = Object.keys(en).filter((k) => tr[k] !== undefined && brackets(en[k]!).join() !== brackets(tr[k]!).join());
    expect(bad).toEqual([]);
  });

  it('has no Turkish value identical to English unless allow-listed', () => {
    const same = Object.keys(en).filter(
      (k) => tr[k] === en[k] && !SAME_VALUES.has(en[k]!) && !SAME_KEYS.has(`${ns}.${k}`) && !NEUTRAL.test(en[k]!.replace(/©/g, '').trim()),
    );
    expect(same).toEqual([]);
  });

  it('customer copy has no vendor / model names or HTTP codes', () => {
    if (ns.startsWith('admin')) return;
    for (const [loc, m] of [['en', en], ['tr', tr]] as const) {
      const bad = Object.entries(m)
        // Processor disclosure belongs in Privacy; other customer copy stays provider-neutral.
        .filter(([k]) => !(ns === 'marketing' && k === 'legal.body.privacy.3'))
        .filter(([, v]) => /seedance|kling|nano banana|lyria|magnific|\b[45]\d\d\b/i.test(v.replace(/\[[A-Z0-9 _-]+\]/g, '')))
        .map(([k, v]) => `${loc} ${k}: ${v}`);
      expect(bad).toEqual([]);
    }
  });

  it('Turkish copy has no formal register or exclamation marks', () => {
    const bad = Object.entries(tr)
      .filter(([, v]) => /!|\blütfen\b|[\p{L}]+(ınız|iniz|unuz|ünüz|sunuz|siniz|sünüz|sınız)(?![\p{L}])/iu.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });
});

// Every ledger type has its label for the customer and for the admin, in both languages (the compiler holds the list to the union).
const LEDGER_TYPES = Object.keys({
  purchase: 1, generation: 1, 'free-video': 1, admin: 1, refund: 1, returned: 1,
} satisfies Record<LedgerType, 1>);
describe.each(['en', 'tr'])('ledger type labels in %s', (locale) => {
  it('every LedgerType has a label in account and adminRevenue', () => {
    for (const type of LEDGER_TYPES) {
      expect(load(locale, 'account')[`activity.type.${type}`], type).toBeTruthy();
      expect(load(locale, 'adminRevenue')[`ledgerType.${type}`], type).toBeTruthy();
    }
  });
});

// Owner questions must match between translations; they warn in scripts/check-legal.mjs.
it('legal owner questions have en/tr parity and no missing legal text', () => {
  const en = load('en', 'marketing');
  const tr = load('tr', 'marketing');
  for (const key of Object.keys(en).filter((key) => key.startsWith('legal.'))) {
    expect(en[key]).not.toContain('[LEGAL TEXT]');
    expect(tr[key]).not.toContain('[LEGAL TEXT]');
    const markers = (value: string) => value.match(/\[OWNER TO CONFIRM:[^\]]+\]/g) ?? [];
    expect(markers(tr[key]!)).toEqual(markers(en[key]!));
  }
});
