import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function Host({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Opener</button>
      <Dialog open={open} onClose={() => { onClose?.(); setOpen(false); }} title="Confirm">
        <button type="button">Inside</button>
      </Dialog>
    </>
  );
}

afterEach(cleanup);

describe('Dialog', () => {
  it('renders a dialog with an accessible name', async () => {
    render(<Host />);
    await userEvent.click(screen.getByText('Opener'));
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument();
  });
  it('titles itself with a level 2 heading, so the page keeps its one level 1', async () => {
    render(<Host />);
    await userEvent.click(screen.getByText('Opener'));
    expect(screen.getByRole('heading', { name: 'Confirm', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
  it('is a bottom sheet with a handle on the phone (boards A-Onay-M, A-Hesap-Sil-M) and a card from the nav breakpoint', async () => {
    render(<Host />);
    await userEvent.click(screen.getByText('Opener'));
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    expect(dialog.className.split(' ')).toEqual(expect.arrayContaining(['px-4', 'pt-3', 'pb-8', 'nav:p-6']));
    const handle = dialog.querySelector('[data-sheet-handle]')!;
    expect(handle).toHaveAttribute('aria-hidden', 'true');
    expect(handle.className.split(' ')).toEqual(expect.arrayContaining(['self-center', 'nav:hidden']));
  });
  it('calls onClose on Escape and returns focus to the opener', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const opener = screen.getByText('Opener');
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('Dialog dismissible (a running request)', () => {
  it('Escape does nothing while dismissible is false, and closes again when it is true', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open onClose={onClose} title="Wait" dismissible={false}><button type="button">Inside</button></Dialog>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Dialog open onClose={onClose} title="Wait"><button type="button">Inside</button></Dialog>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('describedBy names the element that describes the dialog', () => {
    render(<Dialog open onClose={() => undefined} title="T" describedBy="why"><p id="why">Because.</p></Dialog>);
    expect(screen.getByRole('dialog', { name: 'T', description: 'Because.' })).toBeInTheDocument();
  });
});
