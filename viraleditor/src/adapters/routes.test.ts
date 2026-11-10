import { describe, expect, it } from 'vitest';
import type { ClipRequest, PaidRequest, SwapPaid, Tier } from '../ports.ts';
import { RouteError, clipRoute, imageRoute, mimeOf, musicRoute, refusalOf, routeOf, voiceRoute } from './routes.ts';

const firstFrame = (tier: Tier, seconds = 4): ClipRequest =>
  ({ mode: 'first-frame', firstFrame: '/d/s1.png', prompt: 'slow push in', seconds, tier });
const speaker = (tier: Tier, seconds = 10, aspect = '9:16'): ClipRequest =>
  ({ mode: 'speaker', presenter: '/d/presenter.png', voice: '/d/voice.mp3', prompt: 'She says: hello', seconds, tier, aspect });
const mini: Tier = { model: 'seedance-2-mini', resolution: '720p' };

describe('image route', () => {
  it('nano-banana-pro: path, references as { image, mime_type }, one image', () => {
    const route = imageRoute({ prompt: 'A serum tube on a shelf', references: ['/d/a.png', '/d/b.jpg'], aspect: '9:16' });
    expect(route.submit).toBe('/v1/ai/text-to-image/nano-banana-pro');
    expect(route.poll).toBe('/v1/ai/text-to-image/nano-banana-pro');
    expect(route.references).toEqual([{ file: '/d/a.png', kind: 'image' }, { file: '/d/b.jpg', kind: 'image' }]);
    expect(route.body([{ url: 'https://assets.example/1', mime: 'image/png' }, { url: 'https://assets.example/2', mime: 'image/jpeg' }])).toEqual({
      prompt: 'A serum tube on a shelf', aspect_ratio: '9:16', num_images: 1,
      reference_images: [{ image: 'https://assets.example/1', mime_type: 'image/png' }, { image: 'https://assets.example/2', mime_type: 'image/jpeg' }],
    });
  });
  it('without references the body has no reference_images', () => {
    const route = imageRoute({ prompt: 'A shelf', references: [], aspect: '9:16' });
    expect(route.references).toEqual([]);
    expect(route.body([])).toEqual({ prompt: 'A shelf', aspect_ratio: '9:16', num_images: 1 });
  });
  it('takes 14 references and refuses 15', () => {
    const files = (count: number): string[] => Array.from({ length: count }, (_, i) => `/d/${i}.png`);
    expect(imageRoute({ prompt: 'x', references: files(14), aspect: '9:16' }).references).toHaveLength(14);
    expect(() => imageRoute({ prompt: 'x', references: files(15), aspect: '9:16' })).toThrow(RouteError);
  });
});

