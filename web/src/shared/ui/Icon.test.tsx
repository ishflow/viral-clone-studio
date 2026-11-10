import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { ICONS } from './icons';

afterEach(cleanup);

describe('Icon', () => {
  it('has sound off', () => {
    expect(ICONS['sound off']).toBeTruthy();
    const { container } = render(<Icon name="sound off" />);
    expect(container.querySelector('path')).toHaveAttribute('d', ICONS['sound off']);
  });
  it('has arrow up/down, link, clock', () => {
    for (const n of ['arrow up', 'arrow down', 'link', 'clock'] as const) expect(ICONS[n]).toBeTruthy();
  });
});
