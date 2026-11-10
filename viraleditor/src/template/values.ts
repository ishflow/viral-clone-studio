// The values a template or a fill may carry. A template is written by an LLM and a fill carries customer text:
// every value that reaches HTML, a file path or a paid request has a pattern or a bound here.
import { z } from 'zod';

/** Ids of shots, texts, cards, stills, segments and style names. 24 characters, so that a media key made from one (`clip-<id>`, `still-<id>`) is still a valid id of the edit document (32). */
export const Id = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, 'an id is a lower-case letter, then at most 23 lower-case letters, digits or hyphens');
/** A mark of the script: the name between the brackets of `[name]…[/name]`. */
export const MARK_NAME = '[a-z][a-z0-9-]{0,23}';
export const Mark = z.string().regex(new RegExp(`^${MARK_NAME}$`), 'a mark name is a lower-case letter, then at most 23 lower-case letters, digits or hyphens');

export const Frame = z.number().int().min(0);
export const Frames = z.number().int().min(1);
export const Percent = z.number().min(0).max(100);
export const Colour = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'a colour is #rgb, #rrggbb or #rrggbbaa');
export const Shadow = z.string().regex(/^-?\d+(\.\d+)?px -?\d+(\.\d+)?px \d+(\.\d+)?px #(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'a shadow is "<x>px <y>px <blur>px #colour"');

/** Percent of the canvas. right and bottom are edges, not insets. */
export const Box = z.strictObject({ left: Percent, top: Percent, right: Percent, bottom: Percent })
  .refine((box) => box.left < box.right && box.top < box.bottom, 'a box needs left < right and top < bottom');

// ── text ──
// No text may hold a C0 or C1 control character or a bidirectional override or isolate (they reorder what a reader sees).
// The line break is the one control character some texts may hold.
const FORBIDDEN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
const PLACEHOLDER = /\{([A-Za-z0-9_.:-]+)\}/g;                  // the editor's own pattern: what it refuses in a copy or a caption word

/** The `{placeholder}` names left in a text, each once, in order. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]!))];
}

const clean = (value: string, breaks: boolean) => !FORBIDDEN.test(value) && (breaks || !value.includes('\n'));
const CLEAN = 'control characters and bidirectional overrides are not allowed';
const ONE_LINE = 'control characters, bidirectional overrides and line breaks are not allowed';

/** Text of 1 … max characters, not blank. `breaks`: may it hold line breaks? */
const text = (max: number, breaks: boolean) => z.string().min(1).max(max)
  .refine((value) => clean(value, breaks), breaks ? CLEAN : ONE_LINE)
  .refine((value) => value.trim().length > 0, 'the text is blank');
/** The same, and no `{placeholder}` left: what a fill must hand over. The issue message is `unfilled:<placeholder>`. */
const filled = (max: number, breaks: boolean) => text(max, breaks).superRefine((value, ctx) => {
  for (const name of placeholdersIn(value)) ctx.addIssue({ code: 'custom', message: `unfilled:${name}` });
});

export const COPY_MAX = 200;                                    // the edit document's limit for one text
export const Copy = text(COPY_MAX, true);                       // on screen; a template's copy is a pattern and may hold {placeholders}
export const FilledCopy = filled(COPY_MAX, true);
export const Prompt = text(2000, true);                         // for a paid generation request; a template's prompt is a pattern
export const FilledPrompt = filled(2000, true);
export const Lines = text(1500, true);                          // what one segment says, with marks
export const FilledLines = filled(1500, true);
export const Sentence = text(200, false);                       // one line read by a person on the site
export const FilledName = filled(120, false);                   // a product's name
/** Text of 0 … max characters. `breaks`: may it hold line breaks? */
export const plain = (max: number, breaks = false) => z.string().max(max).refine((value) => clean(value, breaks), breaks ? CLEAN : ONE_LINE);
export const SourceCopy = plain(500, true);                     // the reference's own text; may be empty

// ── references ──
/** The products a shot shows: every product of the customer, or one by number. */
export const ProductRef = z.string().regex(/^(?:all|[1-5])$/, 'a product is "all" or a number from "1" to "5"');
/**
 * A picture: `product:N` (the first photograph of the customer's product N), `product:N.M` (its photograph M, 2 … 5:
 * an element that asks for a photograph the customer did not give is left out) or `still:<id>` (a generated still of the template).
 */
export const ImageRef = z.string().regex(/^(?:product:[1-5](?:\.[2-5])?|still:[a-z][a-z0-9-]{0,23})$/, 'a picture is "product:N", "product:N.M" or "still:<id>"');

/** A photograph of the customer: `product:N` or `product:N.M`. What the presenter still is made from. */
export const ProductPicture = z.string().regex(/^product:[1-5](?:\.[2-5])?$/, 'a photograph is "product:N" or "product:N.M"');

/** What an image reference names. */
export function imageOf(ref: string): { kind: 'product'; product: number; photograph: number } | { kind: 'still'; id: string } {
  if (ref.startsWith('still:')) return { kind: 'still', id: ref.slice('still:'.length) };
  const [product, photograph] = ref.slice('product:'.length).split('.');
  return { kind: 'product', product: Number(product), photograph: photograph === undefined ? 1 : Number(photograph) };
}
