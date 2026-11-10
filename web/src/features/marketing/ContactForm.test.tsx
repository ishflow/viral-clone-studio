import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import type { ContactState } from './actions';
import { ContactForm } from './ContactForm';

const submitContact = vi.fn();
vi.mock('./actions', () => ({ submitContact: (...a: unknown[]) => submitContact(...a) }));

afterEach(() => {
  cleanup();
  submitContact.mockReset();
});

const values = { topic: 'video', email: 'a@b.co', link: '', message: 'My job stopped at the clips step.' };
const done = (over: Partial<ContactState>): ContactState => ({ status: 'sent', errors: {}, values, ...over });
const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Your email'), 'a@b.co');
  await user.type(screen.getByLabelText('Message'), 'My job stopped at the clips step.');
};

describe('ContactForm', () => {
  it('shows field errors for an empty message and an invalid email', async () => {
    submitContact.mockResolvedValue(done({ status: 'error', errors: { email: 'email', message: 'message' } }));
    const user = userEvent.setup();
    renderWithI18n(<ContactForm />);
    await user.type(screen.getByLabelText('Your email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Write at least 10 characters (at most 2000).')).toBeInTheDocument();
    expect(screen.getByLabelText('Your email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('offers the five topics, the one of the link first (?topic=refund)', () => {
    renderWithI18n(<ContactForm topic="refund" />);
    const select = screen.getByLabelText('What is it about?') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['A problem with a video', 'Refund', 'Payment and credits', 'My account', 'Something else']);
    expect(select.value).toBe('refund');
  });

  it('Sent: the reference and the 2 business days, nothing about a demo', async () => {
    submitContact.mockResolvedValue(done({ reference: 'S-000007', duplicate: false }));
    const user = userEvent.setup();
    renderWithI18n(<ContactForm />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Message sent. Reference S-000007. We answer within 2 business days.'));
    expect(screen.getByRole('status')).not.toHaveTextContent('demo');
  });

  it('the same message twice: "You already sent this message." with the same reference', async () => {
    submitContact.mockResolvedValue(done({ reference: 'S-000007', duplicate: true }));
    const user = userEvent.setup();
    renderWithI18n(<ContactForm />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('You already sent this message.')).toBeInTheDocument();
    expect(screen.getByText('Reference S-000007.')).toBeInTheDocument();
  });

  it('Could not send: the message stays in the field and the button says "Try again"', async () => {
    submitContact.mockResolvedValue(done({ status: 'failed' }));
    const user = userEvent.setup();
    renderWithI18n(<ContactForm />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Could not send. Your message is still here. Try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('My job stopped at the clips step.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a message over the limit says it is a limit and when to try again, and keeps the message', async () => {
    submitContact.mockResolvedValue(done({ status: 'limited' }));
    const user = userEvent.setup();
    renderWithI18n(<ContactForm />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('You sent several messages in a short time. Your message is still here: try again in an hour.')).toBeInTheDocument();
    expect(screen.queryByText(/Could not send/)).toBeNull();
    expect(screen.getByLabelText('Message')).toHaveValue('My job stopped at the clips step.');
  });

  it('Sending…: the button is busy and says so while the answer is awaited', async () => {
    let finish: (s: ContactState) => void = () => {};
    submitContact.mockReturnValue(new Promise<ContactState>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderWithI18n(<ContactForm />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    finish(done({ reference: 'S-1', duplicate: false }));
  });

  it('signed in: no email field, "About job" with the jobs of the account, the job id is added, the answer goes to the account address', () => {
    renderWithI18n(<ContactForm account={{ email: 'me@example.com', jobs: [{ id: 'job-1', title: 'Fragrance layering recipe', at: '2026-10-01T10:00:00Z' }] }} jobId="job-1" />);
    expect(screen.queryByLabelText('Your email')).toBeNull();
    const select = screen.getByLabelText('About job') as HTMLSelectElement;
    expect(select.value).toBe('job-1');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Not about a job', expect.stringContaining('Fragrance layering recipe')]);
    expect(screen.getByText('The job ID is added for you.')).toBeInTheDocument();
    expect(screen.getByText('We answer by email to me@example.com.')).toBeInTheDocument();
  });

  it('the send button fills the row on the phone and hugs its text from the nav breakpoint (board A-Iletisim-M)', () => {
    renderWithI18n(<ContactForm />);
    const classes = screen.getByRole('button', { name: 'Send message' }).className.split(' ');
    expect(classes).toContain('self-stretch');
    expect(classes).toContain('nav:self-start');
  });

  it('lets the user write another message after sending', async () => {
    submitContact.mockResolvedValue(done({ reference: 'S-000007', duplicate: false }));
    const user = userEvent.setup();
    renderWithI18n(<ContactForm />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Write another message' }));
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  it('sends a new key with every form instance: a second message (or a second visit) of the same sender is not "already sent"', async () => {
    submitContact.mockResolvedValue(done({ reference: 'S-000007', duplicate: false }));
    const user = userEvent.setup();
    const keyOfCall = (n: number) => (submitContact.mock.calls[n]![1] as FormData).get('key');
    const first = renderWithI18n(<ContactForm />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Write another message' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(submitContact).toHaveBeenCalledTimes(2));
    first.unmount();
    renderWithI18n(<ContactForm />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(submitContact).toHaveBeenCalledTimes(3));
    expect(new Set([keyOfCall(0), keyOfCall(1), keyOfCall(2)]).size).toBe(3);
  });
});
