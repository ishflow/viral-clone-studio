import { data } from '@/data';

/**
 * Are the person-swap pages there: the admin's switch is on. While it is off, the pages answer 404 and no menu links to them. A switch
 * that is on with no video published is open: the list says there is no video yet.
 */
export async function personSwapOpen(): Promise<boolean> {
  return data.swap.enabled();
}
