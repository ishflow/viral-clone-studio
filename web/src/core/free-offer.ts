import { data } from '@/data';
import type { User } from '@/data/ports';

/**
 * May a page tell this viewer "your first video is free"? A verified customer is told what is true for them (their own free video
 * is there or it is not); a visitor and an account that has not verified yet follow the admin's setting, as the gallery does.
 */
export async function freeOffer(user: Pick<User, 'emailVerified' | 'freeVideoAvailable'> | null): Promise<boolean> {
  if (user?.emailVerified) return user.freeVideoAvailable;
  return (await data.admin.limits()).freeFirstVideo;
}
