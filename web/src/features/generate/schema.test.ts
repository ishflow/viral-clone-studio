import { describe, expect, it } from 'vitest';
import { parseKeptForm } from './schema';

const PHOTO = 'uploads/0b9e6a52-6a1c-4c53-9d0e-3f5b8a1c2d4e/1.png';
const kept = (images: string[]) => ({ products: [{ name: 'Oil', description: '', images }], quality: 'fast', variants: 1, language: 'en' });

describe('parseKeptForm photo paths', () => {
  it('keeps a path of the shape the server stores', () => {
    expect(parseKeptForm(kept([PHOTO]), 1)?.products[0]?.images).toEqual([PHOTO]);
  });

  it.each(['uploads/../x', 'uploads/u/oil.png', 'oil.jpg', 'uploads/0b9e6a52-6a1c-4c53-9d0e-3f5b8a1c2d4e/../1.png', 'uploads/0b9e6a52-6a1c-4c53-9d0e-3f5b8a1c2d4e/1.gif', 'uploads/0b9e6a52-6a1c-4c53-9d0e-3f5b8a1c2d4e/source.mp4'])(
    'drops %s',
    (path) => {
      expect(parseKeptForm(kept([PHOTO, path]), 1)?.products[0]?.images).toEqual([PHOTO]);
    },
  );
});
