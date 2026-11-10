import type { Format, Outfit, Paid, PreparationNote, Quality, ScanStopReason, SourceRange, StepKey, StepStatus, StopDetail, StopReason, SwapPhotos, TemplateSwap } from '../ports';

// The site's copy of the engine's row shapes (`viraleditor/src/contracts.ts` and `viraleditor/schema.sql`).
// The site may not import the engine's code: when a column changes there, it changes here too.

export interface Step { key: StepKey; status: StepStatus; done: number; total: number }
/** One variant of a produce run. `video` and `image` are paths under the data directory, set when the variant is done. */
export interface VariantState { n: number; status: StepStatus; video: string | null; image: string | null; reason: StopReason | null }

export interface CardShot { n: number; from: number; to: number; action: string; text: string; product: number | null; image?: string | null }   // image: a path under the data directory
export interface Card {
  referenceImage?: string | null; referenceVideo?: string | null;
  referenceMetric?: { count: number; kind: 'likes' | 'views' };
  title: string; category: string; format: Format; seconds: number; referenceViews: string;
  image: string | null; video: string | null;          // paths under the data directory, null until there is a poster / a sample
  products: number; shots: CardShot[]; description: string; tags: string[];
  swap?: TemplateSwap;                                 // a person-swap video (the engine's `CardSwap`): it has no shot; every other card has none
}

export interface Product { name: string; description: string; images: string[] }   // images: paths under data/uploads
export type RunInput =
  | { kind: 'produce'; templateId: string; ownerId?: string | null; quality: Quality; variants: 1 | 2 | 3; language: string; products: Product[]; sample: boolean; swap?: { people: SwapPhotos[]; outfit?: Outfit } }   // ownerId: the job's owner; a run written before has none. swap: a person swap, one entry per slot of the card
  | { kind: 'prepare'; templateId: string; ownerId: string | null; mode?: 'swap'; from: { kind: 'link'; url: string; range?: SourceRange } | { kind: 'candidate'; candidateId: string; force: boolean } | { kind: 'upload'; uploadId: string; sha256?: string; range?: SourceRange } }
  | { kind: 'scan'; source: 'topads' | 'shorts'; trigger: 'schedule' | 'manual' }
  // Optional freshness metadata: the worker restores the previous marker when a shot edit is refused.
  // The durable templates.sample_changed_at marker also survives edit-run retention.
  | { kind: 'edit'; templateId: string; card: Pick<Card, 'title' | 'category' | 'products' | 'shots' | 'description' | 'tags'>; shotsChanged?: boolean; sampleChangedBefore?: string | null; swap?: { persons: TemplateSwap['persons'] } };   // swap: the people an admin set for a person-swap video; the worker checks and writes them
export type RunResult =
  | { kind: 'produce'; variants: { video: string; image: string }[] }
  | { kind: 'prepare'; state: 'ready' | 'failed'; note: string | null }
  | { kind: 'scan'; checked: number; aboveThreshold: number; prepared: number }
  | { kind: 'edit'; ok: boolean; note: string | null };

/** The engine's settings row. `providerAccount` is the site's own field, kept in the same JSON (the engine ignores it). */
export interface Settings {
  scanTimes: string[];
  sources: { topads: boolean; shorts: boolean };
  searches: string[];
  threshold: number;
  dailyCandidates: number;
  dailyTemplates: number;
  secondsMin: number; secondsMax: number;
  shortsMinViews: number;
  topAdsCards: number;
  topAdsIndustry?: string; topAdsCountry?: string; topAdsPeriod?: 7 | 30 | 180;
  perScan: number;
  tiers: Record<Quality, { model: string; resolution: string }>;
  providerAccount?: string;
}
export interface Health { workerAt: string; provider: 'fake' | 'magnific'; renderer: 'ready' | 'not-ready'; note: string | null; noCredits?: string | null; swap?: 'fake' | 'ready' | 'not-configured' }

export type TemplateState = 'preparing' | 'ready' | 'failed' | 'published' | 'hidden';
export type RunState = 'held' | 'queued' | 'running' | 'done' | 'stopped' | 'closed';

export interface TemplateRow {
  id: string; state: TemplateState; owner: string | null; sourceKind: 'topads' | 'shorts' | 'link' | 'upload' | 'seed';
  sourceUrl: string | null; note: string | null; card: Card; estimate: Paid | null; minutes: number | null;
  timesGenerated: number; createdAt: string; updatedAt: string;
}
export interface RunRow {
  id: string; kind: RunInput['kind']; ref: string; state: RunState; input: RunInput;
  approved: Paid | null; missing: Paid | null; steps: Step[]; variants: VariantState[]; result: RunResult | null; reason: string | null; detail: string | null;
  createdAt: string; updatedAt: string;
}
export interface CandidateRow {
  likes?: number | null;
  id: string; source: 'topads' | 'shorts' | 'manual'; title: string; views: number | null; seconds: number;
  state: 'found' | 'scored' | 'unsupported' | 'rejected' | 'prepared'; score: number | null; scoreNotes: string | null; image: string | null; foundAt: string;
}
export interface ScanRow {
  id: string; source: 'topads' | 'shorts'; startedAt: string; checked: number; queued: number; aboveThreshold: number; prepared: number;
  status: 'running' | 'done' | 'stopped'; reason: string | null;
}

