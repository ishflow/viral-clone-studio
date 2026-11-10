/** The pack shown as the lime card, chosen by id (never by position). No pack with this id: no lime card. */
export const FEATURED_PACK_ID = 'pack-standard';

/**
 * Where a visitor's Buy button goes: sign up first, then back to pricing.
 * A signed-in user gets a form instead: starting a checkout is a POST (see the pricing page), never an address.
 */
export const VISITOR_BUY_HREF = `/signup?next=${encodeURIComponent('/pricing')}`;
