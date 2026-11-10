// The stand-in media of a template check: clips with the frame bar, a tone, plain pictures. Made on this machine, never asked
// from a provider. `Placeholders` is deliberately not a `Generator`: it has no request, no ticket and no paid method, so the
// generator of a production run cannot be handed to the check by mistake.
import { basename, extname, join } from 'node:path';
import { createFakeGenerator } from '../adapters/fake-generator.ts';
import type { ResolveMedia } from '../resolve/index.ts';
import { clipShots } from '../template/clips.ts';
import { billedSeconds } from '../template/limits.ts';
import type { TemplateJson } from '../template/schema.ts';

/** One file of a composition's `assets/` folder. `file`: its name there. `seconds`: whole seconds. */
export type PlaceholderNeed =
  | { kind: 'clip'; file: string; seconds: number; sound: boolean }
  | { kind: 'image'; file: string; label: string }
  | { kind: 'music'; file: string; seconds: number };

export interface Placeholders {
  /** Writes every needed file into `dir`. */
  make(needs: PlaceholderNeed[], dir: string, canvas: { width: number; height: number; fps: number }): Promise<void>;
}

/**
 * What stands in for each file a composition names (`assets/<name>`, as `placeholderMedia` names them). A clip is as long as
 * it is billed, which is never shorter than the frames the document uses; the music is as long as the video.
 */
export function needsOf(template: TemplateJson, media: ResolveMedia, files: string[]): PlaceholderNeed[] {
  const sound = template.mode === 'speech';
  return files.map((path): PlaceholderNeed => {
    const file = basename(path);
    const shot = clipShots(template).find((candidate) => media.clips[candidate.id]?.file === path);
    if (shot !== undefined) return { kind: 'clip', file, seconds: billedSeconds(shot.clip_seconds), sound };
    if (media.music?.file === path) return { kind: 'music', file, seconds: Math.max(1, Math.ceil(media.music.frames / template.canvas.fps)) };
    return { kind: 'image', file, label: basename(file, extname(file)) };
  });
}

/** The cheapest tier of the default settings: the fake generator refuses what the real client would refuse, so a request has to name a real one. */
const TIER = { model: 'seedance-2-mini', resolution: '720p' };
/** The fake generator's voice is a tone of this many seconds per word; its music is always 30 s, too short for a long video. */
const TONE_SECONDS_PER_WORD = 0.4;

/** Makes the files with the fake generator (`adapters/fake-generator.ts`): ffmpeg on this machine, no network. Its log lies next to the files. */
export function localPlaceholders(options: { ffmpeg?: string } = {}): Placeholders {
  return {
    async make(needs, dir, canvas) {
      const generator = createFakeGenerator({ log: join(dir, 'placeholders.log'), clip: canvas, ffmpeg: options.ffmpeg });
      const submitted = () => {};
      for (const need of needs) {
        const to = join(dir, need.file);
        if (need.kind === 'image') {
          await generator.image({ prompt: need.label, references: [], aspect: '9:16' }, to, submitted);
        } else if (need.kind === 'music') {
          const words = Math.ceil(need.seconds / TONE_SECONDS_PER_WORD);
          await generator.voice({ text: Array.from({ length: words }, () => 'la').join(' '), voiceId: 'placeholder' }, to, submitted);
        } else if (need.sound) {
          await generator.clip({ mode: 'speaker', presenter: to, voice: to, prompt: need.file, seconds: need.seconds, tier: TIER, aspect: '9:16' }, to, submitted);
        } else {
          await generator.clip({ mode: 'first-frame', firstFrame: to, prompt: need.file, seconds: need.seconds, tier: TIER }, to, submitted);
        }
      }
    },
  };
}
