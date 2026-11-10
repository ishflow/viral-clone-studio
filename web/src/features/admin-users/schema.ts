import { z } from 'zod';
import { REASON_MAX } from '../admin-common/types';

export const MAX_CREDITS = 10_000;

/** The reason of an admin action: required, trimmed, at most 200 characters. */
export const reasonSchema = z.string().trim().min(1).max(REASON_MAX);

export const addCreditsSchema = z.object({
  userId: z.string().min(1),
  credits: z.number().int().min(1).max(MAX_CREDITS),
  reason: reasonSchema,
  key: z.string().trim().min(1),
});
export type AddCreditsInput = z.infer<typeof addCreditsSchema>;

export const accessSchema = z.object({ userId: z.string().min(1), blocked: z.boolean(), reason: reasonSchema });
