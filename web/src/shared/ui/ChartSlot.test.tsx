import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartSlot } from './ChartSlot';

afterEach(cleanup);

describe('ChartSlot', () => {
  it('is an image with the label', () => {
    render(<ChartSlot label="Revenue and cost" />);
    expect(screen.getByRole('img', { name: 'Revenue and cost' })).toHaveTextContent('[CHART: Revenue and cost]');
  });
});
