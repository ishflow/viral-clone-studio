import type { Template } from '@/data/ports';

/**
 * Does the free video cover this template (contract section 3)? A template without talking, and a page that may promise a free
 * video: `offer` is `freeOffer()` in core (a customer is told what is true for them, a visitor follows the admin's setting).
 */
export function freeApplies(template: Pick<Template, 'format'>, offer: boolean): boolean {
  return template.format === 'no-talking' && offer;
}
