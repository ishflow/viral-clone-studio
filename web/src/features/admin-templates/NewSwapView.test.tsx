import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

const addSwapVideo = vi.fn();
vi.mock('./swap-actions', () => ({ addSwapVideo: (...a: unknown[]) => addSwapVideo(...a) }));
const uploadSwapVideo = vi.fn();
vi.mock('./swap-upload', async (importOriginal) => ({ ...(await importOriginal<typeof import('./swap-upload')>()), uploadSwapVideo: (...a: unknown[]) => uploadSwapVideo(...a) }));

import { NewSwapView } from './NewSwapView';

const UPLOAD = '3f2b8c1e-9a4d-4e7f-8b21-6c5d0a9e1f34';
const sent = (call: number) => Object.fromEntries((addSwapVideo.mock.calls[call]![1] as FormData).entries());

afterEach(cleanup);
beforeEach(() => {
  addSwapVideo.mockReset();
  uploadSwapVideo.mockReset();
  addSwapVideo.mockResolvedValue({ status: 'done', id: 'tpl-new' });
  uploadSwapVideo.mockResolvedValue({ ok: true, uploadId: UPLOAD });
});

describe('NewSwapView', () => {
  it('says what the video must be: the length the rules sell, taken from RULES', () => {
    renderWithI18n(<NewSwapView />);
    expect(screen.getByRole('heading', { level: 1, name: 'Add a person-swap video' })).toBeInTheDocument();
    expect(screen.getByText(/A video of 3 to 30 seconds/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/admin/templates');
  });

  it('sends the link as a link, and then says the video is added with a way to its page', async () => {
    renderWithI18n(<NewSwapView />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Video link' }), 'https://www.tiktok.com/@a/video/1');
    await userEvent.click(screen.getByRole('button', { name: 'Add from the link' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('The video is added and is being prepared.'));
    expect(sent(0)).toMatchObject({ kind: 'link', url: 'https://www.tiktok.com/@a/video/1' });
    expect(screen.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/admin/templates/tpl-new');
  });

  it('says why a video was not added, in the words of that reason', async () => {
    addSwapVideo.mockResolvedValue({ status: 'error', error: 'length' });
    renderWithI18n(<NewSwapView />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Video link' }), 'https://www.tiktok.com/@a/video/1');
    await userEvent.click(screen.getByRole('button', { name: 'Add from the link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The video must be 3 to 30 seconds long.');
    expect(screen.queryByRole('link', { name: 'Open it' })).toBeNull();
  });

  it('says the provider cap in its own words', async () => {
    addSwapVideo.mockResolvedValue({ status: 'error', providerCap: true });
    renderWithI18n(<NewSwapView />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Video link' }), 'https://www.tiktok.com/@a/video/1');
    await userEvent.click(screen.getByRole('button', { name: 'Add from the link' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('The video was not added');
  });

  it('sends a file to the upload route first, and hands only the id it kept to the action', async () => {
    renderWithI18n(<NewSwapView />);
    const file = new File(['x'], 'walk.mp4', { type: 'video/mp4' });
    await userEvent.upload(screen.getByLabelText('Or send a video file'), file);
    await waitFor(() => expect(addSwapVideo).toHaveBeenCalledTimes(1));
    expect(uploadSwapVideo).toHaveBeenCalledWith(file, expect.any(Function));
    expect(sent(0)).toEqual({ kind: 'upload', uploadId: UPLOAD });
    expect(await screen.findByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/admin/templates/tpl-new');
  });

  it('a file the browser can tell is not a video is not sent at all', async () => {
    renderWithI18n(<NewSwapView />);
    await userEvent.upload(screen.getByLabelText('Or send a video file'), new File(['x'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });
    expect(uploadSwapVideo).not.toHaveBeenCalled();
    expect(addSwapVideo).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Use an mp4 or mov file.');
  });

  it('a file the route refused is said as the route said it, and no video is added', async () => {
    uploadSwapVideo.mockResolvedValue({ ok: false, code: 'size' });
    renderWithI18n(<NewSwapView />);
    await userEvent.upload(screen.getByLabelText('Or send a video file'), new File(['x'], 'walk.mp4', { type: 'video/mp4' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is over 100 MB.');
    expect(addSwapVideo).not.toHaveBeenCalled();
  });

  it('shows the progress of the file while it is sent', async () => {
    let progress: (percent: number) => void = () => {};
    uploadSwapVideo.mockImplementation((_file: File, onProgress: (percent: number) => void) => {
      progress = onProgress;
      return new Promise(() => {});
    });
    renderWithI18n(<NewSwapView />);
    await userEvent.upload(screen.getByLabelText('Or send a video file'), new File(['x'], 'walk.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(uploadSwapVideo).toHaveBeenCalled());
    progress(42);
    expect(await screen.findByText('Sending the file… 42%')).toBeInTheDocument();
  });
});
