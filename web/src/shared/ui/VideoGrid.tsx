import type { ReactNode } from 'react';

/**
 * The gallery grid (`parts.GRID`): two columns on the phone, from 900 px cards at least 210 px wide, 32 px between rows, 16 px between columns.
 * `auto-fill`, not the board's `auto-fit`: the same columns when a row is full, and a filter that leaves two templates does not blow them up to fill the row.
 */
export function VideoGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-8 nav:grid-cols-[repeat(auto-fill,minmax(min(210px,100%),1fr))]">{children}</div>;
}
