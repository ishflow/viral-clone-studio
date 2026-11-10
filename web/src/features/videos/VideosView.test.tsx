import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import type { VideoRow } from './rows';

vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span data-testid="img" role="img" aria-label={p.alt} /> }));
const deleteVideo = vi.fn();
vi.mock('./actions', () => ({ deleteVideo: (...a: unknown[]) => deleteVideo(...a) }));

import { VideosView } from './VideosView';

beforeEach(() => deleteVideo.mockReset());
afterEach(cleanup);

const base: Omit<VideoRow, 'id' | 'status' | 'step'> = {
  templateId: 'tpl-layering', title: 'Fragrance layering recipe', image: '/samples/a.jpg', productNames: ['Oil', 'Mist'], quality: 'fast', variants: 1, seconds: null,
  minutesLeft: 3, returned: 0, free: false, queuePosition: null, engineQueue: null, stored: true, delivered: 1, reason: null, startedAt: '2026-10-06T09:30:00.000Z',
};
const rows: VideoRow[] = [
  { ...base, id: 'j1', status: 'running', step: { key: 'clips', done: 3, total: 5 } },
  { ...base, id: 'j2', status: 'done', step: null, seconds: 30 },
  { ...base, id: 'j3', status: 'stopped', step: { key: 'clips', done: 3, total: 5 }, returned: 2 },
];
const view = (r: VideoRow[], over: { filter?: 'all' | 'running' | 'done' | 'stopped'; total?: number; free?: boolean } = {}) =>
  renderWithI18n(<VideosView rows={r} filter={over.filter ?? 'all'} total={over.total ?? r.length} freeAvailable={over.free ?? true} />);

