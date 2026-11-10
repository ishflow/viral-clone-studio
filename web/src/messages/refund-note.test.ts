// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTranslate, flatten } from '../core/i18n/translate';

const load = (locale: 'en' | 'tr') => flatten(
  ['adminActions', 'common'].reduce((all, ns) => ({ ...all, [ns]: JSON.parse(readFileSync(join(__dirname, locale, `${ns}.json`), 'utf8')) }), {}),
);

describe('the refund confirmation note', () => {
  it('the refund note names the credits once in both languages', () => {
    for (const [locale, word] of [['en', 'credits'], ['tr', 'kredi']] as const) {
      const t = createTranslate(locale, load(locale));
      const credits = t('common.credits.count', { count: 10 });
      const note = t('adminActions.refund.info', { credits });
      expect(note, locale).toContain(credits);
      expect(note.split(word).length - 1, `${locale}: "${note}"`).toBe(1);
    }
  });
});
