// @vitest-environment node
import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '..';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { RULES } from '../ports';
import type { SwapConsent, SwapInput } from '../ports';
import { jpegOf, pngOf, webpOf, webpWithExif } from './photo-test-fixture';
import type { Card } from './rows';
import { closeSqliteEngines } from './sqlite-engine';
import { card, jobRecord, makeDataDir, putTemplate } from './testing';

// The photographs of a person swap are measured again on the server when the job is started: a request that never passed the
// browser's check starts nothing with a photograph that is too small, or with a full-body photograph that is not upright.

let dir: string;
let db: DatabaseSync;
const MIN = RULES.swapPhotoShortSideMin;
const SWAP_PAID = { images: 0, clips: 2, clipSeconds: 12, music: 0, voice: 0 };
const swapCard: Card = {
  ...card({ seconds: 12, shots: [], products: 0 }),
  swap: { people: 1, sound: true, persons: [{ slot: 1, box: { left: 30, top: 10, right: 70, bottom: 95 }, hint: 'the woman on the left' }], parts: [{ n: 1, from: 0, to: 6 }, { n: 2, from: 6, to: 12 }] },
};
const consent: SwapConsent = { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion };
const upload = (bytes: Uint8Array, name = 'me.png') => data.uploads.save('usr-demo', new File([bytes as BlobPart], name));
const on = (stored: string) => existsSync(join(dir, dirname(stored)));
const runs = () => (db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n;
async function start(body: string, face: string | null, key = 'key-1', side?: string) {
  const input: SwapInput = { templateId: 'sw1', quality: 'fast', people: [{ slot: 1, body, face, side }] };
  return data.swap.start('usr-demo', input, key, await data.swap.estimate('usr-demo', input), consent);
}
/** Nothing started: no job of a person swap, no run, the balance as it was. */
const nothing = async () => [getStore().jobs.filter((job) => job.swap).length, runs(), await data.ledger.balance('usr-demo')];

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', dir); vi.stubEnv('VC_ADMIN_PASSWORD', 'test-only-password-123');
  resetStore(); addDemoCustomers(); closeSqliteEngines();
  Object.assign(getStore().limits, { personSwap: true, swapReview: false });
  putTemplate(db, { id: 'sw1', state: 'published', card: swapCard, estimate: SWAP_PAID, minutes: 3 });
});
afterEach(() => {
  closeSqliteEngines(); db.close(); rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.restoreAllMocks(); resetStore();
});

describe('a person swap is not started with a photograph the rules do not take', () => {
  it('a full-body photograph whose short side is under the least: nothing is charged, no run is made, and the photograph is deleted', async () => {
    const body = await upload(pngOf(MIN - 1, 900));
    await expect(start(body, null)).rejects.toThrow('swap-photo');
    expect(await nothing()).toEqual([0, 0, 19]);
    expect(on(body)).toBe(false);
  });

  it('a full-body photograph that lies on its side, or is square: refused, though it is large enough', async () => {
    for (const bytes of [jpegOf(1200, 800), webpOf(800, 800, 'VP8X')]) {
      const body = await upload(bytes);
      await expect(start(body, null)).rejects.toThrow('swap-photo');
      expect(on(body)).toBe(false);
    }
    expect(await nothing()).toEqual([0, 0, 19]);
  });

  it('a face photograph that is too small: refused, and only that photograph is deleted (the body one is kept for the next try)', async () => {
    const body = await upload(pngOf(MIN, MIN + 1)), face = await upload(pngOf(MIN - 1, MIN - 1));
    await expect(start(body, face)).rejects.toThrow('swap-photo');
    expect(await nothing()).toEqual([0, 0, 19]);
    expect([on(body), on(face)]).toEqual([true, false]);
  });

  it('a side photograph that is too small: refused, and only that photograph is deleted (the other two are kept for the next try)', async () => {
    const body = await upload(pngOf(MIN, MIN + 1)), face = await upload(pngOf(MIN, MIN)), side = await upload(pngOf(MIN - 1, MIN - 1));
    await expect(start(body, face, 'key-1', side)).rejects.toThrow('swap-photo');
    expect(await nothing()).toEqual([0, 0, 19]);
    expect([on(body), on(face), on(side)]).toEqual([true, true, false]);
  });

  it('is started with a side photograph at the edge of the rules: the least short side, and lying on its side like a face may', async () => {
    const job = await start(await upload(pngOf(MIN, MIN + 1)), null, 'key-1', await upload(jpegOf(900, MIN)));
    expect([job.status, on(job.swap!.people[0]!.side!)]).toEqual(['running', true]);
    expect(await nothing()).toEqual([1, 1, 16]);
  });

  it('is started with photographs at the edge of the rules: the least short side, a face that lies on its side, a phone photo turned upright by its EXIF', async () => {
    const first = await start(await upload(pngOf(MIN, MIN + 1)), await upload(jpegOf(900, MIN)), 'key-1');
    const second = await start(await upload(jpegOf(4000, 3000, { orientation: 6 })), null, 'key-2');
    expect([first.status, second.status]).toEqual(['running', 'running']);
    expect(await nothing()).toEqual([2, 2, 13]);
  });

  it('is started with a phone photo turned upright by the EXIF data of a PNG, as by that of a JPEG; turned onto its side by it, it is refused', async () => {
    expect((await start(await upload(pngOf(4000, 3000, { orientation: 6 })), null, 'key-1')).status).toBe('running');
    const lying = await upload(pngOf(3000, 4000, { orientation: 8 }));
    await expect(start(lying, null, 'key-2')).rejects.toThrow('swap-photo');
    expect(on(lying)).toBe(false);
  });

  it('holds a WebP to the size of its header whatever its EXIF data says, as Chrome does in the form', async () => {
    expect((await start(await upload(webpWithExif(3000, 4000, { orientation: 6 }), 'me.webp'), null, 'key-1')).status).toBe('running');
    const lying = await upload(webpWithExif(4000, 3000, { orientation: 6 }), 'lying.webp');
    await expect(start(lying, null, 'key-2')).rejects.toThrow('swap-photo');
    expect(on(lying)).toBe(false);
  });

  it('does not delete a refused photograph that a job already keeps', async () => {
    const small = await upload(pngOf(MIN - 1, 900));
    getStore().jobs.push(jobRecord({ id: 'job-product', userId: 'usr-demo', status: 'done' }, { products: [{ name: 'p', description: '', images: [small] }] }));
    await expect(start(small, null)).rejects.toThrow('swap-photo');
    expect(on(small)).toBe(true);
  });

  it('does not delete a refused photograph that a person swap keeps as its side photograph', async () => {
    const lying = await upload(jpegOf(900, MIN));                             // fine from the side, not as the full-body photograph
    expect((await start(await upload(pngOf(MIN, MIN + 1)), null, 'key-1', lying)).status).toBe('running');
    await expect(start(lying, null, 'key-2')).rejects.toThrow('swap-photo');
    expect(on(lying)).toBe(true);
  });
});

