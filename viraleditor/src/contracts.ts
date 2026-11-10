import type { Outfit } from './ports.ts';

export type Quality = 'fast' | 'best';
export type Format = 'no-talking' | 'talking';
export type StepKey = 'adaptation' | 'images' | 'clips' | 'music' | 'edit' | 'render';
export type StepStatus = 'waiting' | 'running' | 'done' | 'stopped';
export interface Step { key: StepKey; status: StepStatus; done: number; total: number }
/** One variant of a produce run: the unit of delivery. `video` and `image` are paths under data/, set when the variant is done; `reason` when it stopped. */
export interface VariantState { n: number; status: StepStatus; video: string | null; image: string | null; reason: StopReason | null }

/** Paid requests. `clipSeconds` is what the provider bills (a clip shorter than 4 s bills 4 s). */
export interface Paid { images: number; clips: number; clipSeconds: number; music: number; voice: number }

/** `image`: the frame of the reference in the middle of the shot (a path under data/), when one was taken; a card written before has none. */
export interface CardShot { n: number; from: number; to: number; action: string; text: string; product: number | null; image?: string | null }
/**
 * One person of a person-swap video. `slot`: the number on the person's box, from 1. `box`: where the person stands on the still the
 * site shows, in percent of the frame (right and bottom are edges). `hint`: a short English description the model finds the person
 * by ("the woman on the left in a red dress").
 */
export interface SwapSlot { slot: number; box: { left: number; top: number; right: number; bottom: number }; hint: string }
/** One part of a person-swap video, asked for with one paid request: seconds of the source video, `n` from 1. */
export interface SwapPart { n: number; from: number; to: number }
/** What the card of a person-swap video carries (its swap.json: template/swap-schema.ts). `sound`: the video has sound, which the finished video keeps. */
export interface CardSwap { people: 1 | 2; persons: SwapSlot[]; parts: SwapPart[]; sound: boolean }
export interface Card {
  referenceImage?: string | null; referenceVideo?: string | null;
  referenceMetric?: { count: number; kind: 'likes' | 'views' };
  title: string; category: string; format: Format; seconds: number; referenceViews: string;
  image: string | null; video: string | null;          // paths under data/, null until there is a poster / a sample
  products: number; shots: CardShot[]; description: string; tags: string[];
  swap?: CardSwap;                                      // a person-swap video: the people of its own video are replaced, no shot is generated; every other card has none
}

export interface Product { name: string; description: string; images: string[] }   // images: paths under data/uploads
/** The photographs a customer gave for the person of one slot: paths under data/uploads. `face`: a close photograph of the face, when one was given. `side`: one taken from the side, when one was given (a run written before there was one has none). */
export interface SwapPhotos { slot: number; body: string; face: string | null; side?: string }
/** The part of a long video a customer picked, in seconds of that video. */
export interface SourceRange { from: number; to: number }
/**
 * `ownerId` of a produce run: the customer the job is of, for the order of the produce lane; a run written before has none.
 * `swap` of a produce run: the run replaces the people of a person-swap template with these (one entry per slot of its card), the person
 * wearing the clothes of the video (`keep`, also when `outfit` is left out) or of the photograph (`photo`); then
 * `variants` is 1, `products` is [] and `sample` is false. The row stays a `produce` row: its queue, caps and refunds are the same.
 * `mode` of a prepare run: `swap` makes a person-swap template of the video (its parts and swap.json, no shot); without it, a product template as before.
 * `swap` of an edit run: the people an admin set for a person-swap template (the box and the words of each); the worker checks them and
 * writes them into its swap.json and its card (swap/edit.ts). An edit run without it changes a product template as before.
 */
export type RunInput =
  | { kind: 'produce'; templateId: string; ownerId?: string | null; quality: Quality; variants: 1 | 2 | 3; language: string; products: Product[]; sample: boolean; swap?: { people: SwapPhotos[]; outfit?: Outfit } }
  | { kind: 'prepare'; templateId: string; ownerId: string | null; mode?: 'swap'; from: { kind: 'link'; url: string; range?: SourceRange } | { kind: 'candidate'; candidateId: string; force: boolean } | { kind: 'upload'; uploadId: string; sha256?: string; range?: SourceRange } }
  | { kind: 'scan'; source: 'topads' | 'shorts'; trigger: 'schedule' | 'manual' }
  | { kind: 'edit'; templateId: string; card: Pick<Card, 'title' | 'category' | 'products' | 'shots' | 'description' | 'tags'>; shotsChanged?: boolean; sampleChangedBefore?: string | null; swap?: { persons: SwapSlot[] } };
export type RunResult =
  | { kind: 'produce'; variants: { video: string; image: string }[] }
  | { kind: 'prepare'; state: 'ready' | 'failed'; note: string | null }
  | { kind: 'scan'; checked: number; aboveThreshold: number; prepared: number }
  | { kind: 'edit'; ok: boolean; note: string | null };

export type StopReason =
  | 'adaptation-failed' | 'images-failed' | 'clips-failed' | 'audio-failed' | 'render-failed'
  | 'submission-unknown' | 'estimate-exceeded' | 'llm-invalid' | 'template-missing' | 'engine-error';
export type PrepareNote = 'below-threshold' | 'unsupported' | 'split-screen' | 'too-long' | 'check-failed' | 'source-unavailable' | 'llm-invalid' | 'daily-cap' | 'bad-range';
export type ScanReason = 'source-unavailable' | 'scan-failed' | 'no-matching-industry';

export interface Settings {
  scanTimes: string[];                                   // 'HH:MM', local time; default ['09:00','15:00','21:00']
  sources: { topads: boolean; shorts: boolean };         // default both true
  searches: string[];                                    // Shorts hashtag list (a phrase is joined into one tag); default []
  threshold: number;                                     // 0–100; default 70
  dailyCandidates: number;                               // default 45
  dailyTemplates: number;                                // default 10
  secondsMin: number; secondsMax: number;                // default 6, 35
  shortsMinViews: number;                                // default 500000
  topAdsIndustry?: string;                               // default beauty-personal-care; optional for old installations
  topAdsCountry?: string;                                // default US
  topAdsPeriod?: 7 | 30 | 180;                            // default 7 days
  topAdsCards: number;                                   // default 30
  perScan: number;                                       // default 15
  tiers: Record<Quality, { model: string; resolution: string }>;   // default fast: seedance-2-mini 720p · best: seedance-2.5-pro 1080p
}
/**
 * `note`: what is not set up on this machine (a key, a cap, the renderer); the site reads any note as "the provider is not configured".
 * `noCredits`: the provider is on hold for its credits (robust/provider-credits.ts), in words; null when it is not. It is not a
 * note: the key is set and the account is empty. A row written before the field existed has none.
 */
/** `swap`: the person-swap provider of this worker, apart from the product provider and its note. `fake`: the pretend one; `not-configured`: none this worker can ask, and `swapNote` says why in the worker's words (which variable). Both absent in a row an older worker wrote. */
export interface Health { workerAt: string; provider: 'fake' | 'magnific'; renderer: 'ready' | 'not-ready'; note: string | null; noCredits?: string | null; swap?: 'fake' | 'ready' | 'not-configured'; swapNote?: string | null }
