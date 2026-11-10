// The optional fields a template takes over from the edit document (design §8): transitions, motion on shots, enter and exit
// animations, text styles, caption grouping, ducking, the safe area. Same names and types as src/edit/types.ts, so that
// resolve copies them as they are; the bounds are the ones the editor refuses beyond.
import { z } from 'zod';
import type * as Edit from '../edit/types.ts';
import { Colour, Frame, Frames, Id, Percent, Shadow } from './values.ts';

const Ease = z.enum(['linear', 'out', 'in', 'in-out', 'back', 'whip']);
const Side = z.enum(['left', 'right', 'top', 'bottom']);
const Zoom = z.number().min(1.01).max(1.5);                     // a scale of a motion or a zoom
const Pop = z.number().min(0).max(2);                           // the scale an element pops from or to
const BlurRadius = z.number().min(0).max(10);                   // percent of the canvas width

const pushIn = z.strictObject({ kind: z.literal('push-in'), to: Zoom.optional(), ease: Ease.optional() });
const pullOut = z.strictObject({ kind: z.literal('pull-out'), from: Zoom.optional(), ease: Ease.optional() });
const punchIn = z.strictObject({ kind: z.literal('punch-in'), at: Frame, to: Zoom.optional(), frames: Frames.optional() });
export const Motion = z.discriminatedUnion('kind', [pushIn, pullOut, punchIn]);
/** The motion of a picture that is not a shot (a card, the picture behind a window): a slow zoom only. */
export const SlowMotion = z.discriminatedUnion('kind', [pushIn, pullOut]);

export const Transition = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cut') }),
  z.strictObject({ kind: z.literal('crossfade'), frames: Frames.optional() }),
  z.strictObject({ kind: z.literal('push'), to: Side, frames: Frames.optional() }),
  z.strictObject({ kind: z.literal('whip'), to: Side, frames: Frames.optional() }),
  z.strictObject({ kind: z.literal('zoom'), frames: Frames.optional(), scale: Zoom.optional() }),
  z.strictObject({ kind: z.literal('flash'), frames: Frames.optional(), colour: Colour.optional() }),
  z.strictObject({ kind: z.literal('dip'), frames: Frames.optional(), colour: Colour.optional() }),
]);
/** How many frames of the outgoing clip a transition needs after the cut (design §4.3). The other kinds need none. */
export function tailOf(transition: z.infer<typeof Transition> | undefined): number {
  if (transition?.kind === 'crossfade' || transition?.kind === 'whip') return transition.frames ?? 8;
  if (transition?.kind === 'push') return transition.frames ?? 10;
  return 0;
}

export const Enter = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('fade'), frames: Frames.optional() }),
  z.strictObject({ kind: z.literal('pop'), frames: Frames.optional(), from: Pop.optional() }),
  z.strictObject({ kind: z.literal('slide'), from: Side, frames: Frames.optional(), distance: Percent.optional() }),
  z.strictObject({ kind: z.literal('blur'), frames: Frames.optional(), radius: BlurRadius.optional() }),
]);
export const Exit = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('fade'), frames: Frames.optional() }),
  z.strictObject({ kind: z.literal('pop'), frames: Frames.optional(), to: Pop.optional() }),
  z.strictObject({ kind: z.literal('slide'), to: Side, frames: Frames.optional(), distance: Percent.optional() }),
  z.strictObject({ kind: z.literal('blur'), frames: Frames.optional(), radius: BlurRadius.optional() }),
]);

export const TextStyle = z.strictObject({
  font: z.enum(['Inter', 'Montserrat']),
  weight: z.number().min(100).max(900),
  size: z.number().min(8).max(400),                             // px on the template's canvas
  align: z.enum(['left', 'center', 'right']),
  fill: Colour,
  shadows: z.array(Shadow).max(8),
  upper: z.boolean().optional(),
  tracking: z.number().min(-0.05).max(0.3).optional(),
  leading: z.number().min(1).max(2).optional(),
  outline: z.strictObject({ width: z.number().min(0.02).max(0.12), colour: Colour }).optional(),
  plate: z.strictObject({ colour: Colour, radius: z.number().min(0).max(2), padX: z.number().min(0).max(2), padY: z.number().min(0).max(2) }).optional(),
});

export const CaptionGroup = z.strictObject({
  words: z.number().int().min(1).max(4).optional(),
  lines: z.union([z.literal(1), z.literal(2)]).optional(),
  hold: z.number().int().min(0).optional(),
  pause: Frames.optional(),
});
export const CaptionActive = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('colour'), colour: Colour, scale: z.number().min(1).max(1.5).optional() }),
  z.strictObject({ kind: z.literal('pill'), colour: Colour, text: Colour.optional() }),
]);

export const Duck = z.strictObject({
  to: z.number().min(0).max(2),
  ramp: Frames.optional(),
  under: z.union([z.literal('sound'), z.literal('captions'), z.array(z.strictObject({ at: Frame, for: Frames })).min(1).max(64)]),
});
export const Safe = z.enum(['tiktok', 'reels', 'both', 'none']);
export const Corner = z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
export const WindowWidth = z.number().min(20).max(50);          // percent of the canvas width; 50 is what compose allows under the default safe area (both / reels): a window is as high as it is wide
export const WindowRadius = z.number().min(0).max(8);
export const CardRadius = z.number().min(0).max(50);
export const StyleName = Id;                                    // becomes a CSS class

// Compile-time proof that what a template may say fits the edit document: a line here stops compiling when the two drift apart.
type Fits<Given extends Wanted, Wanted> = Given;
export type FitsTheEditDocument = [
  Fits<z.infer<typeof Motion>, Edit.Motion>,
  Fits<z.infer<typeof SlowMotion>, Edit.Motion>,
  Fits<z.infer<typeof Transition>, Edit.Transition>,
  Fits<z.infer<typeof Enter>, Edit.Enter>,
  Fits<z.infer<typeof Exit>, Edit.Exit>,
  Fits<z.infer<typeof TextStyle>, Edit.TextStyle>,
  Fits<z.infer<typeof CaptionGroup>, NonNullable<Edit.Captions['group']>>,
  Fits<z.infer<typeof CaptionActive>, NonNullable<Edit.Captions['active']>>,
  Fits<z.infer<typeof Duck>, NonNullable<NonNullable<Edit.Audio['music']>['duck']>>,
  Fits<z.infer<typeof Safe>, NonNullable<Edit.Edit['safe']>>,
  Fits<z.infer<typeof Corner>, Edit.Window['corner']>,
];
