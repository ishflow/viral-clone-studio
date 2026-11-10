import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';

export type DataTableColumn = { key: string; header: string; numeric?: boolean; srOnlyHeader?: boolean };
export type DataTableRow = { id: string; cells: Record<string, ReactNode> };

const TH = 'border-b border-line py-3 text-left text-13 leading-tight font-medium whitespace-nowrap text-text-3';
const TD = 'border-b border-line py-4 align-middle text-15 leading-snug text-text-2';
const NUM = 'text-right tabular-nums whitespace-nowrap';
const SKELETON_WIDTHS = ['w-16', 'w-24', 'w-36', 'w-12', 'w-16'];

/**
 * Table of the admin panel. The first column names the row (darker). The table scrolls sideways inside its own box on a narrow screen.
 * `empty` replaces the rows by one centered cell; `loading` shows three skeleton rows (and sets aria-busy). Row actions go in a cell as links.
 * `dense`: 12 px instead of 16 px at the sides of every cell, for a table with so many columns that it would not fit its box at 1440 px.
 */
export function DataTable({
  caption,
  columns,
  rows,
  minWidth = 960,
  empty,
  loading,
  dense,
  error,
}: {
  caption: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
  minWidth?: number;
  empty?: { text: string; action?: ReactNode };
  loading?: boolean;
  dense?: boolean;
  /** The list could not be read: replaces the rows by this block (the caller builds it, with its own "Try again"). */
  error?: ReactNode;
}) {
  const side = dense ? 'px-3' : 'px-4';
  const showEmpty = !loading && !error && rows.length === 0 && empty;
  const lastRow = (i: number, n: number) => i === n - 1;
  return (
    <div className="relative overflow-x-auto rounded-16 border border-line bg-surface">
      <table aria-busy={loading ? true : undefined} className="w-full border-collapse" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx(TH, side, c.numeric && NUM)}>
                {c.srOnlyHeader ? <span className="sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            [0, 1, 2].map((r) => (
              <tr key={r} aria-hidden="true">
                {columns.map((c, i) => (
                  <td key={c.key} className={cx(TD, side, lastRow(r, 3) && 'border-b-0', c.numeric && 'text-right')}>
                    <span className={cx('inline-block h-3 animate-pulse rounded-full bg-raised align-middle', SKELETON_WIDTHS[i % SKELETON_WIDTHS.length])} />
                  </td>
                ))}
              </tr>
            ))}
          {error && !loading && (
            <tr>
              <td colSpan={columns.length} className="px-6 py-8 text-center">{error}</td>
            </tr>
          )}
          {showEmpty && (
            <tr>
              <td colSpan={columns.length} className="px-6 py-8 text-center">
                <div className="flex flex-col items-center gap-4">
                  <p className="m-0 text-15 leading-normal text-text-2 text-pretty">{empty.text}</p>
                  {empty.action}
                </div>
              </td>
            </tr>
          )}
          {!loading &&
            !showEmpty &&
            !error &&
            rows.map((row, r) => (
              <tr key={row.id}>
                {columns.map((c, i) => {
                  const cls = cx(TD, side, lastRow(r, rows.length) && 'border-b-0', c.numeric && NUM, i === 0 && 'text-left font-medium text-text');
                  return i === 0 ? (
                    <th key={c.key} scope="row" className={cls}>
                      {row.cells[c.key]}
                    </th>
                  ) : (
                    <td key={c.key} className={cls}>
                      {row.cells[c.key]}
                    </td>
                  );
                })}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
