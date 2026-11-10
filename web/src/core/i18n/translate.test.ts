import { describe, expect, it } from 'vitest';
import { BUSINESS } from '../config';
import { createTranslate, flatten } from './translate';

const messages = flatten({ common: { hello: 'Hello {name}', products: { one: '{count} product', other: '{count} products' } } });

describe('createTranslate', () => {
  const t = createTranslate('en', messages);
  it('fills params', () => expect(t('common.hello', { name: 'Ada' })).toBe('Hello Ada'));
  it('picks the plural form by count', () => {
    expect(t('common.products', { count: 1 })).toBe('1 product');
    expect(t('common.products', { count: 4 })).toBe('4 products');
  });
  it('returns the key when it is missing', () => expect(t('common.nope')).toBe('common.nope'));
  it('does not resolve inherited properties', () => expect(t('constructor')).toBe('constructor'));
  it('leaves an unknown param visible', () => expect(t('common.hello')).toBe('Hello {name}'));
  it('fills the business details from the one place that holds them, with or without params', () => {
    const biz = createTranslate('en', flatten({ b: { a: '{company}, {address} · {supportEmail}', c: '{company} says {x}' } }));
    expect(biz('b.a')).toBe(`${BUSINESS.company}, ${BUSINESS.address} · ${BUSINESS.supportEmail}`);
    expect(biz('b.c', { x: 'hi' })).toBe(`${BUSINESS.company} says hi`);
  });
  it('lets an explicit param win over the business detail', () => {
    expect(createTranslate('en', flatten({ b: '{company}' }))('b', { company: 'Other' })).toBe('Other');
  });
});