describe('clip route', () => {
  it.each([
    ['seedance-2-mini', '720p', '/v1/ai/video/seedance-2-mini-720p', '/v1/ai/video/seedance-2-mini'],
    ['seedance-2-mini', '480p', '/v1/ai/video/seedance-2-mini-480p', '/v1/ai/video/seedance-2-mini'],
    ['seedance-2-fast', '720p', '/v1/ai/video/seedance-2-fast-720p', '/v1/ai/video/seedance-2-fast'],
    ['seedance-2-pro', '4k', '/v1/ai/video/seedance-2-pro-4k', '/v1/ai/video/seedance-2-pro'],
    ['seedance-2.5-pro', '1080p', '/v1/ai/video/seedance-2-5-pro-1080p', '/v1/ai/video/seedance-2-5-pro-1080p'],
    ['seedance-2.5-pro', '480p', '/v1/ai/video/seedance-2-5-pro-480p', '/v1/ai/video/seedance-2-5-pro-480p'],
    ['kling-v3-pro', '1080p', '/v1/ai/video/kling-v3-pro', '/v1/ai/video/kling-v3'],
    ['kling-v3-std', '720p', '/v1/ai/video/kling-v3-std', '/v1/ai/video/kling-v3'],
  ])('%s at %s: POST %s, ask at %s', (model, resolution, submit, poll) => {
    const route = clipRoute(firstFrame({ model, resolution }));
    expect(route.submit).toBe(submit);
    expect(route.poll).toBe(poll);
  });

  it('Seedance first-frame: image, prompt, integer duration, no sound, no aspect_ratio', () => {
    const route = clipRoute(firstFrame(mini, 4));
    expect(route.references).toEqual([{ file: '/d/s1.png', kind: 'image' }]);
    expect(route.body([{ url: 'https://assets.example/f', mime: 'image/png' }])).toEqual({
      prompt: 'slow push in', image: 'https://assets.example/f', duration: 4, sound_effects: false,
    });
  });
  it('Seedance speaker: reference image and audio, the named ratio, sound without music', () => {
    const route = clipRoute(speaker({ model: 'seedance-2.5-pro', resolution: '1080p' }, 10));
    expect(route.references).toEqual([{ file: '/d/presenter.png', kind: 'image' }, { file: '/d/voice.mp3', kind: 'audio' }]);
    expect(route.body([{ url: 'https://assets.example/p', mime: 'image/png' }, { url: 'https://assets.example/v', mime: 'audio/mpeg' }])).toEqual({
      prompt: 'She says: hello', reference_images: ['https://assets.example/p'], reference_audios: ['https://assets.example/v'],
      duration: 10, aspect_ratio: 'social_story_9_16', sound_effects: true, no_music: true,
    });
  });
  it.each([
    ['1:1', 'square_1_1'], ['4:3', 'classic_4_3'], ['3:4', 'traditional_3_4'],
    ['16:9', 'widescreen_16_9'], ['9:16', 'social_story_9_16'], ['21:9', 'film_horizontal_21_9'],
  ])('speaker ratio %s is sent as %s', (aspect, named) => {
    const body = clipRoute(speaker(mini, 8, aspect)).body([{ url: 'https://a.example/p', mime: 'image/png' }, { url: 'https://a.example/v', mime: 'audio/wav' }]);
    expect(body.aspect_ratio).toBe(named);
  });
  it('Kling first-frame: start_image_url, 9:16, the duration as a string, no sound', () => {
    const route = clipRoute(firstFrame({ model: 'kling-v3-pro', resolution: '1080p' }, 5));
    expect(route.references).toEqual([{ file: '/d/s1.png', kind: 'image' }]);
    expect(route.body([{ url: 'https://assets.example/f', mime: 'image/png' }])).toEqual({
      prompt: 'slow push in', start_image_url: 'https://assets.example/f', aspect_ratio: '9:16', duration: '5',
      generate_audio: false, cfg_scale: 0.5,
    });
  });

  it.each([
    ['an unknown model', firstFrame({ model: 'veo-3', resolution: '720p' })],
    ['a resolution the model has no route for', firstFrame({ model: 'seedance-2-mini', resolution: '1080p' })],
    ['4k on seedance-2.5-pro', firstFrame({ model: 'seedance-2.5-pro', resolution: '4k' })],
    ['3 seconds', firstFrame(mini, 3)],
    ['4.5 seconds', firstFrame(mini, 4.5)],
    ['16 seconds on seedance-2-mini', firstFrame(mini, 16)],
    ['31 seconds on seedance-2.5-pro', firstFrame({ model: 'seedance-2.5-pro', resolution: '720p' }, 31)],
    ['a speaker clip on Kling', speaker({ model: 'kling-v3-pro', resolution: '1080p' })],
    ['a ratio without a name', speaker(mini, 8, '5:4')],
    ['0 seconds on Kling', firstFrame({ model: 'kling-v3-std', resolution: '720p' }, 0)],
    ['2.5 seconds on Kling', firstFrame({ model: 'kling-v3-std', resolution: '720p' }, 2.5)],
  ])('refuses %s', (_what, request) => {
    expect(() => clipRoute(request)).toThrow(RouteError);
  });
  it('takes the longest clip of each model: 15 s and 30 s', () => {
    expect(clipRoute(firstFrame(mini, 15)).body([{ url: 'https://a.example/f', mime: 'image/png' }]).duration).toBe(15);
    expect(clipRoute(firstFrame({ model: 'seedance-2.5-pro', resolution: '720p' }, 30)).body([{ url: 'https://a.example/f', mime: 'image/png' }]).duration).toBe(30);
  });
});

describe('music and voice routes', () => {
  it('music: lyria-3, the prompt and the clip model', () => {
    const route = musicRoute({ prompt: 'warm lo-fi bed' });
    expect(route.submit).toBe('/v1/ai/music-generation/lyria-3');
    expect(route.poll).toBe('/v1/ai/music-generation/lyria-3');
    expect(route.references).toEqual([]);
    expect(route.body([])).toEqual({ prompt: 'warm lo-fi bed', model: 'clip' });
  });
  it('voice: elevenlabs-turbo-v2-5, text and voice_id', () => {
    const route = voiceRoute({ text: 'I tried it for a week.', voiceId: 'voice-abc' });
    expect(route.submit).toBe('/v1/ai/voiceover/elevenlabs-turbo-v2-5');
    expect(route.poll).toBe('/v1/ai/voiceover/elevenlabs-turbo-v2-5');
    expect(route.references).toEqual([]);
    expect(route.body([])).toEqual({
      text: 'I tried it for a week.', voice_id: 'voice-abc', stability: 0.4, similarity_boost: 0.75, speed: 1, use_speaker_boost: true,
    });
  });
});

