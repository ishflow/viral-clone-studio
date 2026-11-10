import { z } from 'zod';
import type { GenerateInput } from '@/data/ports';

export const LANGUAGES = ['en', 'tr'] as const;

/** The longest product name and description; the boxes of the form stop at the same numbers. */
export const NAME_MAX = 120;
export const INFO_MAX = 300;

const product = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  description: z.string().trim().max(INFO_MAX),
  images: z.array(z.string().min(1).max(260)).min(1).max(8),
});

const form = z.object({
  templateId: z.string().min(1),
  products: z.array(product),
  quality: z.enum(['fast', 'best']),
  variants: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  language: z.enum(LANGUAGES),
});

/** One thing the customer has to fix: which product (0-based) and which field. */
export type FieldProblem = { product: number; field: 'name' | 'name-long' | 'description-long' | 'images' };

export type Parsed = { ok: true; input: GenerateInput } | { ok: false; problems: FieldProblem[] } | { ok: false; shape: true };

/** Checks the form on the server. A wrong shape is "shape"; missing or too long names, too long descriptions and missing images come back as problems, in board order. */
export function parseForm(raw: unknown, productCount: number): Parsed {
  const result = form.safeParse(raw);
  if (result.success) {
    if (result.data.products.length !== productCount) return { ok: false, shape: true };
    return { ok: true, input: result.data };
  }
  // The shape is right but a product is incomplete: report them one by one.
  const loose = z
    .object({
      templateId: z.string().min(1),
      products: z.array(z.object({ name: z.string(), description: z.string(), images: z.array(z.string()) })).length(productCount),
      quality: z.enum(['fast', 'best']),
      variants: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      language: z.enum(LANGUAGES),
    })
    .safeParse(raw);
  if (!loose.success) return { ok: false, shape: true };
  const problems: FieldProblem[] = [];
  loose.data.products.forEach((item, index) => {
    if (item.name.trim().length > NAME_MAX) problems.push({ product: index, field: 'name-long' });
    else if (!product.shape.name.safeParse(item.name).success) problems.push({ product: index, field: 'name' });
    if (item.description.trim().length > INFO_MAX) problems.push({ product: index, field: 'description-long' });
    if (!product.shape.images.safeParse(item.images).success) problems.push({ product: index, field: 'images' });
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: false, shape: true };
}

/** The shape of a stored photo path, the same as `UPLOAD_PATH` in `data/real/uploads.ts` (that file reads the disk, so a form cannot import it). */
const STORED_PHOTO = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[1-9][0-9]*\.(jpg|png|webp)$/;

/** What the tab keeps of an unfinished form (no template id: the key names it). It is read back as it was typed, so nothing is trimmed and nothing is required. */
const keptProduct = z.object({
  name: z.string().max(NAME_MAX),
  description: z.string().max(INFO_MAX),
  images: z.array(z.string()).max(8).transform((paths) => paths.filter((path) => STORED_PHOTO.test(path))),
});
const keptForm = z.object({
  products: z.array(keptProduct),
  quality: z.enum(['fast', 'best']),
  variants: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  language: z.enum(LANGUAGES),
});
export type KeptForm = z.infer<typeof keptForm>;

/** The form the tab kept, cut to the template's number of products; null when what is there is not of this shape. */
export function parseKeptForm(value: unknown, productCount: number): KeptForm | null {
  const result = keptForm.safeParse(value);
  return result.success ? { ...result.data, products: result.data.products.slice(0, productCount) } : null;
}
