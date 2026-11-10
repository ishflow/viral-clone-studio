// Test helpers of produce: a data folder in a temp dir, the two golden templates on disk, a claimed run.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { FakeGenerator } from '../adapters/fakes.ts';
import type { FakeGeneratorOptions } from '../adapters/fakes.ts';
import type { Paid, RunInput } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { claim, enqueue, getRun } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { abs } from '../paths.ts';
import type { Clock, Generated, MediaFacts } from '../ports.ts';
import { paidFor } from '../template/estimate.ts';
import { Fill, Template } from '../template/schema.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';

export type ProduceInput = Extract<RunInput, { kind: 'produce' }>;

const read = (id: string, file: string): unknown => JSON.parse(readFileSync(new URL(`../resolve/golden/${id}/${file}.json`, import.meta.url), 'utf8'));

/** A golden template and its fill: `layering-01` (beats, 5 shots, 4 products) or `lashly-01` (speech, 3 segments, 2 stills). */
export function golden(id: 'layering-01' | 'lashly-01'): { template: TemplateJson; fill: FillJson } {
  return { template: Template.parse(read(id, 'template')), fill: Fill.parse(read(id, 'fill')) };
}

/** `layering-01` with a person who returns: one generated still, "lead", that the first frames of shots 2, 3 and 5 are made from. `replace`: as in `goldenWith`. */
export function goldenWithStill(replace: (json: string) => string = (json) => json): { template: TemplateJson; fill: FillJson } {
  const { template, fill } = goldenWith('layering-01', replace);
  return {
    template: Template.parse({
      ...template,
      shots: template.shots.map((shot, i) => ([1, 2, 4].includes(i) ? { ...shot, stills: ['lead'] } : shot)),
      stills: [{ id: 'lead', prompt: 'A woman in her twenties, front-facing, from the waist up, in a cream knit jumper. Even light, plain background, no text.', references: [] }],
    }),
    fill: Fill.parse({ ...fill, stills: { lead: { prompt: 'A woman in her twenties with dark shoulder-length hair, front-facing, from the waist up, in a cream knit jumper. Even light, plain background, no text.' } } }),
  };
}

/**
 * `layering-01` where shots 2 and 3 continue the clip of shot 1 (`continues`): three shots own a clip (s1, s4, s5), three
 * images and three clips per variant. The clip of s1 is asked for 5 s (150 frames) and its parts show 39 + 48 + 38 = 125 of them.
 */
export function goldenWithParts(): { template: TemplateJson; fill: FillJson } {
  const { template, fill } = golden('layering-01');
  const shots = template.shots.map((shot, i) => {
    if (i === 0) return { ...shot, clip_seconds: 5 };
    if (i > 2) return shot;
    const { still_prompt: _still, motion_prompt: _motion, clip_seconds: _seconds, in: _in, ...part } = shot;
    return { ...part, products: [], continues: 's1' };
  });
  const { s2: _s2, s3: _s3, ...prompts } = fill.shots;
  return { template: Template.parse({ ...template, shots }), fill: Fill.parse({ ...fill, shots: prompts }) };
}

/**
 * `goldenWithParts` with a person who returns: the still "lead" is named by the owners s1 and s4 (a part names none), s5
 * is made from the photographs alone. Three images and three clips per variant plus the still.
 */
export function goldenWithPartsAndStill(): { template: TemplateJson; fill: FillJson } {
  const { template, fill } = goldenWithParts();
  const still = goldenWithStill();
  return {
    template: Template.parse({ ...template, stills: still.template.stills, shots: template.shots.map((shot) => (['s1', 's4'].includes(shot.id) ? { ...shot, stills: ['lead'] } : shot)) }),
    fill: Fill.parse({ ...fill, stills: still.fill.stills }),
  };
}

/** A golden whose template and fill went through the same text replace (other ids), read by the schemas again. */
export function goldenWith(id: 'layering-01' | 'lashly-01', replace: (json: string) => string): { template: TemplateJson; fill: FillJson } {
  const { template, fill } = JSON.parse(replace(JSON.stringify({ template: read(id, 'template'), fill: read(id, 'fill') }))) as { template: unknown; fill: unknown };
  return { template: Template.parse(template), fill: Fill.parse(fill) };
}

/** The first bytes of a real file of each kind (a PNG, an MP4, an MP3): what a generator delivers, for a fake that writes files. */
export const MEDIA: Record<'image' | 'clip' | 'music' | 'voice', Buffer> = {
  image: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  clip: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(12)]),
  music: Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 0x23]), Buffer.alloc(8)]),
  voice: Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 0x23]), Buffer.alloc(8)]),
};

/** Other first bytes: what a provider may deliver under a name that says something else. */
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
export const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
export const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WAVEfmt ')]);

type MediaKind = 'image' | 'clip' | 'music' | 'voice';
/** What file a request gets: the kind asked, its number among the calls of that kind (0 for a `resume`), the path it is written to. */
export type Delivery = (kind: MediaKind, n: number, to: string) => Buffer | string;

/**
 * The in-memory fake generator, delivering files that are what their kind says (`MEDIA`), or what `delivery` gives.
 * Scripted like `FakeGenerator`; every answer of a kind must be scripted (`answers`) as there.
 */
