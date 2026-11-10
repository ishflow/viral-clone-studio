// The paid requests of one variant: which ones (by the template alone), and what each one asks (with the fill).
// Pure. Every file a request names is known before anything is sent, so a whole run can be shown to the provider's
// `refusal` before the first payment.
import type { Paid } from '../contracts.ts';
import type { OperationRow } from '../db/runs.ts';
import { abs, rel } from '../paths.ts';
import type { PaidRequest, Tier } from '../ports.ts';
import { parseScript, photographsFor } from '../resolve/index.ts';
import { clipShots } from '../template/clips.ts';
import { billedSeconds } from '../template/limits.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { imageOf } from '../template/values.ts';
import type { Faulty } from './types.ts';

export type Kind = OperationRow['kind'];

/** One paid request of a variant, as the template alone tells it: what `missing` and the count are made of. */
export interface Need {
  n: number;                // the variant, 1-based
  key: string;              // the operation key of its first attempt: 'v1:image:s1', 'v1:image:presenter', 'v1:clip:s1', 'v1:music', 'v1:voice'
  kind: Kind;
  id: string | null;        // image: shot id (beats), 'presenter' (speech) or still id · clip: shot id · music, voice: null (a shot id: of a shot that owns a clip)
  seconds: number;          // what a clip bills; 0 for the others
  file: string;             // where its file goes, under data/
}
/** A need with what is sent for it. `needs`: the keys whose files this request reads. */
export interface Planned extends Need { paid: PaidRequest; needs: string[] }

const EXTENSION: Record<Kind, string> = { image: '.png', clip: '.mp4', music: '.mp3', voice: '.mp3' };
const PRESENTER = 'presenter';

/** The paid requests of variant `n`, in the order of their steps. Their count is `paidFor(template, 1)`. */
export function needsOf(template: TemplateJson, runId: string, n: number): Need[] {
  const need = (kind: Kind, id: string | null, seconds = 0): Need => ({
    n, key: id === null ? `v${n}:${kind}` : `v${n}:${kind}:${id}`, kind, id, seconds,
    file: rel('jobs', runId, 'paid', `v${n}`, `${id === null ? kind : `${kind}-${id}`}${EXTENSION[kind]}`),
  });
  // only a shot that owns a clip is a request: a shot that continues a clip shows a part of the owner's file
  const owners = clipShots(template);
  const clips = owners.map((shot) => need('clip', shot.id, billedSeconds(shot.clip_seconds)));
  const stills = (template.stills ?? []).map((still) => need('image', still.id));
  // a still stands before every image that is made from it
  if (template.mode === 'beats') return [...stills, ...owners.map((shot) => need('image', shot.id)), ...clips, need('music', null)];
  return [need('image', PRESENTER), ...stills, need('voice', null), ...clips, need('music', null)];
}

export function countOf(needs: Need[]): Paid {
  const of = (kind: Kind) => needs.filter((need) => need.kind === kind);
  return {
    images: of('image').length, clips: of('clip').length, clipSeconds: of('clip').reduce((sum, need) => sum + need.seconds, 0),
    music: of('music').length, voice: of('voice').length,
  };
}

/**
 * The request with the files of earlier requests under their real names. `moved`: the planned place of a file
 * (absolute) → where it is, for every paid file that was renamed by what it is.
 */
export function withFiles(item: Planned, moved: Map<string, string>): Planned {
  if (moved.size === 0) return item;
  const real = (file: string): string => moved.get(file) ?? file;
  const { paid } = item;
  if (paid.kind === 'image') return { ...item, paid: { kind: 'image', request: { ...paid.request, references: paid.request.references.map(real) } } };
  if (paid.kind !== 'clip') return item;
  const request = paid.request.mode === 'first-frame'
    ? { ...paid.request, firstFrame: real(paid.request.firstFrame) }
    : { ...paid.request, presenter: real(paid.request.presenter), voice: real(paid.request.voice) };
  return { ...item, paid: { kind: 'clip', request } };
}

/** The products a beats shot names, as picture references: the first photograph of each, of every product the customer gave for "all". */
export function referencesOfShot(products: string[], fill: FillJson): string[] {
  return products.includes('all') ? fill.products.map((_, i) => `product:${i + 1}`) : products.map((product) => `product:${product}`);
}

/** The request of a variant (`needs`: its own) that made a file the picture side names as faulty; undefined when the variant has none such. */
export function needOfFaulty(template: TemplateJson, needs: Need[], faulty: Faulty): Need | undefined {
  // a clip of a speech variant is named by its segment, as in VariantMedia.clips; its request by its shot
  const id = faulty.kind === 'music' || faulty.kind === 'voice' ? null
    : faulty.kind === 'clip' && template.mode === 'speech' ? template.shots.find((shot) => shot.segment === faulty.id)?.id
      : faulty.id;
  return id === undefined ? undefined : needs.find((need) => need.kind === faulty.kind && need.id === id);
}

