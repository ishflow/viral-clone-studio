import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VideoGrid } from './VideoGrid';

afterEach(cleanup);

describe('VideoGrid', () => {
  it('keeps the card width when a row is not full: empty tracks stay (auto-fill), cards do not stretch', () => {
    const { container } = render(
      <VideoGrid>
        <div>one</div>
        <div>two</div>
      </VideoGrid>,
    );
    const classes = container.firstElementChild!.className;
    expect(classes).toContain('nav:grid-cols-[repeat(auto-fill,minmax(min(210px,100%),1fr))]');
    expect(classes).not.toContain('auto-fit');
  });
  it('is two columns on the phone', () => {
    const { container } = render(<VideoGrid><div /></VideoGrid>);
    expect(container.firstElementChild).toHaveClass('grid-cols-2');
  });
});
