import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable } from './DataTable';

afterEach(cleanup);

const columns = [
  { key: 'name', header: 'Name' },
  { key: 'credits', header: 'Credits', numeric: true },
];
const rows = [
  { id: 'a', cells: { name: 'Ada', credits: '12' } },
  { id: 'b', cells: { name: 'Bo', credits: '3' } },
];

describe('DataTable', () => {
  it('renders a caption, column headers with scope and the rows', () => {
    render(<DataTable caption="Users" columns={columns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'Users' })).toBeInTheDocument();
    const heads = screen.getAllByRole('columnheader');
    expect(heads).toHaveLength(2);
    heads.forEach((h) => expect(h).toHaveAttribute('scope', 'col'));
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });
  it('makes the first cell of each row a row header', () => {
    render(<DataTable caption="Users" columns={columns} rows={rows} />);
    expect(screen.getByRole('rowheader', { name: 'Ada' })).toHaveAttribute('scope', 'row');
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
  });
  it('right-aligns numeric columns, header and cells', () => {
    render(<DataTable caption="Users" columns={columns} rows={rows} />);
    expect(screen.getByRole('columnheader', { name: 'Credits' })).toHaveClass('text-right');
    expect(screen.getByText('12').closest('td')).toHaveClass('text-right');
    expect(screen.getByText('Ada').closest('th')).not.toHaveClass('text-right');
  });
  it('empty: keeps the header row, one centered cell with the text and the action', () => {
    render(<DataTable caption="Jobs" columns={columns} rows={[]} empty={{ text: 'No jobs.', action: <button type="button">Clear</button> }} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    const cell = screen.getByText('No jobs.').closest('td');
    expect(cell).toHaveAttribute('colspan', '2');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });
  it('loading: keeps the header row, three hidden skeleton rows and aria-busy', () => {
    const { container } = render(<DataTable caption="Jobs" columns={columns} rows={[]} loading />);
    expect(screen.getByRole('table', { name: 'Jobs' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"]')).toHaveLength(3);
  });
  it('srOnlyHeader keeps the header for screen readers; the scroll box is relative', () => {
    const { container } = render(
      <DataTable caption="Users" columns={[{ key: 'a', header: 'Name' }, { key: 'b', header: 'Actions', srOnlyHeader: true }]} rows={[{ id: '1', cells: { a: 'Ada', b: 'x' } }]} />,
    );
    const th = screen.getByRole('columnheader', { name: 'Actions' });
    expect(th.querySelector('span')).toHaveClass('sr-only');
    expect(container.firstElementChild).toHaveClass('relative');
  });
  it('phone measures: th leading-tight', () => {
    render(<DataTable caption="c" columns={[{ key: 'a', header: 'A' }]} rows={[]} />);
    expect(screen.getByRole('columnheader')).toHaveClass('leading-tight');
  });
});

describe('DataTable error', () => {
  it('shows the error block instead of the rows and the empty text', () => {
    render(<DataTable caption="Things" columns={[{ key: 'a', header: 'A' }]} rows={[{ id: '1', cells: { a: 'row' } }]} empty={{ text: 'Nothing' }} error={<p>Could not load</p>} />);
    expect(screen.getByText('Could not load')).toBeInTheDocument();
    expect(screen.queryByText('row')).toBeNull();
    expect(screen.queryByText('Nothing')).toBeNull();
  });
});
