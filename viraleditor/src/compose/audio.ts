// Sound (design §5.7, §12.1–3): the music as one <audio> per pass with its gain as a volume lane (seconds local to the
// element), a shot's own sound and the effects with a constant data-volume.
import { tailOf } from '../edit/presets.ts';
import { fileOf, timing } from './build.ts';
import type { Build } from './build.ts';
import { musicPasses } from '../edit/music.ts';
import { seconds } from './time.ts';

function element(b: Build, id: string, media: string, at: number, length: number, from: number, volume: string): string {
  return `      <audio id="${id}" src="${fileOf(b, media)}" ${timing(b, at, length)} data-media-start="${seconds(from, b.fps)}" data-track-index="${b.tracks.take(at, length, true)}" ${volume}></audio>`;
}

/** Every <audio> element, direct children of the root. Fills timeline.audio. */
export function audioHtml(b: Build): string[] {
  const { edit } = b;
  const lines: string[] = [];
  const music = edit.audio?.music;
  if (music) {
    musicPasses(edit, b.facts[music.media]!.frames).forEach((pass, k) => {
      const id = `music-${k + 1}`;
      const lane = { version: 1, lanes: [{ target: 'volume', points: pass.points.map(([frame, v]) => ({ t: (frame - pass.at) / b.fps, v })) }] };
      b.timeline.audio.push({ element: id, media: music.media, at: pass.at, for: pass.for, from: pass.from, gain: pass.points });
      lines.push(element(b, id, music.media, pass.at, pass.for, pass.from, `data-automation='${JSON.stringify(lane)}'`));
    });
  }
  edit.shots.forEach((shot, i) => {
    if (!shot.sound) return;
    const id = `${shot.id}-sound`;
    const length = shot.for + tailOf(edit.shots, i);
    const from = shot.from ?? 0;
    b.timeline.audio.push({ element: id, media: shot.media, at: shot.at, for: length, from, gain: [[shot.at, shot.sound.gain], [shot.at + length, shot.sound.gain]] });
    lines.push(element(b, id, shot.media, shot.at, length, from, `data-volume="${shot.sound.gain}"`));
  });
  for (const sound of edit.audio?.sounds ?? []) {
    const from = sound.from ?? 0;
    const length = sound.for ?? b.facts[sound.media]!.frames - from;
    b.timeline.audio.push({ element: sound.id, media: sound.media, at: sound.at, for: length, from, gain: [[sound.at, sound.gain], [sound.at + length, sound.gain]] });
    lines.push(element(b, sound.id, sound.media, sound.at, length, from, `data-volume="${sound.gain}"`));
  }
  return lines;
}
