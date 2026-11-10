import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  clock: <path d="M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0M12 7.5V12l3 2" />,
};

/** Four 24-grid, stroke-2 icons the kit does not have yet (arrows, link, clock). */
export function Glyph({ name, size = 20 }: { name: 'up' | 'down' | 'link' | 'clock'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {PATHS[name]}
    </svg>
  );
}
