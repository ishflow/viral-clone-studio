/** Number tile of the admin panel. `value` is already formatted (or a placeholder such as "[COUNT]"). */
export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="box-border flex min-w-0 flex-col gap-2 rounded-16 border border-line bg-surface p-4 nav:p-6">
      <span className="text-13 leading-snug text-text-3">{label}</span>
      <span data-tile-value className="font-display text-24 leading-[1.1] font-extrabold tracking-[-0.02em] tabular-nums nav:text-32">
        {value}
      </span>
      {sub && <span className="text-13 leading-snug text-text-3">{sub}</span>}
    </div>
  );
}

/**
 * The grid tiles sit in: two columns on the phone, auto-fit (4 to a row) from 900 px.
 * `lead`: the first tile spans both columns on the phone and its value is 32 px (boards with five tiles).
 */
export function TileGrid({ children, lead }: { children: React.ReactNode; lead?: boolean }) {
  return (
    <div
      className={`grid auto-rows-fr grid-cols-2 gap-3 nav:grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] nav:gap-4${
        lead ? ' max-nav:[&>:first-child]:col-span-2 max-nav:[&>:first-child_[data-tile-value]]:text-32' : ''
      }`}
    >
      {children}
    </div>
  );
}
