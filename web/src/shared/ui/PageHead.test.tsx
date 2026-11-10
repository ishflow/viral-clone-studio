import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHead } from './PageHead';

afterEach(cleanup);

describe('PageHead', () => {
  it('renders h1, lead and actions', () => {
    render(<PageHead title="Overview" lead="Customers." actions={<button type="button">Go</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Customers.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });
  it('actions fill the row on the phone and stack', () => {
    const { container } = render(<PageHead title="T" actions={<button type="button">Go</button>} />);
    const actions = container.querySelector('button')?.parentElement;
    expect(actions).toHaveClass('w-full', 'flex-col', 'nav:flex-row');
    expect(container.firstElementChild).toHaveClass('flex-col', 'nav:flex-row');
  });
  it('phone measures: gap-4 between the title block and the actions', () => {
    const head = render(<PageHead title="T" actions={<i />} />).container;
    expect(head.firstElementChild).toHaveClass('gap-4');
  });
});
