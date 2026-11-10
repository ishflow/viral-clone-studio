/** Where a chart will go. No data is invented: the dashed box names what is to be drawn. */
export function ChartSlot({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="box-border flex min-h-70 items-center justify-center rounded-16 border-[1.5px] border-dashed border-edge-strong p-6 text-center text-15 leading-normal text-text-2 text-pretty"
    >
      [CHART: {label}]
    </div>
  );
}
