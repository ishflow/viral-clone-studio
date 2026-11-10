import { BUSINESS } from '../config';
import type { Locale, Messages, Translate } from './types';

type Tree = { [key: string]: string | Tree };

const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

function isPluralObject(value: Tree): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => PLURAL_CATEGORIES.has(k) && typeof value[k] === 'string');
}

/** Nested JSON → flat map. Plural objects become `a.b#one`, `a.b#other`. */
export function flatten(tree: Tree, prefix = '', out: Messages = {}): Messages {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (isPluralObject(value)) {
      for (const [cat, text] of Object.entries(value)) out[`${path}#${cat}`] = text as string;
    } else flatten(value, path, out);
  }
  return out;
}

const warned = new Set<string>();

function warnMissing(key: string) {
  if (process.env.NODE_ENV === 'production' || warned.has(key)) return;
  warned.add(key);
  console.warn(`[i18n] missing message: ${key}`);
}

export function createTranslate(locale: Locale, messages: Messages): Translate {
  const rules = new Intl.PluralRules(locale);
  return (key, params) => {
    const own = (k: string) => (Object.hasOwn(messages, k) ? messages[k] : undefined);
    let text = own(key);
    if (text === undefined && typeof params?.count === 'number') {
      text = own(`${key}#${rules.select(params.count)}`);
    }
    if (text === undefined) text = own(`${key}#other`);
    if (text === undefined) {
      warnMissing(key);
      return key;
    }
    const values = { ...BUSINESS, ...params };
    return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in values ? String(values[name as keyof typeof values]) : whole,
    );
  };
}