describe('VideosView', () => {
  it('links each row to its job with the action that fits its status', () => {
    view(rows);
    expect(screen.getByRole('link', { name: 'Watch' })).toHaveAttribute('href', '/jobs/j1');
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/jobs/j2');
    expect(screen.getByRole('link', { name: 'See options' })).toHaveAttribute('href', '/jobs/j3');
  });
  it('uses bordered buttons only: no lime action in a list', () => {
    view(rows);
    for (const name of ['Watch', 'Open', 'See options']) expect(screen.getByRole('link', { name }).className).not.toContain('bg-accent');
    expect(screen.getByRole('button', { name: 'Delete' }).className).not.toContain('bg-accent');
  });
  it('shows status text and detail per row: Running, Done, Stopped with the credits returned', () => {
    view(rows);
    const list = within(screen.getByRole('list'));
    expect(list.getByText('Running')).toBeInTheDocument();
    expect(list.getByText('Done')).toBeInTheDocument();
    expect(list.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Clips 3 / 5 · about 3 min left')).toBeInTheDocument();
    expect(screen.getByText('mp4 · 720p')).toBeInTheDocument();
    expect(screen.getByText('Credits returned · 3 of 5 clips saved')).toBeInTheDocument();
    expect(screen.getAllByText('2 products: Oil, Mist')).toHaveLength(3);
    expect(screen.getByText('Fast · 1 variant · 30 sec')).toBeInTheDocument();
  });
  it('a job stopped by the content rules has no See options button and no clips-saved line', () => {
    view([{ ...rows[2]!, reason: 'content-rule', returned: 2 }]);
    expect(screen.queryByRole('link', { name: 'See options' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/jobs/j3');
    expect(screen.queryByText(/clips saved/)).toBeNull();
    expect(screen.getByText('Credits returned · stopped by the content rules')).toBeInTheDocument();
  });
  it('a job stopped on an unclear request says we are checking it, with Open', () => {
    view([{ ...rows[2]!, reason: 'submission-unknown', returned: 2 }]);
    expect(screen.queryByRole('link', { name: 'See options' })).toBeNull();
    expect(screen.getByText('Credits returned · we are checking this job')).toBeInTheDocument();
  });
  it('a free job stopped by the content rules says the free video is back', () => {
    view([{ ...rows[2]!, reason: 'content-rule', free: true, returned: 0 }]);
    expect(screen.getByText('Your free video is back · stopped by the content rules')).toBeInTheDocument();
  });
  it('a stopped free job says the free video is back instead of credits', () => {
    view([{ ...rows[2]!, free: true, returned: 0 }]);
    expect(screen.getByText('Your free video is back · 3 of 5 clips saved')).toBeInTheDocument();
  });
  it('queued: "In queue" with the position and Open; closed: the credits that came back, Open, no Delete', () => {
    view([
      { ...base, id: 'q', status: 'queued', step: null, queuePosition: 2 },
      { ...base, id: 'c', status: 'closed', step: null, returned: 2 },
    ]);
    const list = within(screen.getByRole('list'));
    expect(list.getByText('In queue')).toBeInTheDocument();
    expect(list.getByText('Position 2')).toBeInTheDocument();
    expect(list.getByText('Closed')).toBeInTheDocument();
    expect(list.getByText('2 credits were returned. Nothing else was charged.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
  it('queued behind the engine: "In queue" with the videos in front and the minutes, never Running or a time left; the same words as the site queue', () => {
    view([
      { ...base, id: 'w2', status: 'queued', step: null, engineQueue: { ahead: 2, waitMinutes: 14 } },
      { ...base, id: 'w1', status: 'queued', step: null, engineQueue: { ahead: 1, waitMinutes: 7 } },
      { ...base, id: 'w0', status: 'queued', step: null, engineQueue: { ahead: 0, waitMinutes: 0 } },
    ]);
    const list = within(screen.getByRole('list'));
    expect(list.getAllByText('In queue')).toHaveLength(3);
    expect(list.getByText('2 videos ahead · starts in about 14 min')).toBeInTheDocument();
    expect(list.getByText('1 video ahead · starts in about 7 min')).toBeInTheDocument();
    expect(list.getByText('Starting shortly')).toBeInTheDocument();
    expect(list.queryByText('Running')).toBeNull();
    expect(list.queryByText(/min left/)).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Open' })).toHaveLength(3);
  });
  it('queued behind the engine, in Turkish', () => {
    renderWithI18n(<VideosView rows={[{ ...base, id: 'w2', status: 'queued', step: null, engineQueue: { ahead: 2, waitMinutes: 14 } }, { ...base, id: 'w0', status: 'queued', step: null, engineQueue: { ahead: 0, waitMinutes: 0 } }]} filter="all" total={2} freeAvailable />, 'tr');
    expect(screen.getAllByText('Sırada')).toHaveLength(2);
    expect(screen.getByText('Önünde 2 video · yaklaşık 14 dk sonra başlar')).toBeInTheDocument();
    expect(screen.getByText('Birazdan başlıyor')).toBeInTheDocument();
  });
  it('a free closed job: the free video is back', () => {
    view([{ ...base, id: 'c', status: 'closed', step: null, free: true, returned: 0 }]);
    expect(screen.getByText('Your free video is back. Nothing else was charged.')).toBeInTheDocument();
  });
  it('a finished video that is no longer stored: the label, the 12 months, the new job, and "Generate it again" to the form', () => {
    view([{ ...base, id: 'x', status: 'done', step: null, stored: false }]);
    expect(screen.getByText('No longer stored')).toBeInTheDocument();
    expect(screen.getByText('Videos are kept for 12 months.')).toBeInTheDocument();
    expect(screen.getByText('This starts a new job: you add the product images again and confirm the price.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Generate it again' })).toHaveAttribute('href', '/templates/tpl-layering/generate');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(screen.getByRole('list')).queryByText('Done')).toBeNull();
  });
  it('a product name of 60 characters with nowhere to break wraps instead of pushing the page sideways (Review Focus 6)', () => {
    const long = 'Overnightrepairhairandscalpserumwithrosemaryandbiotinnumber5';
    view([{ ...rows[1]!, productNames: [long] }]);
    expect(screen.getByText(new RegExp(long))).toHaveClass('wrap-anywhere');
  });
  it('renders the filter as links with the current one marked', () => {
    view(rows.slice(1, 2), { filter: 'done', total: 3 });
    const group = screen.getByRole('group', { name: 'Status' });
    expect(within(group).getByRole('link', { name: 'All' })).toHaveAttribute('href', '/videos');
    expect(within(group).getByRole('link', { name: 'Running' })).toHaveAttribute('href', '/videos?status=running');
    expect(within(group).getByRole('link', { name: 'Stopped' })).toHaveAttribute('href', '/videos?status=stopped');
    expect(within(group).getByRole('link', { name: 'Done' })).toHaveAttribute('aria-current', 'page');
  });
  it('first-time empty state while the free video is there: the sentence of the contract', () => {
    view([], { total: 0 });
    expect(screen.getByText('Seen it? Clone it.')).toBeInTheDocument();
    expect(screen.getByText('Your videos will show up here. Your first video is free: one no-talking video in Fast quality. No card needed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the gallery' })).toHaveAttribute('href', '/gallery');
  });
  it('empty state after the free video is used: no word about free, "Pick a template"', () => {
    view([], { total: 0, free: false });
    expect(screen.getByRole('heading', { name: 'No videos yet.' })).toBeInTheDocument();
    expect(screen.getByText('Your videos will show up here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pick a template' })).toHaveAttribute('href', '/gallery');
    expect(document.body.textContent).not.toMatch(/free/i);
  });
  it('on the phone the empty state is tighter and its button fills the row (board A-Uretimlerim-Bos-M)', () => {
    view([], { total: 0 });
    const button = screen.getByRole('link', { name: 'Browse the gallery' });
    expect(button.className.split(' ')).toEqual(expect.arrayContaining(['max-nav:self-stretch']));
    expect(button.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['px-4', 'py-12', 'nav:px-6', 'nav:py-18']));
  });
  it('shows a filter empty state with a way back when the filter hides everything', () => {
    view([], { filter: 'stopped', total: 3 });
    expect(screen.getByText('No videos here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all videos' })).toHaveAttribute('href', '/videos');
  });
});

describe('Delete', () => {
  const doneRow = rows[1]!;
  it('only a Done row has it, as a button of at least 44 px (min-h-13 = 52 px)', () => {
    view(rows);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('min-h-13');
  });

  it('asks first; nothing is sent on the click or on "Keep it"; "Delete video" sends the job once and says "Video deleted."', async () => {
    deleteVideo.mockResolvedValue({ status: 'ok' });
    view(rows);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const d = screen.getByRole('dialog', { name: 'Delete this video?' });
    expect(d).toHaveTextContent('It is removed from My videos and cannot be brought back. Credits are not returned.');
    expect(deleteVideo).not.toHaveBeenCalled();
    await userEvent.click(within(d).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteVideo).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete video' }));
    await waitFor(() => expect(deleteVideo).toHaveBeenCalledWith('j2'));
    expect(deleteVideo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Video deleted.');
  });

  it('the delete window names the video: template title, product names and the day it was made', async () => {
    view([doneRow]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(within(screen.getByRole('dialog')).getByText('Fragrance layering recipe · Oil, Mist · Oct 6, 2026')).toBeInTheDocument();
  });

  it('a job with several videos asks "Delete these 3 videos?"', async () => {
    view([{ ...doneRow, delivered: 3 }]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog', { name: 'Delete these 3 videos?' })).toBeInTheDocument();
  });

  it('safe choice wide and bordered, dangerous one narrow with the warn border, no lime', async () => {
    view([doneRow]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const d = screen.getByRole('dialog');
    const keep = within(d).getByRole('button', { name: 'Keep it' });
    const del = within(d).getByRole('button', { name: 'Delete video' });
    expect(keep.className).toContain('flex-[2_1_240px]');
    expect(keep.className).toContain('border-edge-strong');
    expect(del.className).toContain('border-warn');
    expect(del.className).toContain('flex-[1_1_160px]');
    expect(`${keep.className} ${del.className}`).not.toContain('bg-accent');
  });

  it('a failure keeps the window and says "Could not delete the video. Try again."; no success notice', async () => {
    deleteVideo.mockResolvedValue({ status: 'error' });
    view([doneRow]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete video' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Could not delete the video. Try again.');
    expect(screen.queryByText('Video deleted.')).toBeNull();
  });
});
