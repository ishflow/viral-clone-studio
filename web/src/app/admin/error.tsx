'use client';

import { ListError } from '@/features/admin-common/ListError';

/** A page of the admin panel could not be read: the card says so and offers "Try again" (nothing was changed). */
export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-16 border border-line bg-surface px-6 py-8">
      <ListError onRetry={reset} />
    </div>
  );
}
