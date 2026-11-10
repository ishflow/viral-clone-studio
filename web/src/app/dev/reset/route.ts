import { limiter } from '@/core/rate-limit/rate-limit';
import { fakeSpeed, resetStore } from '@/data/mock/store';

export const dynamic = 'force-dynamic';

/**
 * Dev and e2e only: the fake store starts again from the fixtures. In a production build this route answers 404.
 * The answer carries the speed of the fake time (`VC_FAKE_SPEED`), so the e2e specs can refuse a server that is too slow for them.
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });
  resetStore();
  limiter.reset();
  return Response.json({ ok: true, speed: fakeSpeed() });
}
