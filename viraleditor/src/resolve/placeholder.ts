// Media that stands in for the paid media: every clip as long as it is asked for (one per shot that owns a clip), every word spoken evenly.
// With it, resolve (and then compose) can run on a template and a fill before anything is paid for, and in tests.
import type { ComposeFacts, Edit } from '../edit/types.ts';
import type { Word } from '../ports.ts';
import { clipShots } from '../template/clips.ts';
import { billedSeconds } from '../template/limits.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { own, ResolveError } from './error.ts';
import type { ResolveMedia } from './index.ts';
import { parseScript } from './script.ts';

const LEAD_SECONDS = 0.2;                                       // silence at the head and the tail of a talking clip

export function placeholderMedia(template: TemplateJson, fill: FillJson): ResolveMedia {
  const fps = template.canvas.fps;
  const speech = template.mode === 'speech';
  const clips: ResolveMedia['clips'] = {};
  const words: ResolveMedia['words'] = {};
  let frames = 0;
  for (const shot of clipShots(template)) {                     // a shot that continues a clip has none of its own
    const length = speech ? Math.round(shot.clip_seconds * fps) : billedSeconds(shot.clip_seconds) * fps;
    clips[shot.id] = { file: `assets/clip-${shot.id}.mp4`, frames: length };
    if (speech) frames += length;
    if (shot.segment !== undefined) words[shot.segment] = spoken(parseScript(own(fill.script, shot.segment) ?? '').words, shot.clip_seconds);
  }
  if (!speech) frames = template.shots.reduce((end, shot) => Math.max(end, (shot.at ?? 0) + (shot.for ?? 0)), 0);
  const images: ResolveMedia['images'] = {};
  fill.products.forEach((product, p) => product.images.forEach((_, i) => {
    images[i === 0 ? `product:${p + 1}` : `product:${p + 1}.${i + 1}`] = `assets/product-${p + 1}-${i + 1}.png`;
  }));
  for (const still of template.stills ?? []) images[`still:${still.id}`] = `assets/still-${still.id}.png`;
  return { clips, music: { file: 'assets/music.mp3', frames }, images, words };
}

function spoken(texts: string[], seconds: number): Word[] {
  const step = (seconds - 2 * LEAD_SECONDS) / Math.max(1, texts.length);
  return texts.map((text, i) => ({ text, start: LEAD_SECONDS + i * step, end: LEAD_SECONDS + (i + 0.9) * step }));
}

/**
 * What compose needs to know about the media of `resolve(template, fill, placeholderMedia(...))`, without a file on disk.
 * A video has sound when a shot of the document plays its own sound. Throws `media-unknown-file` for a file `media` does not list.
 */
export function placeholderFacts(edit: Edit, media: ResolveMedia): Record<string, ComposeFacts> {
  const facts: Record<string, ComposeFacts> = {};
  for (const [key, { file, kind }] of Object.entries(edit.media)) {
    if (kind === 'image') {
      // 1024 x 1024: a product photograph's usual shape. The real size comes from the probe after payment; a `contain` card fits any size.
      facts[key] = { frames: 1, audio: false, width: 1024, height: 1024 };
    } else if (kind === 'audio') {
      if (media.music?.file !== file) throw new ResolveError('media-unknown-file', `the document's media "${key}" is ${file}, which the media does not list`);
      facts[key] = { frames: media.music.frames, audio: true };
    } else {
      const clip = Object.values(media.clips).find((candidate) => candidate.file === file);
      if (clip === undefined) throw new ResolveError('media-unknown-file', `the document's media "${key}" is ${file}, which the media does not list`);
      facts[key] = { frames: clip.frames, audio: edit.shots.some((shot) => shot.media === key && shot.sound !== undefined) };
    }
  }
  return facts;
}
