import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buttonClass, Button, LinkButton } from './Button';

afterEach(cleanup);

describe('Button', () => {
  it('renders a button of type button by default', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button');
  });
  it('is disabled and aria-busy when pending', () => {
    render(<Button pending>Go</Button>);
    const b = screen.getByRole('button', { name: 'Go' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
  it('LinkButton renders a link with the href', () => {
    render(<LinkButton href="/gallery">Browse</LinkButton>);
    expect(screen.getByRole('link', { name: 'Browse' })).toHaveAttribute('href', '/gallery');
  });
  it('uses scale padding: m = px-6, l = px-8 for primary and secondary', () => {
    expect(buttonClass('primary', 'm')).toContain('px-6');
    expect(buttonClass('secondary', 'm')).toContain('px-6');
    expect(buttonClass('primary', 'l')).toContain('px-8');
    expect(buttonClass('secondary', 'l')).toContain('px-8');
  });
});
