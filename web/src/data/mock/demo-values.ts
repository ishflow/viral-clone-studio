// DEMO VALUES so the flows run. Not product decisions.
import type { CreditPack, Format, Quality, StepKey, StopDetail, StopReason, Template } from '../ports';

/** Credit packs and prices of the flow contract §1.1 (a proposal: not for sale before the cost is measured, B21). */
export const PACKS: CreditPack[] = [
  { id: 'pack-starter', name: 'Starter', credits: 10, price: '$19', priceCents: 1900 },
  { id: 'pack-standard', name: 'Standard', credits: 30, price: '$54', priceCents: 5400 },
  { id: 'pack-studio', name: 'Studio', credits: 100, price: '$169', priceCents: 16900 },
];

/** Credits one variant of a video costs (flow contract §1.2, B9). */
export const JOB_COST: Record<Format, Record<Quality, number>> = {
  'no-talking': { fast: 2, best: 5 },
  talking: { fast: 4, best: 8 },
};

/** Credits for every started `RULES.swapBlockSeconds` seconds of a person swap (plan §2: a proposal until the provider's cost is measured). */
export const SWAP_COST: Record<Quality, number> = { fast: 1, best: 2 };

/** US cents as the invoice and the purchase show them: '$54.00'. */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Job cost in credits: the table value × variants. Refuses a variant count outside 1–3. */
export function jobCost(format: Format, quality: Quality, variants: number): number {
  if (variants !== 1 && variants !== 2 && variants !== 3) throw new RangeError('invalid-variants');
  return JOB_COST[format][quality] * variants;
}

// From here on: the values of the fake engine (`../engine/fake.ts`) and of the fixtures. The site's own code asks `engine()` instead.

/** Numbers of the estimate: seconds per clip, and minutes one variant takes. */
export const CLIP_SECONDS = 4;
export const JOB_MINUTES: Record<Format, number> = { 'no-talking': 7, talking: 12 };

/** The steps in the order the job page shows them. */
export const STEP_KEYS: StepKey[] = ['adaptation', 'images', 'clips', 'music', 'edit', 'render'];
/** Seconds each step of the fake job takes: 40 s in total. `VC_FAKE_SPEED` multiplies the speed. */
export const STEP_SECONDS: Record<StepKey, number> = { adaptation: 4, images: 8, clips: 14, music: 4, edit: 4, render: 6 };
/** The order the fake job works in. Music is made before the clips, so it is done while the clips come in (as on the job boards). */
export const STEP_RUN_ORDER: StepKey[] = ['adaptation', 'images', 'music', 'clips', 'edit', 'render'];

/** Seconds until a template made from the user's own video is ready. `VC_FAKE_SPEED` multiplies the speed here too. */
export const PREPARE_SECONDS = 20;

/** Seconds a scan started with "Run a scan now" takes. `VC_FAKE_SPEED` multiplies the speed here too. */
export const SCAN_SECONDS = 30;

/** A job on this template always stops at the clips step, with `STOP_CLIPS.done` of every `STOP_CLIPS.of` clips ready. */
export const STOP_TEMPLATE_ID = 'tpl-stop';
export const STOP_REASON: StopReason = 'clips-failed';
export const STOP_CLIPS = { done: 3, of: 5 };
/**
 * A job on the stop template with more than one variant delivers all but its last variant; the last one stops (B2).
 * A job any of whose product names or descriptions holds this text is stopped by the content rules at the adaptation step (B12).
 */
export const CONTENT_RULE_MARK = 'content-rule-test';
/**
 * "Add your own video" in the fake: a link holding one of these words is refused with that reason before anything is charged,
 * and a link holding `split-screen` is charged and then cannot be prepared (the credit comes back).
 */
export const LINK_REFUSALS = ['private', 'removed', 'link-not-found'] as const;
export const SPLIT_SCREEN_MARK = 'split-screen';

/** The steps of a person swap, in the order the job page shows them and the fake works in: the parts, the join, the sound and the label. */
export const SWAP_STEP_KEYS: StepKey[] = ['clips', 'edit', 'render'];
/**
 * Person swap in the fake: a job one of whose photographs has one of these words in its name stops halfway through its parts, with
 * that detail (null: a part that failed, which a resume makes again).
 */
export const SWAP_STOP_MARKS: readonly (readonly [mark: string, detail: StopDetail | null])[] = [
  ['photo-refused-test', 'photo-refused'], ['person-missing-test', 'person-missing'], ['swap-stop-test', null],
];
/** The person-swap video of the fixtures: one person, 12 seconds in two parts, with sound. */
export const SWAP_TEMPLATE_ID = 'tpl-swap';
export function swapTemplateFixture(editedAt: string): Template {
  const image = '/samples/1377349dbc87784232ac59cf9cf04986.jpg';
  return {
    id: SWAP_TEMPLATE_ID, title: 'Walk to the camera', category: 'Person swap', format: 'no-talking', seconds: 12, referenceViews: '',
    referenceLikes: null, referenceImage: image, referenceVideo: null, image, video: null, products: 0, shots: [], status: 'published',
    ownerId: null, timesGenerated: 0, editedAt, source: 'link', description: 'One person walks to the camera and turns.', tags: [],
    preparation: null, preparationNote: null, sample: 'none',
    swap: {
      people: 1, sound: true,
      persons: [{ slot: 1, box: { left: 30, top: 12, right: 70, bottom: 96 }, hint: 'the woman in the white shirt' }],
      parts: [{ n: 1, from: 0, to: 6 }, { n: 2, from: 6, to: 12 }],
    },
  };
}
