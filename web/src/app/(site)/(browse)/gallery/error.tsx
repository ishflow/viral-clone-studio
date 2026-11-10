'use client';

import { GalleryError } from '@/features/gallery/GalleryError';

export default function GalleryRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <GalleryError onRetry={reset} />;
}
