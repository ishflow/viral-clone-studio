import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Segmented } from './Segmented';

const options = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }];

afterEach(cleanup);

describe('Segmented', () => {
  it('marks the current option with aria-pressed', () => {
    render(<Segmented label="Period" options={options} value="30" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('calls onChange', async () => {
    const onChange = vi.fn();
    render(<Segmented label="Period" options={options} value="30" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(onChange).toHaveBeenCalledWith('7');
  });
  it('renders links with aria-current when hrefFor is given', () => {
    render(<Segmented label="Period" options={options} value="7" hrefFor={(v) => `?p=${v}`} />);
    const current = screen.getByRole('link', { name: '7 days' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveAttribute('href', '?p=7');
    expect(screen.getByRole('link', { name: '30 days' })).not.toHaveAttribute('aria-current');
  });
  it('never wraps: scrolls sideways', () => {
    render(<Segmented label="P" value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />);
    const group = screen.getByRole('group', { name: 'P' });
    expect(group).toHaveClass('overflow-x-auto', 'flex-nowrap');
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('flex-[1_0_auto]', 'px-3');
  });
});
