/**
 * Starting a checkout is a POST (the Buy form, `startCheckout`). This address opens nothing: a link to it can be prefetched or
 * shared without any effect, and an old link lands on the pricing page.
 */
export function GET() {
  return new Response(null, { status: 307, headers: { Location: '/pricing' } });
}
