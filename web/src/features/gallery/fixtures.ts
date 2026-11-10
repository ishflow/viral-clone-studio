import type { Template } from '@/data/ports';

/** A plain template for component tests. */
export function makeTemplate(patch: Partial<Template> = {}): Template {
  return {
    id: 'tpl-a', title: 'Fragrance layering recipe', category: 'Fragrance', format: 'no-talking', seconds: 8, referenceViews: '1.9M',
    image: '/samples/a.jpg', video: null, products: 4, status: 'published', ownerId: null, timesGenerated: 0, editedAt: '2026-10-01T00:00:00.000Z',
    source: 'link', preparation: null, preparationNote: null, description: '', tags: [], sample: 'none',
    shots: [
      { n: 1, from: 0, to: 1.3, action: 'Products side by side', text: 'hook text', product: null },
      { n: 2, from: 1.3, to: 2.9, action: 'Product 1 in hand', text: 'name, top left', product: 1 },
      { n: 3, from: 2.9, to: 8, action: 'Product 2 in hand', text: 'none', product: 2 },
    ],
    ...patch,
  };
}