describe('mimeOf', () => {
  it.each([
    ['/d/a.png', 'image/png'], ['/d/a.PNG', 'image/png'], ['/d/a.jpg', 'image/jpeg'], ['/d/a.jpeg', 'image/jpeg'],
    ['/d/a.webp', 'image/webp'], ['/d/v.mp3', 'audio/mpeg'], ['/d/v.wav', 'audio/wav'],
  ])('%s is %s', (file, mime) => { expect(mimeOf(file)).toBe(mime); });
  it.each(['/d/a.gif', '/d/a', '/d/v.ogg', '/d.png/a'])('%s has no type the provider takes', (file) => { expect(mimeOf(file)).toBeNull(); });
});

describe('a name that is in no table is refused, also when every object has a property of that name', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])('a model named %s', (model) => {
    expect(() => clipRoute(firstFrame({ model, resolution: '720p' }))).toThrow(RouteError);
    expect(typeof refusalOf({ kind: 'clip', request: firstFrame({ model, resolution: '720p' }) })).toBe('string');
  });
  it.each(['constructor', 'toString', '__proto__'])('a ratio named %s', (aspect) => {
    expect(() => clipRoute(speaker(mini, 8, aspect))).toThrow(RouteError);
  });
});

describe('refusalOf and routeOf', () => {
  it.each<[string, PaidRequest, RegExp]>([
    ['an unknown model', { kind: 'clip', request: firstFrame({ model: 'veo-3', resolution: '720p' }) }, /veo-3/],
    ['a resolution without a route', { kind: 'clip', request: firstFrame({ model: 'seedance-2-mini', resolution: '1080p' }) }, /1080p/],
    ['3 seconds', { kind: 'clip', request: firstFrame(mini, 3) }, /4 to 15/],
    ['31 seconds on seedance-2.5-pro', { kind: 'clip', request: firstFrame({ model: 'seedance-2.5-pro', resolution: '720p' }, 31) }, /4 to 30/],
    ['a ratio without a name', { kind: 'clip', request: speaker(mini, 8, '5:4') }, /5:4/],
    ['15 references', { kind: 'image', request: { prompt: 'x', references: Array.from({ length: 15 }, (_, i) => `/d/${i}.png`), aspect: '9:16' } }, /14/],
  ])('%s → a reason that names the problem', (_what, paid, names) => {
    expect(refusalOf(paid)).toMatch(names);
    expect(() => routeOf(paid)).toThrow(RouteError);
  });
  it.each<[string, PaidRequest, string]>([
    ['image', { kind: 'image', request: { prompt: 'x', references: ['/nowhere/a.gif'], aspect: '9:16' } }, '/v1/ai/text-to-image/nano-banana-pro'],
    ['clip', { kind: 'clip', request: firstFrame(mini, 4) }, '/v1/ai/video/seedance-2-mini-720p'],
    ['music', { kind: 'music', request: { prompt: 'bed' } }, '/v1/ai/music-generation/lyria-3'],
    ['voice', { kind: 'voice', request: { text: 'hi', voiceId: 'v' } }, '/v1/ai/voiceover/elevenlabs-turbo-v2-5'],
  ])('a request that can be sent (%s) → null, and routeOf gives its route', (_kind, paid, submit) => {
    expect(refusalOf(paid)).toBeNull();
    expect(routeOf(paid).submit).toBe(submit);
  });
});

describe('a person swap', () => {
  const swap: SwapPaid = {
    kind: 'swap',
    request: {
      video: '/d/parts/p01.mp4', people: [{ slot: 1, body: '/d/body.jpg', face: null, hint: 'the woman in a red dress' }],
      seconds: 8.5, tier: { model: 'wan-animate-replace', resolution: '720p' }, keepSound: false,
    },
  };
  it('has no route here, whatever its model and length: this provider replaces no person', () => {
    expect(refusalOf(swap)).toBe('this provider replaces no person in a video');
    expect(() => routeOf(swap)).toThrow(RouteError);
    expect(refusalOf({ kind: 'swap', request: { ...swap.request, seconds: 4, tier: mini } })).toBe('this provider replaces no person in a video');
  });
});
