import { ownerTestConfig, providerCaps } from '../robust/provider-policy.ts';
import { consumeProvider, refundProvider } from '../robust/provider-budget.ts';
import { creditsHold } from '../robust/provider-credits.ts';
// What the worker builds from its environment: the handlers' dependencies and the two facts `health` needs.
import type { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { createAligner } from '../adapters/aligner.ts';
import { createClaudeLlm } from '../adapters/llm.ts';
import { createDownloader } from '../adapters/downloader.ts';
import { createFakeGenerator } from '../adapters/fake-generator.ts';
import { createFakeSwapper } from '../adapters/fake-swapper.ts';
import { createSplicer } from '../adapters/splice.ts';
import { createMagnific } from '../adapters/magnific.ts';
import { createScriptedLlm } from '../adapters/scripted-llm.ts';
import { createTranscriber } from '../adapters/transcriber.ts';
import { realContext } from '../cli/context.ts';
import { dataDir } from '../paths.ts';
import { availableParallelism } from 'node:os';
import { gated, gateSize, gateSizeOr, openGate, waitLogged } from './gate.ts';
import { timed } from './timing.ts';
import { localPlaceholders } from '../prepare/placeholders.ts';
import type { Placeholders } from '../prepare/placeholders.ts';
import type { ProduceDeps } from '../produce/deps.ts';
import type { EditDeps } from '../prepare/edit.ts';
import type { PrepareDeps } from '../prepare/index.ts';
import { createShorts, createTopAds } from '../scan/index.ts';
import type { ScanDeps } from '../scan/index.ts';
import type { SwapDeps } from '../swap/index.ts';
import type { Health } from '../contracts.ts';
import { GeneratorError } from '../ports.ts';
import type { Aligner, Clock, PersonSwapper, Renderer, Transcriber } from '../ports.ts';

export type Env = Record<string, string | undefined>;
export interface Parts {
  /** A fresh snapshot: `aligner` is there once the aligner has said it is ready. */
  produceDeps(): ProduceDeps;
  prepareDeps: PrepareDeps;
  editDeps: EditDeps;
  scanDeps: ScanDeps;
  swapDeps: SwapDeps;
  health(): Promise<Pick<Health, 'provider' | 'renderer' | 'note' | 'noCredits' | 'swap' | 'swapNote'>>;
}
/** What a test may replace: the two parts that start a process when asked if they are ready, and the speech recognition that shares its gate with one of them. */
export interface Overrides { renderer?: Renderer; aligner?: Aligner; placeholders?: Placeholders; transcriber?: Transcriber }

function number(env: Env, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

/** What the pretend person-swap provider is asked for, by quality. A paid provider brings the names of its own models. */
const FAKE_SWAP_TIERS: SwapDeps['tiers'] = { fast: { model: 'fake-swap', resolution: '720p' }, best: { model: 'fake-swap', resolution: '1080p' } };

const SWAP_UNBUILT = 'VC_SWAP_PROVIDER names a person-swap provider this worker cannot build';
const SWAP_UNSET = 'VC_SWAP_PROVIDER is not set: a worker that pays has no person-swap provider';

/** The swapper of a worker that has no person-swap provider to build (`why`): every request is refused before anything is sent, as a paid client without its key refuses. Never the pretend one instead. */
function noSwapper(why: string): PersonSwapper {
  const refuse = async (): Promise<never> => { throw new GeneratorError('not-configured', why); };
  return { refusal: () => null, replace: refuse, resume: refuse, ready: async () => ({ ready: false, note: why }) };
}

export function buildParts(env: Env, db: DatabaseSync, clock: Clock, overrides: Overrides = {}): Parts {
  const data = env.VC_DATA_DIR ? resolve(env.VC_DATA_DIR) : dataDir();
  const tools = realContext().tools;
  const { ffmpeg, ffprobe } = tools.where;

  const owner = ownerTestConfig(env);
  if (owner) console.warn('OWNER TEST: real Magnific money is spent / gerçek Magnific parası harcanır');
  const caps = providerCaps(env);
  const budgetKey = (runId: string): string => (db.prepare("SELECT CASE WHEN kind = 'produce' THEN ref ELSE id END AS id FROM runs WHERE id = ?").get(runId) as { id: string } | undefined)?.id ?? runId;
  const magnific = env.VC_PROVIDER === 'magnific';
  // Money: the paid provider never runs without caps. `providerCaps` answers null when neither is set (the fake keeps no budget); with Magnific every paid request is then refused before anything is sent.
  const capsMissing = magnific && caps === null;
  const failClip = number(env, 'VC_FAKE_FAIL_CLIP');
  const delayMs = number(env, 'VC_FAKE_DELAY_MS');
  const generator = magnific
    ? createMagnific({ apiKey: env.MAGNIFIC_API_KEY, spendDir: data, beforePaid: (runId, units) => { if (caps === null) throw new Error('provider-cap-required'); const at = clock.now(); consumeProvider(db, caps, budgetKey(runId), units, at); return at; }, afterRefused: (runId, units, chargedAt) => refundProvider(db, caps, budgetKey(runId), units, chargedAt ?? clock.now()) })   // without a key every paid call is refused with not-configured: never the fake instead
    : createFakeGenerator({ log: env.VC_FAKE_GENERATOR_LOG || join(data, 'fake-generator.log'), ffmpeg, clock, ...(failClip !== undefined ? { failClip } : {}), ...(delayMs !== undefined ? { delayMs } : {}) });
  const provider: Health['provider'] = magnific ? 'magnific' : 'fake';
  // Person swap has a provider of its own. Unset or `fake`: the pretend one, and only on a worker that pays for nothing: real credits never buy a pretend video.
  // Any other name is a paid provider, and one this worker cannot build refuses every request; so does a worker that pays and was named none.
  const swapNamed = (env.VC_SWAP_PROVIDER ?? '') !== '';
  const swapMissing = swapNamed && (magnific || env.VC_SWAP_PROVIDER !== 'fake');
  const failSwap = number(env, 'VC_FAKE_FAIL_SWAP');
  const pretendSwap = !swapMissing && !magnific;
  const swapper = swapMissing ? noSwapper(SWAP_UNBUILT)
    : magnific ? noSwapper(SWAP_UNSET)
    : createFakeSwapper({ log: env.VC_FAKE_SWAPPER_LOG || join(data, 'fake-swapper.log'), ffmpeg, ffprobe, clock, ...(failSwap !== undefined ? { failSwap } : {}), ...(delayMs !== undefined ? { delayMs } : {}) });

  const llm = timed('llm', env.VC_LLM_SCRIPT ? createScriptedLlm(env.VC_LLM_SCRIPT) : createClaudeLlm());
  // The heavy children share the cores: at most K speech recognitions and K Chrome checks at once (default a quarter of the cores each). The gate is outside the timer, so a line shows the work and not the wait.
  const cores = availableParallelism();
  const chrome = openGate(gateSize(env, 'VC_GATE_CHROME', cores));
  const whisper = openGate(gateSize(env, 'VC_GATE_TRANSCRIBE', cores));
  // Several videos at once share two more things. A render starts its own Chrome workers (up to 4), so one render at a time unless asked otherwise.
  // Paid requests in flight over ALL runs: by default the 3 that one run alone sends at a time (its pool, produce/index.ts), so opening more lanes does not send the provider more at once.
  const rendering = openGate(gateSizeOr(env, 'VC_GATE_RENDER', 1, 4));
  const paidGate = waitLogged(openGate(gateSizeOr(env, 'VC_GATE_PROVIDER', 3, 12)), 'provider');
  const bareRenderer = overrides.renderer ?? tools.renderer('looks');   // `health` asks this one: a line every 30 s for the same question would only fill the log
  const renderer = gated(timed('renderer', bareRenderer), { check: chrome, render: rendering }, 'renderer');
  const transcriber = gated(timed('transcriber', overrides.transcriber ?? createTranscriber(tools.where.hyperframes)), { words: whisper }, 'transcriber');
  const downloader = timed('downloader', createDownloader());
  const media = timed('media', tools.media);
  const placeholders = overrides.placeholders ?? localPlaceholders({ ffmpeg });

  // The aligner may take minutes to answer: nothing waits for it, a produce run claimed before the answer runs without it.
  // An alignment is a Python child with a speech model of its own, as heavy as a recognition: it takes a place of the same gate.
  let aligner: Aligner | undefined;
  const candidate = overrides.aligner ?? createAligner();
  void candidate.ready().then((r) => { if (r.ready) aligner = gated(candidate, { align: whisper }, 'aligner'); }, () => { /* stays absent */ });

  return {
    produceDeps: () => ({ db, generator, renderer, transcriber, media, measure: tools.measure, llm, clock, paidGate, ...(aligner ? { aligner } : {}) }),
    prepareDeps: { db, dataDir: data, llm, downloader, transcriber, media, renderer, placeholders, clock },
    editDeps: { db, dataDir: data, renderer, placeholders, clock },
    scanDeps: { db, topAds: createTopAds(), shorts: createShorts(), clock },
    swapDeps: { db, swapper, splicer: createSplicer({ ffmpeg, ffprobe }), media, measure: tools.measure, clock, tiers: FAKE_SWAP_TIERS, paidGate },
    async health() {
      const r = await bareRenderer.ready();
      const keyMissing = magnific && (env.MAGNIFIC_API_KEY ?? '').trim() === '';
      // the claude child starts with no login of the owner's own (SEC2 C3): without the token every model call is refused, and nothing else shows it
      const tokenMissing = !env.VC_LLM_SCRIPT && (env.CLAUDE_CODE_OAUTH_TOKEN ?? '').trim() === '';
      const held = creditsHold(db);
      const noCredits = held === null ? null : `the provider has no credits left (refused run ${held.runId} at ${held.at}): no new paid request is sent until a job that stopped for it is retried and the provider accepts a request`;
      const notes = [keyMissing ? 'MAGNIFIC_API_KEY is not set' : null, capsMissing ? 'VC_PROVIDER_DAILY_CAP and VC_PROVIDER_JOB_CAP are not set: paid requests are refused' : null, tokenMissing ? 'CLAUDE_CODE_OAUTH_TOKEN is not set: model calls are refused' : null, swapMissing ? `${SWAP_UNBUILT}: its requests are refused` : null, r.note].filter((n): n is string => n !== null);
      // person swap in fields of its own: a worker that pays and was named no person-swap provider is ready for products, and its note stays silent;
      // why it has none is what its swapper says, in `swapNote` (the site reads any note as "the product provider is not configured")
      const asked = pretendSwap ? null : await swapper.ready();
      const swap: Health['swap'] = asked === null ? 'fake' : asked.ready ? 'ready' : 'not-configured';
      return { provider, renderer: r.ready ? 'ready' : 'not-ready', note: notes.length > 0 ? notes.join('; ') : null, noCredits, swap, swapNote: asked?.note ?? null };
    },
  };
}