/** '9:16' for both canvases. */
function aspectOf(canvas: TemplateJson['canvas']): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(canvas.width, canvas.height);
  return `${canvas.width / d}:${canvas.height / d}`;
}

const own = <T>(record: Record<string, T> | undefined, id: string): T | undefined => (record !== undefined && Object.hasOwn(record, id) ? record[id] : undefined);

/** Something the fill must hold: checkFill has passed before a plan is made, so a gap here is a fault of the pipeline. */
function held<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the fill has no ${what}`);
  return value;
}

/**
 * What is sent for each need of variant `n`. Expects a fill that passed `checkFill`. Files are absolute: the customer's
 * photographs under uploads/, and the files of earlier requests of the same variant at the places `needsOf` gives them.
 */
export function planOf(template: TemplateJson, fill: FillJson, runId: string, n: number, tier: Tier): Planned[] {
  const needs = needsOf(template, runId, n);
  const aspect = aspectOf(template.canvas);
  const needOf = (kind: Kind, id: string | null): Need => {
    const found = needs.find((need) => need.kind === kind && need.id === id);
    if (found === undefined) throw new Error(`variant ${n} has no ${kind} request${id === null ? '' : ` "${id}"`}`);
    return found;
  };
  const photographs = (references: string[]) => photographsFor(references, fill).map((file) => abs(file));
  const productsOf = (products: string[]) => referencesOfShot(products, fill);

  return needs.map((need): Planned => {
    if (need.kind === 'music') return { ...need, needs: [], paid: { kind: 'music', request: { prompt: fill.music.prompt } } };
    if (need.kind === 'voice') {
      const voice = held(template.presenter, 'presenter in its template').voice;
      return { ...need, needs: [], paid: { kind: 'voice', request: { text: voice.sample_text, voiceId: voice.voice_id } } };
    }
    const shot = template.shots.find((candidate) => candidate.id === need.id);
    if (need.kind === 'clip') {
      const prompts = held(own(fill.shots, shot!.id), `shots.${shot!.id}`);
      if (template.mode === 'beats') {
        const first = needOf('image', shot!.id);
        return { ...need, needs: [first.key], paid: { kind: 'clip', request: { mode: 'first-frame', firstFrame: abs(first.file), prompt: prompts.motion_prompt, seconds: need.seconds, tier } } };
      }
      const presenter = needOf('image', PRESENTER), voice = needOf('voice', null);
      const words = parseScript(held(own(fill.script, shot!.segment ?? ''), `script.${shot!.segment}`)).words.join(' ');
      return {
        ...need, needs: [presenter.key, voice.key],
        paid: { kind: 'clip', request: {
          mode: 'speaker', presenter: abs(presenter.file), voice: abs(voice.file),
          prompt: `${prompts.motion_prompt}\n\nSpoken to the camera, word for word: "${words}"`, seconds: need.seconds, tier, aspect,
        } },
      };
    }
    // an image
    if (template.mode === 'beats' && shot !== undefined) {
      const prompt = held(own(fill.shots, shot.id)?.still_prompt, `shots.${shot.id}.still_prompt`);
      // the first frame of a shot is made from the stills the shot names, in that order, then from the photographs of its products
      const stills = (shot.stills ?? []).map((id) => needOf('image', id));
      return {
        ...need, needs: stills.map((still) => still.key),
        paid: { kind: 'image', request: { prompt, references: [...stills.map((still) => abs(still.file)), ...photographs(productsOf(shot.products))], aspect } },
      };
    }
    if (template.mode === 'speech' && need.id === PRESENTER) {
      const prompt = held(fill.presenter?.still_prompt, 'presenter.still_prompt');
      return { ...need, needs: [], paid: { kind: 'image', request: { prompt, references: photographs(template.presenter?.references ?? []), aspect } } };
    }
    const still = (template.stills ?? []).find((candidate) => candidate.id === need.id)!;
    const prompt = held(own(fill.stills, still.id), `stills.${still.id}`).prompt;
    // a still may be made from the customer's photographs and from stills listed before it, in the order the template names them
    const from = still.references.map((reference) => {
      const image = imageOf(reference);
      return image.kind === 'still' ? needOf('image', image.id) : photographs([reference])[0];
    });
    const references = from.flatMap((source) => (source === undefined ? [] : [typeof source === 'string' ? source : abs(source.file)]));
    return {
      ...need, needs: from.flatMap((source) => (typeof source === 'object' ? [source.key] : [])),
      paid: { kind: 'image', request: { prompt, references: [...new Set(references)], aspect } },
    };
  });
}
