/** The credit rows of a stopped or closed job: label left, value right (the pattern of the confirmation windows). */
export function SummaryRows({ rows }: { rows: [label: string, value: string][] }) {
  return (
    <dl className="m-0 flex flex-col border-b border-edge">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-edge py-3 text-15">
          <dt className="text-text-2">{label}</dt>
          <dd className="m-0 ml-auto text-right font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
