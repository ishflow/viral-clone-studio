// Pictures over the footage (design §5.6). A card is one timed <img> (object-fit: cover on its rect). A card with a motion is built as a shot is:
// the enter and exit on an untimed box (clock: frame 0), the zoom on the timed <img> inside it, because both drive --ve-s.
import { CARD_RADIUS, cardMotion, motionFrames, motionScale } from '../edit/presets.ts';
import type { Card } from '../edit/types.ts';
import { animation, enterMoves, exitMoves, join, movesStyle, row } from './animation.ts';
import { fileOf, note, timing, words } from './build.ts';
import type { Build } from './build.ts';
import { containRect, px, rectOf } from './layout.ts';

/** One card, inside #overlays. Fills timeline.cards. */
export function cardHtml(b: Build, card: Card): string {
  const size = b.facts[card.media];
  // a card shows its whole picture unless it says `cover`: its rect is then the picture's shape inside the box
  const rect = (card.fit ?? 'contain') === 'contain' ? containRect(rectOf(card.box, b.canvas), { width: size!.width!, height: size!.height! }) : rectOf(card.box, b.canvas);
  const radius = px(card.radius ?? CARD_RADIUS, b.canvas.width);
  const motion = cardMotion(card);
  const end = card.at + card.for;
  const restAt = card.at + motionFrames(motion.enter);
  const clock = { base: card.motion ? 0 : card.at, fps: b.fps, canvas: b.canvas };
  const moves = join(enterMoves(motion.enter, card.at, clock), exitMoves(motion.exit, end, clock));
  const box = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;border-radius:${radius}px;`;
  const time = `${timing(b, card.at, card.for)} data-track-index="${b.tracks.take(card.at, card.for)}"`;
  const src = `src="${fileOf(b, card.media)}" alt=""`;
  b.timeline.cards.push({ id: card.id, element: card.id, media: card.media, at: card.at, for: card.for, rect, rest: { at: restAt, for: end - motionFrames(motion.exit) - restAt } });
  if (!card.motion) {
    note(b, card.id, moves.rows);
    return `        <img id="${card.id}" class="${words('clip ve-card', moves.animations.length > 0 && 've-m', moves.blur && 've-mb')}" ${src} ${time} style="${box}${movesStyle(moves)}" />`;
  }
  const { from, to } = motionScale(card.motion);
  const ease = card.motion.kind === 'punch-in' ? 'out' : card.motion.ease ?? 'linear';     // validate: a card has no punch-in
  note(b, `${card.id}-box`, moves.rows);
  note(b, card.id, [row('scale', card.at, card.for, from, to, ease, 'both')]);
  const zoom = `--ve-s0:${from};--ve-s1:${to};animation:${animation('ve-scale', card.at, card.for, ease, 'both', card.at, b.fps)}`;
  return `        <div id="${card.id}-box" class="${words('ve-card-box', moves.animations.length > 0 && 've-m', moves.blur && 've-mb')}" style="${box}${movesStyle(moves)}">`
    + `<img id="${card.id}" class="clip ve-m" data-layout-allow-overflow ${src} ${time} style="${zoom}" /></div>`;
}
