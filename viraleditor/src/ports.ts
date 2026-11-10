import { z } from 'zod';

// ── paid generation: our own HTTP client. produce writes the operations row BEFORE each call. ──
export interface Tier { model: string; resolution: string }                              // Settings.tiers[quality]
export interface ImageRequest { prompt: string; references: string[]; aspect: string }   // references: local image files · aspect: '9:16'
export type ClipRequest =
  | { mode: 'first-frame'; firstFrame: string; prompt: string; seconds: number; tier: Tier }
  | { mode: 'speaker'; presenter: string; voice: string; prompt: string; seconds: number; tier: Tier; aspect: string };
export interface MusicRequest { prompt: string }
export interface VoiceRequest { text: string; voiceId: string }
export interface Generated { taskId: string; file: string }                              // file: the path given as `to`
/** Called once, as soon as the provider has accepted the request. The ticket is all `resume` needs; it is stored in operations.external_id. */
export type OnSubmitted = (ticket: string) => void;

export type GeneratorErrorCode =
  | 'submission-unknown'   // the submit got no usable answer: the request may exist. Never send it again.
  | 'rejected'             // the provider refused the submit (HTTP 4xx), or the request was refused here before anything was sent: nothing was started
  | 'upload-failed'        // a reference file could not be uploaded: nothing was started
  | 'task-failed'          // the provider started the task and reported it failed
  | 'empty-result'         // the task finished without a file
  | 'timeout'              // not finished in time; the ticket stays valid
  | 'download-failed'      // finished, but the file could not be fetched; the ticket stays valid
  | 'not-configured';      // no key in the environment
export class GeneratorError extends Error {
  code: GeneratorErrorCode;
  ticket: string | null;
  status: number | null;       // the HTTP status of a refusal ('rejected'), when there was one
  constructor(code: GeneratorErrorCode, message: string, ticket: string | null = null, status: number | null = null) { super(message); this.code = code; this.ticket = ticket; this.status = status; }
}
export type PaidRequest =
  | { kind: 'image'; request: ImageRequest }
  | { kind: 'clip'; request: ClipRequest }
  | { kind: 'music'; request: MusicRequest }
  | { kind: 'voice'; request: VoiceRequest };
