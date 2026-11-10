import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field, Input } from './Field';

afterEach(cleanup);

describe('Field', () => {
  it('connects label and input', () => {
    render(<Field label="Email"><Input /></Field>);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
  it('shows the error with aria-invalid and aria-describedby', () => {
    render(<Field label="Email" error="Enter an email"><Input /></Field>);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter an email');
  });
  it('describes the field with the hint when there is no error', () => {
    render(<Field label="Name" hint="Shown on invoices"><Input /></Field>);
    const input = screen.getByLabelText('Name');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription('Shown on invoices');
  });
});