export class MediaGenerator extends FakeGenerator {
  private delivery: Delivery;
  private made: Record<string, number> = {};
  constructor(options: FakeGeneratorOptions = {}, delivery: Delivery = (kind) => MEDIA[kind]) {
    super({ ...options, writeFiles: false });
    this.delivery = delivery;
  }
  private deliver(kind: MediaKind, counted: boolean, out: Generated): Generated {
    const n = counted ? (this.made[kind] = (this.made[kind] ?? 0) + 1) : 0;
    mkdirSync(dirname(out.file), { recursive: true });
    writeFileSync(out.file, this.delivery(kind, n, out.file));
    return out;
  }
  private count(kind: MediaKind): void { this.made[kind] = (this.made[kind] ?? 0) + 1; }
  override async image(...args: Parameters<FakeGenerator['image']>) { try { return this.deliver('image', true, await super.image(...args)); } catch (error) { this.count('image'); throw error; } }
  override async clip(...args: Parameters<FakeGenerator['clip']>) { try { return this.deliver('clip', true, await super.clip(...args)); } catch (error) { this.count('clip'); throw error; } }
  override async music(...args: Parameters<FakeGenerator['music']>) { try { return this.deliver('music', true, await super.music(...args)); } catch (error) { this.count('music'); throw error; } }
  override async voice(...args: Parameters<FakeGenerator['voice']>) { try { return this.deliver('voice', true, await super.voice(...args)); } catch (error) { this.count('voice'); throw error; } }
  override async resume(ticket: string, to: string) {
    const out = await super.resume(ticket, to);
    const name = to.split('/').pop()!;
    return this.deliver(name.startsWith('image') ? 'image' : name.startsWith('clip') ? 'clip' : name.startsWith('voice') ? 'voice' : 'music', false, out);
  }
}

/** A fresh data folder (VC_DATA_DIR) with an empty database. */
export function workspace(): { dir: string; db: DatabaseSync } {
  const dir = mkdtempSync(join(tmpdir(), 've-produce-'));
  process.env.VC_DATA_DIR = dir;
  return { dir, db: openDb(join(dir, 'db.sqlite')) };
}

export function put(file: string, content: string | Uint8Array): void {
  mkdirSync(dirname(abs(file)), { recursive: true });
  writeFileSync(abs(file), content);
}

/** A whole PNG of one pixel: a photograph the real tools can read. */
export const PHOTOGRAPH = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** The template in its folder and the customer's photographs under uploads/. */
export function seed(template: TemplateJson, fill: FillJson): void {
  put(`templates/${template.id}/template.json`, JSON.stringify(template));
  for (const product of fill.products) for (const image of product.images) put(image, PHOTOGRAPH);
}

/** What a fake `Media.probe` answers for each photograph of the fill, by its absolute path. */
export function probesOf(fill: FillJson): Record<string, MediaFacts> {
  const facts: MediaFacts = { width: 1024, height: 1024, fps: 25, frames: 1, seconds: 0.04, audio: false };
  return Object.fromEntries(fill.products.flatMap((product) => product.images).map((image) => [abs(image), facts]));
}

export function inputOf(template: TemplateJson, fill: FillJson, variants: 1 | 2 | 3, more: Partial<ProduceInput> = {}): ProduceInput {
  return {
    kind: 'produce', templateId: template.id, quality: 'fast', variants, language: fill.language, sample: false,
    products: fill.products.map((product) => ({ name: product.name, description: `About ${product.name}.`, images: product.images })),
    ...more,
  };
}

/** What the adapting model answers for this fill: everything but the language and the products, once per variant. */
export function answerOf(fill: FillJson, variants: number): { fills: unknown[] } {
  const { language: _language, products: _products, ...rest } = fill;
  return { fills: Array.from({ length: variants }, () => structuredClone(rest)) };
}

/** A run of the queue, claimed: what the worker hands to the handler. `approved`: by default exactly the need. */
export function startRun(db: DatabaseSync, clock: Clock, template: TemplateJson, input: ProduceInput, approved: Paid | null = paidFor(template, input.variants)): RunRow {
  const id = enqueue(db, input, `job-${Math.random().toString(36).slice(2)}`, approved, clock.now());
  claim(db, 'worker-test', clock.now());
  return getRun(db, id)!;
}

/** What the site does when the customer continues a stopped run: it approves what is missing and queues the run; the worker claims it. */
export function resumeRun(db: DatabaseSync, clock: Clock, id: string): RunRow {
  const run = getRun(db, id)!;
  const add = run.missing ?? { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
  const was = run.approved ?? { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
  const approved: Paid = {
    images: was.images + add.images, clips: was.clips + add.clips, clipSeconds: was.clipSeconds + add.clipSeconds,
    music: was.music + add.music, voice: was.voice + add.voice,
  };
  db.prepare(`UPDATE runs SET approved = ?, state = 'queued' WHERE id = ?`).run(JSON.stringify(approved), id);
  claim(db, 'worker-test', clock.now());
  return getRun(db, id)!;
}
