/**
 * The wire shape of every paid request: which path to POST to, where to ask for the task afterwards,
 * which local files have to be uploaded first, and the JSON body. No I/O here; `magnific.ts` sends it.
 * Every fact is listed with its source in docs/reference/magnific-notes.md.
 */
import { extname } from 'node:path';
import type { ClipRequest, ImageRequest, MusicRequest, PaidRequest, SwapPaid, VoiceRequest } from '../ports.ts';
import { MAX_IMAGE_REFERENCES } from '../template/limits.ts';

export interface Reference { file: string; kind: 'image' | 'audio' }   // a local file the request refers to
export interface Uploaded { url: string; mime: string }                // what the provider reads it from
export interface Route {
  submit: string;                                          // POST path
  poll: string;                                            // GET path; the task id is appended
  references: Reference[];                                 // uploaded first, in this order
  body(uploaded: Uploaded[]): Record<string, unknown>;     // uploaded[i] belongs to references[i]
}
/** The provider has no way to take this request. Nothing is uploaded and nothing is sent. */
export class RouteError extends Error {}

export const UPLOAD_PATH = '/v1/ai/uploads/request-url';
export const READY_PATH = '/v1/ai/uploads';                // a free listing: answers when the key is accepted

const IMAGE_PATH = '/v1/ai/text-to-image/nano-banana-pro';
const MUSIC_PATH = '/v1/ai/music-generation/lyria-3';
const VOICE_PATH = '/v1/ai/voiceover/elevenlabs-turbo-v2-5';

/** A table entry by its own key only: a model named `constructor` is unknown, not a property every object has. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};
/** The content type the upload takes for this file, from its extension; null when it takes none. */
export function mimeOf(file: string): string | null {
  return own(MIME, extname(file).toLowerCase()) ?? null;
}

/** Seedance: one POST path per model and resolution. `pollPerResolution`: the task is asked for under the same name. */
const SEEDANCE: Record<string, { resolutions: string[]; maxSeconds: number; pollPerResolution: boolean }> = {
  'seedance-2-pro': { resolutions: ['480p', '720p', '1080p', '4k'], maxSeconds: 15, pollPerResolution: false },
  'seedance-2-fast': { resolutions: ['480p', '720p'], maxSeconds: 15, pollPerResolution: false },
  'seedance-2-mini': { resolutions: ['480p', '720p'], maxSeconds: 15, pollPerResolution: false },
  'seedance-2-5-pro': { resolutions: ['480p', '720p', '1080p'], maxSeconds: 30, pollPerResolution: true },
};
const KLING = ['kling-v3-pro', 'kling-v3-std'];
const KLING_POLL = '/v1/ai/video/kling-v3';                // both Kling tiers are asked for here
/** Seedance takes a ratio by name. */
const RATIO_NAMES: Record<string, string> = {
  '1:1': 'square_1_1', '4:3': 'classic_4_3', '3:4': 'traditional_3_4',
  '16:9': 'widescreen_16_9', '9:16': 'social_story_9_16', '21:9': 'film_horizontal_21_9',
};

export function imageRoute(request: ImageRequest): Route {
  if (request.references.length > MAX_IMAGE_REFERENCES) {
    throw new RouteError(`an image takes at most ${MAX_IMAGE_REFERENCES} references, not ${request.references.length}`);
  }
  return {
    submit: IMAGE_PATH,
    poll: IMAGE_PATH,
    references: request.references.map((file) => ({ file, kind: 'image' })),
    body: (uploaded) => ({
      prompt: request.prompt, aspect_ratio: request.aspect, num_images: 1,
      ...(uploaded.length === 0 ? {} : { reference_images: uploaded.map(({ url, mime }) => ({ image: url, mime_type: mime })) }),
    }),
  };
}

export function clipRoute(request: ClipRequest): Route {
  const model = request.tier.model.replaceAll('.', '-');
  if (KLING.includes(model)) return klingRoute(request, model);
  const seedance = own(SEEDANCE, model);
  if (seedance === undefined) throw new RouteError(`no clip route for the model ${request.tier.model}`);
  const { resolution } = request.tier;
  if (!seedance.resolutions.includes(resolution)) {
    throw new RouteError(`${request.tier.model} renders at ${seedance.resolutions.join(', ')}, not ${resolution}`);
  }
  if (!Number.isInteger(request.seconds) || request.seconds < 4 || request.seconds > seedance.maxSeconds) {
    throw new RouteError(`${request.tier.model} takes 4 to ${seedance.maxSeconds} whole seconds, not ${request.seconds}`);
  }
  const submit = `/v1/ai/video/${model}-${resolution}`;
  const poll = seedance.pollPerResolution ? submit : `/v1/ai/video/${model}`;
  if (request.mode === 'first-frame') {
    return {
      submit, poll,
      references: [{ file: request.firstFrame, kind: 'image' }],
      // no aspect_ratio: the clip follows the first frame
      body: ([frame]) => ({ prompt: request.prompt, image: frame!.url, duration: request.seconds, sound_effects: false }),
    };
  }
  const ratio = own(RATIO_NAMES, request.aspect);
  if (ratio === undefined) throw new RouteError(`no clip ratio named for ${request.aspect}`);
  return {
    submit, poll,
    references: [{ file: request.presenter, kind: 'image' }, { file: request.voice, kind: 'audio' }],
    body: ([presenter, voice]) => ({
      prompt: request.prompt, reference_images: [presenter!.url], reference_audios: [voice!.url],
      duration: request.seconds, aspect_ratio: ratio, sound_effects: true, no_music: true,
    }),
  };
}

function klingRoute(request: ClipRequest, model: string): Route {
  if (request.mode !== 'first-frame') throw new RouteError(`${model} makes clips from a first frame only`);
  if (!Number.isInteger(request.seconds) || request.seconds < 1) {
    throw new RouteError(`${model} takes whole seconds, not ${request.seconds}`);
  }
  return {
    submit: `/v1/ai/video/${model}`,
    poll: KLING_POLL,
    references: [{ file: request.firstFrame, kind: 'image' }],
    body: ([frame]) => ({
      prompt: request.prompt, start_image_url: frame!.url, aspect_ratio: '9:16', duration: String(request.seconds),
      generate_audio: false, cfg_scale: 0.5,
    }),
  };
}

export function musicRoute(request: MusicRequest): Route {
  return { submit: MUSIC_PATH, poll: MUSIC_PATH, references: [], body: () => ({ prompt: request.prompt, model: 'clip' }) };
}

export function voiceRoute(request: VoiceRequest): Route {
  return {
    submit: VOICE_PATH, poll: VOICE_PATH, references: [],
    body: () => ({
      text: request.text, voice_id: request.voiceId, stability: 0.4, similarity_boost: 0.75, speed: 1, use_speaker_boost: true,
    }),
  };
}

/** The route of a paid request. Throws RouteError when the provider cannot take it; a person swap it never takes. */
export function routeOf(paid: PaidRequest | SwapPaid): Route {
  switch (paid.kind) {
    case 'image': return imageRoute(paid.request);
    case 'clip': return clipRoute(paid.request);
    case 'music': return musicRoute(paid.request);
    case 'voice': return voiceRoute(paid.request);
    case 'swap': throw new RouteError('this provider replaces no person in a video');
  }
}

/** Why the provider cannot take this request, or null. It looks at the request only: no file is read, nothing is sent. */
export function refusalOf(paid: PaidRequest | SwapPaid): string | null {
  try {
    routeOf(paid);
    return null;
  } catch (error) {
    if (error instanceof RouteError) return error.message;
    throw error;
  }
}
