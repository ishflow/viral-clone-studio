import { describe, expect, it } from 'vitest';
import type { FillJson } from '../template/schema.ts';
import { photographsFor, pictureGiven } from './pictures.ts';

const fill = {
  products: [{ name: 'Serum', images: ['uploads/u/serum-1.png', 'uploads/u/serum-2.png'] }, { name: 'Cream', images: ['uploads/u/cream-1.png'] }],
} as unknown as FillJson;

describe('pictureGiven', () => {
  it('a photograph the customer gave, by product and number', () => {
    expect(pictureGiven('product:1', fill)).toBe(true);
    expect(pictureGiven('product:1.2', fill)).toBe(true);
    expect(pictureGiven('product:2', fill)).toBe(true);
  });
  it('not: a product or a photograph the customer did not give', () => {
    expect(pictureGiven('product:1.3', fill)).toBe(false);
    expect(pictureGiven('product:2.2', fill)).toBe(false);
    expect(pictureGiven('product:3', fill)).toBe(false);
  });
  it('a still is always there: the template lists it and the run makes it', () => {
    expect(pictureGiven('still:proof', fill)).toBe(true);
  });
});

describe('photographsFor: the customer files a paid request is made from', () => {
  it('the photograph named, in the order of the references', () => {
    expect(photographsFor(['product:2', 'product:1.2', 'product:1'], fill)).toEqual(['uploads/u/cream-1.png', 'uploads/u/serum-2.png', 'uploads/u/serum-1.png']);
  });
  it('a photograph the customer did not give becomes the product’s first, and no file is listed twice', () => {
    expect(photographsFor(['product:1.4'], fill)).toEqual(['uploads/u/serum-1.png']);
    expect(photographsFor(['product:1', 'product:1.3', 'product:2.5'], fill)).toEqual(['uploads/u/serum-1.png', 'uploads/u/cream-1.png']);
  });
  it('a still is not a customer file, and a product the customer did not give has none', () => {
    expect(photographsFor(['still:proof', 'product:3', 'product:1'], fill)).toEqual(['uploads/u/serum-1.png']);
    expect(photographsFor([], fill)).toEqual([]);
  });
});
