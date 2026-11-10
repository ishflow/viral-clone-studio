import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusLine } from './StatusLine';

afterEach(cleanup);

describe('StatusLine', () => {
  it.each(['done', 'running', 'stopped', 'waiting', 'queued', 'closed'] as const)('shows text for %s', (kind) => {
    render(<StatusLine kind={kind}>Label {kind}</StatusLine>);
    expect(screen.getByText(`Label ${kind}`)).toBeVisible();
  });
});
