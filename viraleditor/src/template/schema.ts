// template.json (what the catalog stores for one video structure) and fill.json (one customer's adaptation of it).
// Both are strict: an unknown key is an error. Field by field: docs/reference/template-format.md.
import { z } from 'zod';
import { SHOT_SECONDS_MAX, SHOT_STILLS_MAX } from './limits.ts';
import { CaptionActive, CaptionGroup, CardRadius, Corner, Duck, Enter, Exit, Motion, Safe, SlowMotion, StyleName, TextStyle, Transition, WindowRadius, WindowWidth } from './motion.ts';
import { templateRules } from './rules.ts';
import { Box, Copy, FilledCopy, FilledLines, FilledName, FilledPrompt, Frame, Frames, Id, ImageRef, Lines, Mark, plain, ProductPicture, ProductRef, Prompt, Sentence, SourceCopy } from './values.ts';

const Shot = z.strictObject({
  id: Id,
  at: Frame.optional(), for: Frames.optional(),             // beats: the frames the shot owns
  segment: Id.optional(),                                   // speech: the script segment the presenter speaks in this shot
  products: z.array(ProductRef).max(5),                     // the customer's products seen in the shot: reference images of its paid requests
  still_prompt: Prompt.optional(),                          // beats: the first frame of the shot, a generated image
  stills: z.array(Id).max(SHOT_STILLS_MAX).optional(),      // beats: generated pictures of "stills" the shot's first frame is made from (a person or a place that returns): reference images of its image request, before the products
  continues: Id.optional(),                                 // beats: this shot shows a later part of the clip of the earlier shot named here: it has no image, no clip and no prompts of its own
  motion_prompt: Prompt.optional(),                         // beats: what moves in the clip made from that image · speech: how the presenter performs the segment. Required by the rules, except on a shot that continues a clip
  clip_seconds: z.number().positive().max(SHOT_SECONDS_MAX).optional(),   // the length asked from the provider; billed as max(4, ceil). Required by the rules, except on a shot that continues a clip
  action: Sentence,                                         // one short sentence a person reads on the site; never a prompt
  in: Transition.optional(),
  motion: Motion.optional(),
});
const Text = z.strictObject({
  id: Id,
  at: Frame.optional(), for: Frames.optional(),             // beats
  mark: Mark.optional(),                                    // speech: on screen while the words of this mark are spoken
  box: Box,
  style: StyleName,
  copy: Copy,                                               // the pattern the fill adapts; may hold {placeholders}
  source_copy: SourceCopy,                                  // the reference's own text: never shown to the adapting model, never in a video; kept so that a fill repeating it can be refused
  lines: z.number().int().min(1).max(4).optional(),
  enter: Enter.optional(), exit: Exit.optional(),
});
const Segment = z.strictObject({ id: Id, lines: Lines, seconds: z.number().positive().max(SHOT_SECONDS_MAX) });
const Still = z.strictObject({ id: Id, prompt: Prompt, references: z.array(ImageRef).max(4) });
const Card = z.strictObject({
  id: Id, mark: Mark, image: ImageRef, box: Box,
  radius: CardRadius.optional(),
  enter: Enter.optional(), exit: Exit.optional(),
  motion: SlowMotion.optional(),
  safe: z.literal(false).optional(),                        // false: may leave the safe area (a full-frame picture)
});
const Window = z.strictObject({
  mark: Mark,
  corner: Corner,
  width: WindowWidth.optional(), radius: WindowRadius.optional(), frames: Frames.optional(),
  behind: ImageRef,                                         // the picture that fills the frame while the presenter is in the window
  behindMotion: SlowMotion.optional(),
});
const Captions = z.strictObject({
  box: Box,
  style: StyleName.optional(),
  group: CaptionGroup.optional(),
  active: CaptionActive.optional(),
  enter: Enter.optional(),
});

/** The fields of a template. `Template` adds the rules that span several fields (rules.ts). */
export const TemplateShape = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),      // also a folder name
  source: z.strictObject({
    kind: z.enum(['topads', 'shorts', 'link', 'upload', 'seed']),
    url: z.string().max(500).regex(/^(?:https?:\/\/[^\s"'<>\\]+)?$/),
    metrics: z.strictObject({ views: z.number().min(0), likes: z.number().min(0), ctr_band: plain(40) }),
  }),
  title: Sentence, description: plain(600, true), category: plain(60), tags: z.array(plain(40).min(1)).max(12),
  mode: z.enum(['beats', 'speech']),
  canvas: z.strictObject({ width: z.union([z.literal(720), z.literal(1080)]), height: z.union([z.literal(1280), z.literal(1920)]), fps: z.literal(30) }),
  products: z.strictObject({ min: z.number().int().min(1).max(5), max: z.number().int().min(1).max(5) }),
  people: z.enum(['none', 'hands', 'face']),
  shots: z.array(Shot).min(1).max(30),
  texts: z.array(Text).max(30),
  styles: z.record(StyleName, TextStyle),
  audio: z.strictObject({ music: z.strictObject({ prompt: Prompt, gain: z.number().min(0).max(2), duck: Duck.optional(), fadeOut: z.number().int().min(0).optional() }) }),
  safe: Safe.optional(),
  // speech only:
  script: z.strictObject({ segments: z.array(Segment).min(1).max(8) }).optional(),
  presenter: z.strictObject({
    still_prompt: Prompt,
    references: z.array(ProductPicture).max(4),             // the customer's photographs the presenter still is made from; a talking clip takes none of its own
    voice: z.strictObject({ voice_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), sample_text: Prompt.max(500) }),
  }).optional(),
  stills: z.array(Still).max(6).optional(),                 // also beats. Generated pictures (speech: evidence images · beats: what a shot's "stills" names); each is one paid image per variant
  cards: z.array(Card).max(12).optional(),
  windows: z.array(Window).max(6).optional(),
  captions: Captions.optional(),
});
export const Template = TemplateShape.superRefine((template, ctx) => {
  templateRules(template, (path, message) => ctx.addIssue({ code: 'custom', path, message }));
});

export const Fill = z.strictObject({
  language: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/),      // BCP 47: 'en', 'tr', 'pt-BR'
  products: z.array(z.strictObject({
    name: FilledName,
    images: z.array(z.string().max(300).regex(/^uploads\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/, 'a path under uploads/, without ".." and without a leading dot')).min(1).max(5),
  })).min(1).max(5),
  texts: z.record(Id, FilledCopy),                                              // text id → the copy on screen
  shots: z.record(Id, z.strictObject({ still_prompt: FilledPrompt.optional(), motion_prompt: FilledPrompt })),   // shot id → its prompts: every shot that owns a clip, none that continues one
  music: z.strictObject({ prompt: FilledPrompt }),
  // speech only:
  script: z.record(Id, FilledLines).optional(),                                 // segment id → its lines, with every mark of the template
  presenter: z.strictObject({ still_prompt: FilledPrompt }).optional(),
  stills: z.record(Id, z.strictObject({ prompt: FilledPrompt })).optional(),    // also beats: still id → its prompt
});

export type TemplateJson = z.infer<typeof Template>;
export type FillJson = z.infer<typeof Fill>;
