import { z } from 'zod';
import type { Shot } from '@/data/ports';

export type ShotErrorCode = 'none' | 'range' | 'order' | 'product' | 'invalid';
export type EditErrors = { title?: 'invalid'; category?: 'invalid'; products?: 'invalid'; shots?: { code: ShotErrorCode; n: number }; form?: 'failed' | 'transition' };

const shotSchema = z.object({
  from: z.number().finite(),
  to: z.number().finite(),
  action: z.string().trim().min(1).max(200),
  text: z.string().trim().max(120),
  product: z.number().int().min(1).nullable(),
});

const formSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(3).max(120),
  category: z.string().trim().min(1).max(60),
  products: z.coerce.number().int().min(1).max(8),
  visibility: z.enum(['published', 'hidden', '']),
});

export type EditInput = { id: string; title: string; category: string; products: number; visibility: 'published' | 'hidden' | ''; shots: Shot[] };

/**
 * The edit form → typed value, or the fields that failed (codes, never prose).
 * Shots: at least one, each inside 0…`seconds`, in order, not overlapping, `product` not above the products needed.
 */
export function parseEditForm(form: FormData, seconds: number): { ok: true; value: EditInput } | { ok: false; errors: EditErrors } {
  const errors: EditErrors = {};
  const raw = Object.fromEntries(['id', 'title', 'category', 'products', 'visibility'].map((k) => [k, String(form.get(k) ?? '')]));
  const fields = formSchema.safeParse((raw.products ?? '').trim() === '' ? { ...raw, products: Number.NaN } : raw);
  if (!fields.success) {
    for (const issue of fields.error.issues) {
      const field = issue.path[0];
      if (field === 'title' || field === 'category' || field === 'products') errors[field] = 'invalid';
      else errors.form = 'failed';
    }
  }
  let list: unknown;
  try {
    list = JSON.parse(String(form.get('shots') ?? '[]'));
  } catch {
    list = null;
  }
  const shots: Shot[] = [];
  if (!Array.isArray(list)) errors.form = 'failed';
  else if (list.length === 0) errors.shots = { code: 'none', n: 0 };
  else {
    const products = fields.success ? fields.data.products : 8;
    let end = 0;
    for (let i = 0; i < list.length && !errors.shots; i++) {
      const n = i + 1;
      const parsed = shotSchema.safeParse(list[i]);
      if (!parsed.success) errors.shots = { code: 'invalid', n };
      else if (parsed.data.from < 0 || parsed.data.to > seconds || parsed.data.to <= parsed.data.from) errors.shots = { code: 'range', n };
      else if (parsed.data.from < end) errors.shots = { code: 'order', n };
      else if (parsed.data.product !== null && parsed.data.product > products) errors.shots = { code: 'product', n };
      else {
        end = parsed.data.to;
        shots.push({ n, ...parsed.data, text: parsed.data.text });
      }
    }
  }
  if (Object.keys(errors).length > 0 || !fields.success) return { ok: false, errors };
  return { ok: true, value: { ...fields.data, shots } };
}
