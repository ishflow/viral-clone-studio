// Nothing known before payment may fail after it. What is checked before the first paid request of a run:
// the fill and a dry edit on placeholder media (the customer's copy decides whether a text fits), every request
// against the provider's own rules and the disk, and the count against what the customer approved.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { MediaError } from '../adapters/media.ts';
import { compose, ComposeError } from '../compose/index.ts';
import type { Paid } from '../contracts.ts';
import { parseEdit } from '../edit/schema.ts';
import { abs } from '../paths.ts';
import type { Generator, Media, PaidRequest } from '../ports.ts';
import { checkFill, photographsFor, pictureGiven, resolve, ResolveError } from '../resolve/index.ts';
import type { FillNote } from '../resolve/index.ts';
import { placeholderFacts, placeholderMedia } from '../resolve/placeholder.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { imageOf } from '../template/values.ts';
import { referencesOfShot } from './plan.ts';
import type { Planned } from './plan.ts';

/**
 * The fill against the template, then the edit it would give with media that stands in for the paid media, composed
 * but not written. `problems`: why this fill cannot become a video (empty: it can). `notes`: what this customer will
 * not see because a product or a photograph was not given.
 */
export function dryRun(template: TemplateJson, fill: FillJson): { problems: string[]; notes: FillNote[] } {
  const { errors, notes } = checkFill(template, fill);
  if (errors.length > 0) return { problems: errors.map((error) => `${error.code}: ${error.message}`), notes };
  try {
    const media = placeholderMedia(template, fill);
    const parsed = parseEdit(resolve(template, fill, media));
    if (!parsed.ok) return { problems: parsed.issues.map((issue) => `${issue.code}: ${issue.path}: ${issue.message}`), notes };
    compose(parsed.edit, placeholderFacts(parsed.edit, media));
  } catch (error) {
    if (error instanceof ComposeError) return { problems: error.issues.map((issue) => `${issue.code}: ${issue.path}: ${issue.message}`), notes };
    if (error instanceof ResolveError) return { problems: [`${error.code}: ${error.message}`], notes };
    throw error;
  }
  return { problems: [], notes };
}

/** The local files a request reads. */
function filesOf(paid: PaidRequest): string[] {
  if (paid.kind === 'image') return paid.request.references;
  if (paid.kind !== 'clip') return [];
  return paid.request.mode === 'first-frame' ? [paid.request.firstFrame] : [paid.request.presenter, paid.request.voice];
}

/**
 * Why the requests of a variant must not be sent, or null: a key used twice; and for every request that `sending`
 * says will be sent now, a file it reads that is neither on the disk nor made by a request before it, or the
 * generator's own refusal (models, lengths, counts, ratios). The generator is asked about every such request; nothing is sent.
 */
export function requestProblem(generator: Generator, items: Planned[], sending: (item: Planned) => boolean = () => true): string | null {
  const made = new Set<string>(), keys = new Set<string>();
  for (const item of items) {
    if (keys.has(item.key)) return `${item.key}: two requests of the run have this key: it would be paid for twice`;
    keys.add(item.key);
    if (sending(item)) {
      const lost = filesOf(item.paid).find((file) => !made.has(file) && !existsSync(file));
      if (lost !== undefined) return `${item.key}: it reads ${basename(lost)}, which is not there`;
      const refused = generator.refusal(item.paid);
      if (refused !== null) return `${item.key}: ${refused}`;
    }
    made.add(abs(item.file));
  }
  return null;
}

/** Is every field of `need` inside `approved`? Nothing is approved for a run without an approval. */
export function within(need: Paid, approved: Paid | null): boolean {
  return approved !== null && need.images <= approved.images && need.clips <= approved.clips && need.clipSeconds <= approved.clipSeconds
    && need.music <= approved.music && need.voice <= approved.voice;
}

export function plus(a: Paid, b: Paid): Paid {
  return { images: a.images + b.images, clips: a.clips + b.clips, clipSeconds: a.clipSeconds + b.clipSeconds, music: a.music + b.music, voice: a.voice + b.voice };
}

/**
 * The customer's photographs this run uses, each once: what a paid request is made from (a beats shot's products, the
 * presenter's and the stills' references; a photograph the customer did not give falls back to the product's first)
 * and what a card or a window shows (left out when it was not given).
 */
export function photographsUsed(template: TemplateJson, fill: FillJson): { product: number; file: string }[] {
  const paid = [
    ...(template.mode === 'beats' ? template.shots.flatMap((shot) => referencesOfShot(shot.products, fill)) : []),
    ...(template.presenter?.references ?? []), ...(template.stills ?? []).flatMap((still) => still.references),
  ];
  const shown = [...(template.cards ?? []).map((card) => card.image), ...(template.windows ?? []).map((window) => window.behind)]
    .filter((reference) => imageOf(reference).kind === 'product' && pictureGiven(reference, fill));
  const files = [...new Set([...photographsFor(paid, fill), ...photographsFor(shown, fill)])];
  return files.map((file) => ({ product: fill.products.findIndex((product) => product.images.includes(file)) + 1, file }));
}

/**
 * Reads every photograph the run uses (`Media.probe`): it must be there, be a picture the tools can read, and have a
 * width and a height. The first one that is not, as a line that names the product and the file; null when all are.
 * A tool that does not run is thrown on: that is not the photograph's fault.
 */
export async function unreadablePhotograph(media: Media, template: TemplateJson, fill: FillJson): Promise<string | null> {
  for (const { product, file } of photographsUsed(template, fill)) {
    const of = `product ${product} ("${fill.products[product - 1]?.name ?? ''}"): ${file}`;
    try {
      const facts = await media.probe(abs(file));
      if (!(facts.width > 0 && facts.height > 0)) return `${of} is not a picture with a width and a height`;
    } catch (error) {
      if (error instanceof MediaError && error.code !== 'tool-failed') return `${of} cannot be read as a picture: ${error.message}`;
      throw error;
    }
  }
  return null;
}