// Bytes that begin like a photograph and do not say how large it is: nothing a model can be given, and nothing the rules can be held to.
const chars = (text: string) => [...text].map((char) => char.charCodeAt(0));
const UNMEASURED: [string, Uint8Array][] = [
  ['the first bytes of a PNG and nothing after them', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
  ['a PNG cut inside its header', pngOf(900, 1200).subarray(0, 20)],
  ['a JPEG without a frame', jpegOf(900, 1200).subarray(0, 20)],
  ['a WebP that names no picture', new Uint8Array([...chars('RIFF'), 0, 0, 0, 0, ...chars('WEBP'), ...chars('JUNK'), 0, 0, 0, 0])],
];
const stored = () => (existsSync(join(dir, 'uploads')) ? readdirSync(join(dir, 'uploads')) : []);

describe('a file whose bytes do not say its size', () => {
  it.each(UNMEASURED)('%s is not stored as the photograph of a person', async (_name, bytes) => {
    await expect(data.uploads.save('usr-demo', new File([bytes as BlobPart], 'me.png'), 'person')).rejects.toThrow('upload-unreadable');
    expect(stored()).toEqual([]);
  });

  it.each(UNMEASURED)('%s, stored on another way, starts no person swap as a full-body photograph: nothing is charged, no run is made, and it is deleted', async (_name, bytes) => {
    const body = await upload(bytes);
    await expect(start(body, null)).rejects.toThrow('swap-photo');
    expect(await nothing()).toEqual([0, 0, 19]);
    expect(on(body)).toBe(false);
  });

  it('starts none as a face photograph either, and only that photograph is deleted', async () => {
    const body = await upload(pngOf(MIN, MIN + 1)), face = await upload(UNMEASURED[0]![1]);
    await expect(start(body, face)).rejects.toThrow('swap-photo');
    expect(await nothing()).toEqual([0, 0, 19]);
    expect([on(body), on(face)]).toEqual([true, false]);
  });

  it('starts none as a side photograph either, and only that photograph is deleted', async () => {
    const body = await upload(pngOf(MIN, MIN + 1)), side = await upload(UNMEASURED[0]![1]);
    await expect(start(body, null, 'key-1', side)).rejects.toThrow('swap-photo');
    expect(await nothing()).toEqual([0, 0, 19]);
    expect([on(body), on(side)]).toEqual([true, false]);
  });

  // A file that is gone, or is no file, is refused by the check of who owns it, before it is measured; one that is there and cannot be read is the one left.
  it.skipIf(process.getuid?.() === 0)('a stored photograph that is there and cannot be read starts none either, as a full-body photograph or as a face: nothing is charged, no run is made, and it is deleted', async () => {
    const body = await upload(pngOf(MIN, MIN + 1)), face = await upload(pngOf(MIN, MIN + 1)), fine = await upload(pngOf(MIN, MIN + 1));
    chmodSync(join(dir, body), 0o000);
    await expect(start(body, null)).rejects.toThrow('swap-photo');
    chmodSync(join(dir, face), 0o000);
    await expect(start(fine, face)).rejects.toThrow('swap-photo');
    expect(await nothing()).toEqual([0, 0, 19]);
    expect([on(body), on(face), on(fine)]).toEqual([false, false, true]);
  });

  it.skipIf(process.getuid?.() === 0)('a stored side photograph that is there and cannot be read starts none either: nothing is charged, no run is made, and only it is deleted', async () => {
    const side = await upload(pngOf(MIN, MIN + 1)), fine = await upload(pngOf(MIN, MIN + 1));
    chmodSync(join(dir, side), 0o000);
    await expect(start(fine, null, 'key-1', side)).rejects.toThrow('swap-photo');
    expect(await nothing()).toEqual([0, 0, 19]);
    expect([on(side), on(fine)]).toEqual([false, true]);
  });

  it('a photograph of a person that says its size is stored, and the job starts with it', async () => {
    const body = await data.uploads.save('usr-demo', new File([pngOf(MIN, MIN + 1) as BlobPart], 'me.png'), 'person');
    expect((await start(body, null)).status).toBe('running');
  });

  it('a product photograph is stored as before: its first bytes decide', async () => {
    expect(await upload(UNMEASURED[0]![1])).toMatch(/^uploads\/[0-9a-f-]{36}\/1\.png$/);
  });
});