export type Raw = Record<string, unknown>;

export const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
// The codes the site knows, held to the unions of ports.ts by `satisfies`: a new code there fails typecheck here until it is added.
const keys = <T extends string>(codes: Record<T, 1>): readonly T[] => Object.keys(codes) as T[];
export const STOP_REASONS = keys<StopReason>({
  'adaptation-failed': 1, 'images-failed': 1, 'clips-failed': 1, 'audio-failed': 1, 'render-failed': 1,
  'submission-unknown': 1, 'estimate-exceeded': 1, 'llm-invalid': 1, 'template-missing': 1, 'engine-error': 1, 'content-rule': 1,
});
export const STOP_DETAILS = keys<StopDetail>({
  'provider-credits': 1, 'provider-cap': 1, 'provider-refused': 1, 'provider-setup': 1, 'upload-failed': 1, 'no-products': 1, 'fill-invalid': 1,
  'photo-refused': 1, 'person-missing': 1,
});
export const PREPARATION_NOTES = keys<PreparationNote>({
  'below-threshold': 1, unsupported: 1, 'split-screen': 1, 'too-long': 1, 'bad-range': 1, 'check-failed': 1, 'source-unavailable': 1, 'llm-invalid': 1, 'daily-cap': 1,
});
export const SCAN_REASONS = keys<ScanStopReason>({ 'source-unavailable': 1, 'scan-failed': 1, 'no-matching-industry': 1 });

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const json = <T>(value: unknown): T | null => (typeof value === 'string' ? (JSON.parse(value) as T) : null);

/** A card is only read when it has the fields every page uses: a row that does not is not a template the site can show. */
function card(text: unknown): Card {
  const value = json<Card>(text);
  if (!value || typeof value !== 'object' || typeof value.title !== 'string' || !Array.isArray(value.shots) || typeof value.products !== 'number') {
    throw new Error('card is not a card');
  }
  return value;
}

/** Throws when a JSON column cannot be read: the caller decides whether that row is skipped. */
export function toTemplateRow(r: Raw): TemplateRow {
  return {
    id: r.id as string, state: r.state as TemplateState, owner: str(r.owner), sourceKind: r.source_kind as TemplateRow['sourceKind'],
    sourceUrl: str(r.source_url), note: str(r.note), card: card(r.card), estimate: json<Paid>(r.estimate), minutes: num(r.minutes),
    timesGenerated: (num(r.times_generated) ?? 0), createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export function toRunRow(r: Raw): RunRow {
  return {
    id: r.id as string, kind: r.kind as RunRow['kind'], ref: r.ref as string, state: r.state as RunState,
    input: JSON.parse(r.input as string) as RunInput, approved: json<Paid>(r.approved), missing: json<Paid>(r.missing),
    steps: (json<Step[]>(r.steps) ?? []), variants: (json<VariantState[]>(r.variants) ?? []), result: json<RunResult>(r.result),
    reason: str(r.reason), detail: str(r.detail), createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export function toCandidateRow(r: Raw): CandidateRow {
  return {
    id: r.id as string, source: r.source as CandidateRow['source'], title: r.title as string, likes: num(r.likes), views: num(r.views), seconds: (num(r.seconds) ?? 0),
    state: r.state as CandidateRow['state'], score: num(r.score), scoreNotes: str(r.score_notes), image: str(r.image), foundAt: r.found_at as string,
  };
}

export function toScanRow(r: Raw): ScanRow {
  return {
    id: r.id as string, source: r.source as ScanRow['source'], startedAt: r.started_at as string, checked: (num(r.checked) ?? 0),
    queued: (num(r.queued) ?? 0), aboveThreshold: (num(r.above_threshold) ?? 0), prepared: (num(r.prepared) ?? 0), status: r.status as ScanRow['status'], reason: str(r.reason),
  };
}

/**
 * The job id and the variant id of a regeneration's ref (`<jobId>/<variantId>/<runId>`, see sqlite-engine.ts); null for a job's own
 * produce run, whose ref is the job id.
 */
export function regenOf(ref: string): { jobId: string; variantId: string } | null {
  const [jobId, variantId, runId] = ref.split('/');
  return jobId && variantId && runId ? { jobId, variantId } : null;
}

/** Paid requests added field by field. */
export function addPaid(a: Paid | null, b: Paid | null): Paid {
  const x = a ?? ZERO, y = b ?? ZERO;
  return { images: x.images + y.images, clips: x.clips + y.clips, clipSeconds: x.clipSeconds + y.clipSeconds, music: x.music + y.music, voice: x.voice + y.voice };
}
export function subtractPaid(a: Paid | null, b: Paid | null): Paid {
  const x = a ?? ZERO, y = b ?? ZERO;
  return { images: x.images - y.images, clips: x.clips - y.clips, clipSeconds: x.clipSeconds - y.clipSeconds, music: x.music - y.music, voice: x.voice - y.voice };
}
