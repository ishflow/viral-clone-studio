import { z } from 'zod';
import type { Quality, SwapConsent, SwapInput } from '@/data/ports';

/** Person swap opens with one quality (the plan's decision 5): the one every screen asks the price of and every job starts with. */
export const SWAP_QUALITY: Quality = 'fast';

const photo = z.string().min(1).max(260);
const form = z.object({
  templateId: z.string().min(1),
  people: z.array(z.object({ slot: z.number().int().min(1), body: photo, face: photo.nullable(), side: photo.nullish() })).max(2),
  outfit: z.enum(['keep', 'photo']).default('keep'),
  consent: z.object({ ownPerson: z.boolean(), adults: z.boolean(), notCelebrity: z.boolean(), version: z.string().min(1).max(20) }),
});

/** What the person-swap form sends, as the data layer wants it; null when it is not of that shape. Whether it may start is the data layer's answer. */
export function parseSwapForm(raw: unknown): { input: SwapInput; consent: SwapConsent } | null {
  const result = form.safeParse(raw);
  if (!result.success) return null;
  const { templateId, people, outfit, consent } = result.data;
  return { input: { templateId, quality: SWAP_QUALITY, people, outfit }, consent };
}
