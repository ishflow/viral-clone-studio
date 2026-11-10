// @vitest-environment node
import { expect, it } from 'vitest';
import { toRunRow, toTemplateRow } from './rows';
import type { Card, RunInput } from './rows';

// The site's copy names what a person swap adds to the engine's rows (`viraleditor/src/contracts.ts`: `Card.swap`, and `swap` of a
// produce run) with the engine's own field names: written here without a cast, they are read back as they were written.

const card: Card = {
  title: 'Walk to the camera', category: 'Person swap', format: 'no-talking', seconds: 12, referenceViews: '', image: null, video: null,
  products: 0, shots: [], description: '', tags: [],
  swap: { people: 1, sound: true, persons: [{ slot: 1, box: { left: 30, top: 10, right: 70, bottom: 95 }, hint: 'the woman on the left' }], parts: [{ n: 1, from: 0, to: 6 }, { n: 2, from: 6, to: 12 }] },
};
const input: RunInput = {
  kind: 'produce', templateId: 'tpl', ownerId: 'usr', quality: 'fast', variants: 1, language: 'en', products: [], sample: false,
  swap: { people: [{ slot: 1, body: 'uploads/11111111-2222-4333-8444-555555555555/1.png', face: null }] },
};

it('a person-swap card is read with its people and its parts', () => {
  const row = toTemplateRow({ id: 'tpl', state: 'published', source_kind: 'upload', card: JSON.stringify(card), created_at: 'a', updated_at: 'a' });
  expect(row.card.swap).toEqual(card.swap);
  expect(row.card.swap?.persons.map((person) => person.slot)).toEqual([1]);
  expect(row.card.swap?.parts.map((part) => part.to)).toEqual([6, 12]);
});

it('a produce run of a person swap is read with the photographs of each slot', () => {
  const row = toRunRow({ id: 'run', kind: 'produce', ref: 'job', state: 'queued', input: JSON.stringify(input), created_at: 'a', updated_at: 'a' });
  expect(row.input.kind === 'produce' && row.input.swap?.people).toEqual([{ slot: 1, body: 'uploads/11111111-2222-4333-8444-555555555555/1.png', face: null }]);
});

it('a card and a produce run of a product video have no swap', () => {
  expect(toTemplateRow({ id: 'tpl', state: 'published', source_kind: 'seed', card: JSON.stringify({ ...card, swap: undefined }), created_at: 'a', updated_at: 'a' }).card.swap).toBeUndefined();
  const run = toRunRow({ id: 'run', kind: 'produce', ref: 'job', state: 'queued', input: JSON.stringify({ ...input, swap: undefined }), created_at: 'a', updated_at: 'a' });
  expect(run.input.kind === 'produce' && run.input.swap).toBeUndefined();
});
