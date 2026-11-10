// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyEvent, priceRefusal, refundTransition } from './state';
describe('payment state contract', () => {
  it.each(['open','pending','declined','cancelled','expired'] as const)('late paid from %s grants once', status => {
    const result = applyEvent({status, amountMinor:1900,currency:'USD'}, {kind:'paid',amountMinor:1900,currency:'USD'});
    expect(result).toEqual({status:'paid',grant:true,mismatch:false});
    expect(applyEvent({...result,amountMinor:1900,currency:'USD'}, {kind:'paid',amountMinor:1900,currency:'USD'}).grant).toBe(false);
  });
  it.each(['pending','declined','cancelled','expired'] as const)('paid is terminal against %s', kind => {
    expect(applyEvent({status:'paid',amountMinor:1900,currency:'USD'}, {kind,amountMinor:1900,currency:'USD'}).status).toBe('paid');
  });
  it('mismatched amount/currency never grants', () => {
    for(const event of [{kind:'paid' as const,amountMinor:1,currency:'USD'}, {kind:'paid' as const,amountMinor:1900,currency:'EUR'}])
      expect(applyEvent({status:'pending',amountMinor:1900,currency:'USD'},event)).toEqual({status:'pending',grant:false,mismatch:true});
  });
  it('refund notices cannot skip sending', () => {
    expect(refundTransition('refund-requested','refunded')).toBe('refund-requested');
    expect(refundTransition('refund-sent','refunded')).toBe('refunded');
    expect(refundTransition('refund-sent','refund-failed')).toBe('refund-failed');
  });
});
describe('price rule of a real payment', () => {
  const pack = {amountMinor:1900,currency:'USD',productId:'pdt_starter'};
  const paid = {amountMinor:1900,currency:'USD'};
  const cart = [{productId:'pdt_starter',quantity:1}];
  it('accepts the pack price before tax, in USD, for exactly one of the pack\'s own product, with or without tax on top', () => {
    expect(priceRefusal(pack, paid, {taxMinor:361,cart})).toBeNull();
    expect(priceRefusal(pack, paid, {taxMinor:0,cart})).toBeNull();
  });
  it('refuses a payment whose tax the provider did not report, even when the total equals the price', () => {
    expect(priceRefusal(pack, paid, {taxMinor:null,cart})).toBe('tax-unknown');
  });
  it('refuses another currency even at the same number', () => {
    expect(priceRefusal(pack, {amountMinor:1900,currency:'EUR'}, {taxMinor:0,cart})).toBe('currency');
  });
  it.each([
    ['an empty cart', []], ['another product', [{productId:'pdt_studio',quantity:1}]], ['two of the product', [{productId:'pdt_starter',quantity:2}]],
    ['none of the product', [{productId:'pdt_starter',quantity:0}]], ['the product and something else', [...cart,{productId:'pdt_studio',quantity:1}]],
    ['the product twice', [...cart,...cart]],
  ])('refuses %s', (_name, items) => {
    expect(priceRefusal(pack, paid, {taxMinor:0,cart:items})).toBe('cart');
  });
  it.each([1899,1901,0,19])('refuses the amount %i before tax', amountMinor => {
    expect(priceRefusal(pack, {amountMinor,currency:'USD'}, {taxMinor:0,cart})).toBe('amount');
  });
  it('refuses when the provider\'s facts were not passed at all', () => {
    expect(priceRefusal(pack, paid, undefined)).toBe('facts-missing');
  });
});
