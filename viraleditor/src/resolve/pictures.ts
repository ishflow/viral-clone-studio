// What a picture reference of a template means for one customer.
import type { FillJson } from '../template/schema.ts';
import { imageOf } from '../template/values.ts';

/** Is the picture there for this customer? A still always is (the run makes it); a photograph when the customer gave that product and that many photographs of it. */
export function pictureGiven(ref: string, fill: FillJson): boolean {
  const image = imageOf(ref);
  if (image.kind === 'still') return true;
  const product = fill.products[image.product - 1];
  return product !== undefined && image.photograph <= product.images.length;
}

/**
 * The customer's files a paid request is made from, for the references a still or the presenter names: the photograph named,
 * or the product's first one when the customer gave fewer (a paid request never fails on a photograph number). Each file
 * once, in order. Stills are not listed: the pipeline has their files.
 */
export function photographsFor(references: string[], fill: FillJson): string[] {
  const files: string[] = [];
  for (const ref of references) {
    const image = imageOf(ref);
    if (image.kind === 'still') continue;
    const images = fill.products[image.product - 1]?.images;
    const file = images?.[image.photograph - 1] ?? images?.[0];
    if (file !== undefined && !files.includes(file)) files.push(file);
  }
  return files;
}
