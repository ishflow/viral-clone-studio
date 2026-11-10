import { notFound } from 'next/navigation';

/**
 * Every page under `/dev` starts with this: in a production build the page is a 404 before it reads anything.
 * The layout has the same check, but a layout alone is not enough: Next renders a page beside its layout, and what the page read
 * (the mail outbox, with verification and reset links) would still travel in the response.
 */
export function devOnly(): void {
  if (process.env.NODE_ENV === 'production') notFound();
}
