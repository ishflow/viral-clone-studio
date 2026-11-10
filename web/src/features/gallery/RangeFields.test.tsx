import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { parseClock, RangeFields, rangeCheck, type RangeValue } from './RangeFields';

afterEach(cleanup);

describe('parseClock', () => {
  it.each([
    ['30', 30],
    ['0', 0],
    ['0:30', 30],
    ['1:20', 80],
    ['01:05', 65],
    ['5:00', 300],
    [' 2:10 ', 130],
  ])('reads %s as %s seconds', (text, seconds) => expect(parseClock(text)).toBe(seconds));
  it.each(['', 'abc', '1:2', '1:60', '-5', '1.5', '1:20:30', '1000', ':30'])('does not read "%s"', (text) => expect(parseClock(text)).toBeNull());
});

describe('rangeCheck', () => {
  const check = (from: string, to: string, videoSeconds?: number) => rangeCheck({ from, to }, videoSeconds);
  it('is not ready and says nothing while a box is empty', () => {
    expect(check('', '')).toEqual({ seconds: null, problem: null, ready: false });
    expect(check('0:30', '')).toEqual({ seconds: null, problem: null, ready: false });
  });
  it('is ready from 3 up to 60 seconds, in either notation', () => {
    expect(check('0:30', '1:20')).toEqual({ seconds: 50, problem: null, ready: true });
    expect(check('10', '13')).toMatchObject({ seconds: 3, ready: true });
    expect(check('0', '60')).toMatchObject({ seconds: 60, ready: true });
  });
  it.each([
    ['0:30', '0:31', 'short'],
    ['0:00', '1:01', 'long'],
    ['1:20', '0:30', 'order'],
    ['0:30', '0:30', 'order'],
    ['0:30', 'abc', 'format'],
  ])('%s – %s is %s', (from, to, problem) => expect(check(from, to)).toMatchObject({ problem, ready: false }));
  it('knows the length of the file: the part must lie inside it (half a second of slack, like the engine)', () => {
    expect(check('1:00', '1:30', 90)).toMatchObject({ ready: true });
    expect(check('1:00', '1:31', 90)).toMatchObject({ problem: 'outside', ready: false });
  });
});

function Harness({ initial = { from: '', to: '' }, videoSeconds, onChange }: { initial?: RangeValue; videoSeconds?: number; onChange?: (value: RangeValue) => void }) {
  const [value, setValue] = useState(initial);
  return <RangeFields value={value} onChange={(next) => { setValue(next); onChange?.(next); }} videoSeconds={videoSeconds} />;
}
const fill = (from: string, to: string) => {
  fireEvent.change(screen.getByLabelText('Start'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('End'), { target: { value: to } });
};

describe('RangeFields', () => {
  it('is a labelled group with a Start and an End box and a hint that names the notation', () => {
    renderWithI18n(<Harness />);
    const group = screen.getByRole('group', { name: 'Part of the video' });
    expect(group).toContainElement(screen.getByLabelText('Start'));
    expect(group).toContainElement(screen.getByLabelText('End'));
    expect(screen.getByText(/Write m:ss or seconds/)).toBeInTheDocument();
    expect(screen.getByLabelText('Start')).toHaveAttribute('inputmode', 'numeric');
  });
  it('tells the picked length as it is typed, in either notation', () => {
    renderWithI18n(<Harness />);
    fill('0:30', '1:20');
    expect(screen.getByRole('status')).toHaveTextContent('Selected: 50 sec');
    fill('30', '75');
    expect(screen.getByRole('status')).toHaveTextContent('Selected: 45 sec');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('shows the picked length in the accent colour only while the part can be used; a part that cannot is neutral text', () => {
    renderWithI18n(<Harness />);
    fill('0:30', '1:20');
    expect(screen.getByRole('status')).toHaveClass('text-accent-text');
    fill('0:00', '2:25');
    expect(screen.getByRole('status')).toHaveTextContent('Selected: 2 min 25 sec');
    expect(screen.getByRole('status')).not.toHaveClass('text-accent-text');
    fill('1:20', '1:21');
    expect(screen.getByRole('status')).not.toHaveClass('text-accent-text');
  });
  it('reports each edit to its owner as the typed text', () => {
    const changed = vi.fn();
    renderWithI18n(<Harness onChange={changed} />);
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '0:3' } });
    expect(changed).toHaveBeenLastCalledWith({ from: '0:3', to: '' });
  });
  it('carries the part as seconds in two hidden fields named rangeFrom and rangeTo', () => {
    const { container } = renderWithI18n(<Harness />);
    fill('0:30', '1:20');
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="rangeFrom"]')!.value).toBe('30');
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="rangeTo"]')!.value).toBe('80');
  });
  it('sends the text of a box it cannot read as it is, so the server refuses it too', () => {
    const { container } = renderWithI18n(<Harness />);
    fill('0:30', 'soon');
    expect(container.querySelector<HTMLInputElement>('input[name="rangeTo"]')!.value).toBe('soon');
  });
  it('warns that a part is at most 1 minute, in one line under the boxes, and marks the End box invalid', () => {
    renderWithI18n(<Harness />);
    fill('0:00', '1:30');
    expect(screen.getByRole('alert')).toHaveTextContent('The part can be at most 1 min.');
    expect(screen.getByLabelText('End')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Selected: 1 min 30 sec');
  });
  it.each([
    ['0:30', '0:31', 'Pick a part of at least 3 sec.'],
    ['1:20', '0:30', 'The end must come after the start.'],
    ['0:30', 'soon', 'Write the time as m:ss or in seconds, for example 0:30.'],
  ])('%s – %s warns "%s"', (from, to, text) => {
    renderWithI18n(<Harness />);
    fill(from, to);
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });
  it('warns when the part runs past the end of the file', () => {
    renderWithI18n(<Harness videoSeconds={90} />);
    fill('1:00', '1:40');
    expect(screen.getByRole('alert')).toHaveTextContent('The part must lie inside the video (it is 1 min 30 sec long).');
  });
  it('points both boxes at the hint, the picked length and the warning (aria-describedby) so a screen reader reads them', () => {
    renderWithI18n(<Harness />);
    fill('0:00', '1:30');
    const ids = (screen.getByLabelText('Start').getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toContain(screen.getByRole('status').id);
    expect(ids).toContain(screen.getByRole('alert').id);
    expect(screen.getByLabelText('End').getAttribute('aria-describedby')).toBe(screen.getByLabelText('Start').getAttribute('aria-describedby'));
  });
  it('two groups on one page do not share ids', () => {
    renderWithI18n(<><Harness /><Harness /></>);
    const ids = screen.getAllByLabelText('Start').map((input) => input.id);
    expect(new Set(ids).size).toBe(2);
  });
});
