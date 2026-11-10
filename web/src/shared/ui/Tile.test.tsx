import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Tile, TileGrid } from './Tile';

afterEach(cleanup);

describe('Tile', () => {
  it('shows label, value and sub', () => {
    render(<Tile label="Users" value="[COUNT]" sub="All accounts" />);
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('[COUNT]')).toBeInTheDocument();
    expect(screen.getByText('All accounts')).toBeInTheDocument();
  });
});

describe('TileGrid', () => {
  it('is two columns on the phone; lead spans the first tile', () => {
    const { container, rerender } = render(<TileGrid><Tile label="a" value="1" /></TileGrid>);
    expect(container.firstElementChild).toHaveClass('grid-cols-2');
    rerender(<TileGrid lead><Tile label="a" value="1" /></TileGrid>);
    expect(container.firstElementChild?.className).toContain('col-span-2');
  });
  it('phone measures: equal rows', () => {
    const grid = render(<TileGrid><Tile label="a" value="1" /></TileGrid>).container;
    expect(grid.firstElementChild).toHaveClass('auto-rows-fr');
  });
});
