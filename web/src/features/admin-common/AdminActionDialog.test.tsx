import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { AdminActionDialog, type AdminActionDialogProps } from './AdminActionDialog';

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

function setup(perform: AdminActionDialogProps<{ n: number }>['perform'], over: Partial<AdminActionDialogProps<{ n: number }>> = {}) {
  const onClose = vi.fn();
  renderWithI18n(
    <AdminActionDialog<{ n: number }>
      onClose={onClose} title="Do it?" rows={[{ label: 'Job', value: 'Dupe comparison' }]} info="Some info." confirmLabel="Do it"
      perform={perform} doneRows={(d) => [{ label: 'Result', value: String(d.n) }]} {...over}
    />,
  );
  return { onClose, dialog: screen.getByRole('dialog', { name: 'Do it?' }) };
}

describe('AdminActionDialog', () => {
  it('shows the facts, the info and the note; the reason field is first and nothing is sent before the confirm button', () => {
    const perform = vi.fn();
    const { dialog } = setup(perform);
    expect(within(dialog).getByText('Job').nextSibling).toHaveTextContent('Dupe comparison');
    expect(within(dialog).getByText('Some info.')).toBeInTheDocument();
    expect(within(dialog).getByText('This action is recorded with your name and the reason.')).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(perform).not.toHaveBeenCalled();
  });

  it('an empty reason is an error under the field, the field gets the focus, nothing is sent', async () => {
    const perform = vi.fn();
    const { dialog } = setup(perform);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Do it' }));
    expect(within(dialog).getByText('A reason is required.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Reason')).toHaveFocus();
    expect(within(dialog).getByLabelText('Reason')).toBeInvalid();
    await userEvent.type(within(dialog).getByLabelText('Reason'), '   ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Do it' }));
    expect(perform).not.toHaveBeenCalled();
  });

  it('the long hint says the reason is shown in the credit history', () => {
    const { dialog } = setup(vi.fn(), { reasonHint: 'long' });
    expect(within(dialog).getByText('A reason is required. It is shown in the credit history.')).toBeInTheDocument();
  });

  it('working: both buttons off, Escape does not close; done: the summary and Close, which closes and refreshes the page', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const perform = vi.fn(() => new Promise<never>((resolve) => { finish = resolve as (value: unknown) => void; }));
    const { dialog, onClose } = setup(perform);
    await userEvent.type(within(dialog).getByLabelText('Reason'), '  because  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Do it' }));
    expect(perform).toHaveBeenCalledWith('because', expect.any(String)); // trimmed
    expect(await within(dialog).findByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish({ status: 'done', at: '2026-10-05T10:00:00Z', detail: { n: 4 } }));
    const done = await screen.findByRole('dialog', { name: 'Done' });
    expect(within(done).getByText('Result').nextSibling).toHaveTextContent('4');
    expect(refresh).not.toHaveBeenCalled(); // not before the dialog is closed: the row that opened it may go
    await userEvent.click(within(done).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('failed: "It did not go through. Nothing was changed.", Try again sends the same key; an exception is a failure too', async () => {
    const perform = vi.fn().mockResolvedValueOnce({ status: 'failed' }).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ status: 'done', at: '2026-10-05T10:00:00Z', detail: { n: 1 } });
    const { dialog } = setup(perform);
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'why');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Do it' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('It did not go through. Nothing was changed. Try again.');
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('why'); // kept
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(3));
    expect(new Set(perform.mock.calls.map((c) => c[1])).size).toBe(1);
  });

  it('already done: says when, has only Close, and Close does not refresh a thing that did not change', async () => {
    const { onClose } = setup(vi.fn().mockResolvedValue({ status: 'already', at: '2026-10-03T10:00:00Z' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Do it' }));
    expect(await within(dialog).findByText(/This was already done on .*2026/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('Cancel and Escape while asking close it and send nothing', async () => {
    const perform = vi.fn();
    const { dialog, onClose } = setup(perform);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();
  });
});