export interface Generator {
  /** Free and local, sends nothing: null when this request would be accepted for sending, otherwise the reason. It looks at models, lengths, counts and ratios, never at files. produce asks it for every request of a run before the first paid one. */
  refusal(request: PaidRequest): string | null;
  image(request: ImageRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated>;
  clip(request: ClipRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated>;
  music(request: MusicRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated>;
  voice(request: VoiceRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated>;
  resume(ticket: string, to: string): Promise<Generated>;                                // asks for a task submitted earlier; never submits
  ready(): Promise<{ ready: boolean; note: string | null }>;                             // free requests only
}

// ── person swap: the people of a video are replaced by the people of photographs. A provider of its own, paid the same way. ──
/** One person to put into the video: local files. `face`: a close photograph, when one was given. `side`: one taken from the side, when one was given; no provider is sent it yet. `hint`: the words the model finds the person of the video by. */
/** What the person wears in a person swap: `keep` the clothes of the video, or `photo` those of the photograph. */
export type Outfit = 'keep' | 'photo';
export interface SwapPerson { slot: number; body: string; face: string | null; side?: string; hint: string }
/** One part of a person-swap video. `video`: the local file of the part · `seconds`: its length, what the provider bills · `keepSound`: ask the provider to leave the sound in (the finished video gets the source's own sound either way) · `outfit`: what the person wears (a prompt tells it; left out, nothing is said). */
export interface SwapRequest { video: string; people: SwapPerson[]; seconds: number; tier: Tier; keepSound: boolean; outfit?: Outfit }
/** A part of a person-swap video as a paid request of a run: planned, counted, recorded and never sent twice like the four of `PaidRequest`. No `Generator` takes one (adapters/routes.ts refuses it). */
export interface SwapPaid { kind: 'swap'; request: SwapRequest }
/** The provider that replaces people. It fails with the `GeneratorError` codes, which mean here what they mean for a `Generator`. */
export interface PersonSwapper {
  /** Free and local, sends nothing: null when this request would be accepted for sending, otherwise the reason. It looks at the model, the length and the number of people, never at files. */
  refusal(request: SwapRequest): string | null;
  replace(request: SwapRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated>;
  resume(ticket: string, to: string): Promise<Generated>;                                // asks for a task submitted earlier; never submits
  ready(): Promise<{ ready: boolean; note: string | null }>;                             // free requests only
}

// ── local tools ──
export interface CheckIssue { code: string; message: string; target: string | null; second: number | null }
export interface MediaFacts { width: number; height: number; fps: number; frames: number; seconds: number; audio: boolean }
export class RenderError extends Error {}
/** What one render may ask for. `verifyRepeat`: the picture is rendered again and published only when two renders agree (a delivered video; twice the time, three times after a mismatch). */
export interface RenderCall { verifyRepeat?: boolean }
export interface Renderer {
  check(dir: string): Promise<{ ok: boolean; issues: CheckIssue[] }>;                    // the composition folder: lint, runtime, layout
  render(dir: string, to: string, onProgress: (p: { frame: number; frames: number }) => void, options?: RenderCall): Promise<MediaFacts>;   // throws RenderError
  ready(): Promise<{ ready: boolean; note: string | null }>;
}
export interface Word { text: string; start: number; end: number }                       // seconds from the start of the media
export interface Transcriber { words(media: string, language: string): Promise<Word[]> }
export interface AlignedWord extends Word { score: number }                               // the model's confidence for the word, 0..1; 0: not placed by the model (its time is shared from its neighbours)
export interface Aligner {                                                               // forced alignment of a KNOWN script: optional; the recogniser stays the check that a clip speaks its lines
  align(media: string, words: string[], language: string): Promise<AlignedWord[]>;       // one entry per given word, in order, timed on the media's sound; rejects when it has no model for the language
  ready(): Promise<{ ready: boolean; note: string | null }>;                             // is the local environment there; never the network
}
export type ContactSheet = (media: string, to: string, grid: { columns: number; rows: number; labels?: boolean; at?: number[] }) => Promise<{ seconds: number[] }>; // labels: each tile's second on a plate and grey gaps (the command line's sheet); default false: the plain sheet a model reads · at: the seconds of the tiles, in order, at most columns × rows (fewer: the rest of the grid stays empty); without it the tiles are evenly spaced · the returned seconds are the seconds really taken
export interface Media {                                                                 // ffmpeg / ffprobe
  probe(file: string): Promise<MediaFacts>;
  normalize(file: string, to: string, target: { width: number; height: number; fps: number; audio: boolean }): Promise<MediaFacts>;
  still(file: string, second: number, to: string): Promise<void>;                        // the poster
  sheet: ContactSheet;                                                                   // frame sheet for template preparation
  trim(file: string, from: number, to: number, out: string): Promise<MediaFacts>;        // the part of the clip between two seconds (from < to <= its length), re-encoded so the cut is exact; rejects a range that is not that
  cuts(file: string): Promise<Cuts>;
}
export interface Splicer {                                                               // ffmpeg
  /** The parts one after the other as one video at `to`, with `sound` (a sound file, or null for none) laid under the whole and the picture `label` (an image file) over every frame. Rejects when a part cannot be read. */
  join(parts: string[], sound: string | null, label: string, to: string): Promise<MediaFacts>;
}
export interface Cuts {
  seconds: number[];                                                                     // the second at which each new shot starts (hard cuts), ascending, never 0; [] for one continuous take
  faint: FaintCut[];                                                                     // the changes too soft to be taken for a cut by their score, that stand alone among the frames around them (a jump cut on one background), ascending
}
export interface FaintCut { second: number; score: number }                              // score: how much the frame differs from the one before it, 0 to the score of a hard cut
// ── measurements of media files (ffmpeg / ffprobe), for the quality checks ──
export interface FrameRange { at: number; for: number }                                  // frames
export interface StreamFacts extends MediaFacts {
  codec: string; pixelFormat: string;
  colour: { space: string | null; transfer: string | null; primaries: string | null };  // null: the file carries no tag
  keyframes: number[];                                                                   // frame numbers of the keyframes
  sound: { codec: string; sampleRate: number; channels: number } | null;
  constantRate: boolean;                                                                 // r_frame_rate and avg_frame_rate agree: every frame lasts the same; false for a variable-rate file
}
export interface Loudness { integrated: number; truePeak: number; range: number }        // LUFS, dBTP, LU
export interface Picture { width: number; height: number; rgb: Uint8Array }              // rgb24, row by row
export interface Measure {
  streams(file: string): Promise<StreamFacts>;
  black(file: string): Promise<FrameRange[]>;                                            // runs of black frames
  frozen(file: string): Promise<FrameRange[]>;                                           // runs of frames that do not change
  loudness(file: string): Promise<Loudness | null>;                                      // null: no sound stream
  momentary(file: string): Promise<number[]>;                                            // momentary loudness (LUFS; -Infinity: silence) of every 100 ms from the start; []: no sound stream
  picture(file: string, frame: number): Promise<Picture>;                                // one decoded frame, exactly that frame
}
// Llm, Downloader, TopAds, Shorts, Clock, LlmInvalid: unchanged.
export interface Llm { run<T>(request: { prompt: string; files: string[]; schema: z.ZodType<T> }): Promise<T> }   // throws LlmInvalid after one retry
export interface Downloader { video(url: string, toDir: string): Promise<{ file: string; title: string; seconds: number; views: number | null; likes: number | null }> }
export interface TopAds { cards(limit: number, filters?: { topAdsIndustry?: string; topAdsCountry?: string; topAdsPeriod?: number }): Promise<{ url: string; title: string; likes: number; seconds: number; video: string }[] & { inspected?: number; industryMatched?: number }> }
/** What a scan wants from a Shorts search: cards under `minViews` or already known (`skip`, by URL) cost no detail request; at most `limit` cards come back. */
export interface ShortsWant { minViews?: number; skip?: ReadonlySet<string>; limit?: number }
/** `query` is a hashtag (a phrase is joined into one tag). */
export interface Shorts { search(query: string, want?: ShortsWant): Promise<{ url: string; title: string; views: number; seconds: number }[]> }
export interface Clock { now(): Date }
/**
 * `code`: why the answer was refused, as a closed code and never a word of the answer: the top-level fields of the schema that
 * failed and the kind of each (`notes:too_big,mode:invalid_value`), `no-json` when the answer held no JSON, or '' when unknown.
 */
export class LlmInvalid extends Error {
  readonly code: string;
  constructor(message: string, code = '') { super(message); this.code = code; }
}
const CODE_CHARS = 120;
/** The `LlmInvalid.code` of an answer a schema refused. Fields come from the schema itself (not from the answer), kinds from zod's closed list of issue codes. */
export function invalidCode(schema: z.ZodType<unknown>, error: z.ZodError): string {
  let fields: Set<string>;
  try { fields = new Set(Object.keys((z.toJSONSchema(schema) as { properties?: object }).properties ?? {})); } catch { fields = new Set(); }
  const codes = error.issues.map((issue) => {
    const field = issue.path[0];
    return typeof field === 'string' && fields.has(field) ? `${field}:${issue.code}` : issue.code;
  });
  return [...new Set(codes)].sort().join(',').slice(0, CODE_CHARS);
}
