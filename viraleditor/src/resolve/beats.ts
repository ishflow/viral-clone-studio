// A beats template: every shot and every text has its frames in the template; the fill only brings the copy. A shot that
// continues the clip of an earlier shot shows that clip from where its part starts (template/clips.ts).
import type { Edit, Shot } from '../edit/types.ts';
import { partsOf, partStarts } from '../template/clips.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { ResolveError } from './error.ts';
import type { ResolveMedia } from './index.ts';
import { audioOf, clipOf, documentBase, given, textOf } from './parts.ts';
import type { MediaTable, Placed } from './parts.ts';

export function resolveBeats(template: TemplateJson, fill: FillJson, media: ResolveMedia): Edit {
  const table: MediaTable = {};
  const from = partsPlaced(template, media, table);
  const shots: Shot[] = template.shots.map((shot) => ({
    id: shot.id, ...framesOf(shot, `shot "${shot.id}"`), media: clipOf(shot.continues ?? shot.id, media, table).key,
    ...given({ from: from.get(shot.id), in: shot.in, motion: shot.motion }),
  }));
  const texts = template.texts.map((text) => textOf(text, fill, framesOf(text, `text "${text.id}"`)));
  const last = shots.at(-1);
  return {
    ...documentBase(template, fill),
    frames: last ? last.at + last.for : 0,
    media: table, shots, texts,
    ...audioOf(template, media, table),
  };
}

/**
 * Where the shots that continue a clip start in it: shot id → its first source frame. The parts of a clip lie in the clip as it
 * came (`media.clips` of the shot that owns it): the owner from frame 0, the last part up to the clip's last frame, evenly between.
 */
function partsPlaced(template: TemplateJson, media: ResolveMedia, table: MediaTable): Map<string, number> {
  const from = new Map<string, number>();
  for (const owner of template.shots) {
    if (owner.continues !== undefined) continue;
    const parts = partsOf(template, owner.id);
    if (parts.length === 1) continue;
    const starts = partStarts(clipOf(owner.id, media, table).frames, parts.map((part) => part.frames));
    parts.forEach((part, k) => { if (k > 0) from.set(part.shot.id, starts[k]!); });
  }
  return from;
}

function framesOf(item: { at?: number | undefined; for?: number | undefined }, what: string): Placed {
  if (item.at === undefined || item.for === undefined) throw new ResolveError('template-invalid', `${what} has no at and for: a beats template gives both`);
  return { at: item.at, for: item.for };
}
