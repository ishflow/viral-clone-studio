import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobStep } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

const refresh = vi.fn();
const router = { refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { AutoRefresh } from './AutoRefresh';
import { ResultView } from './ResultView';
import { RunningView } from './RunningView';
import { pickVariant } from './steps';

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
// The fake runs music before clips, so the music is done while the clips are still running. The order below is deliberately not the display order.
const live: JobStep[] = [
  step('render', 'waiting', 0, 1),
  step('clips', 'running', 3, 5),
  step('music', 'done', 1, 1),
  step('adaptation', 'done', 1, 1),
  step('edit', 'waiting', 0, 1),
  step('images', 'done', 5, 5),
];
const base: Job = {
  id: 'job-1', userId: 'u', templateId: 'tpl-layering', templateTitle: 'Fragrance layering recipe',
  input: {
    templateId: 'tpl-layering', quality: 'fast', variants: 1, language: 'en',
    products: ['Aurora Body Oil', 'Aurora Body Mist', 'Aurora Hair Mist', 'Solace Perfume'].map((name) => ({ name, description: '', images: ['/samples/a.jpg'] })),
  },
  credits: 2, status: 'running', steps: live, stoppedReason: null, startedAt: '2026-10-04T12:00:00Z', finishedAt: null, variants: [],
  freeVideo: false, creditsReturned: 0, queuePosition: null, delayed: false, paused: false, stoppedAt: null, continueUntil: null,
  closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: true, imagesStored: true, deletedAt: null,
};
const template = { id: 'tpl-layering', title: 'Fragrance layering recipe', image: '/samples/f.jpg', video: '/samples/layering.mp4', seconds: 8 };

beforeEach(() => {
  refresh.mockReset();
  vi.useRealTimers();
});
afterEach(cleanup);

describe('RunningView', () => {
  it('lists the stages in the board order, each with its own state and count', () => {
    renderWithI18n(<RunningView job={base} template={template} minutesLeft={3} elapsedSeconds={220} />);
    const items = within(screen.getByRole('list', { name: 'Stages' })).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('span:nth-child(2) > span')?.textContent)).toEqual(['Adaptation', 'Images', 'Clips', 'Music', 'Edit', 'Render']);
    expect(items[0]).toHaveTextContent('done');
    expect(items[1]).toHaveTextContent('done · 5 / 5');
    expect(items[2]).toHaveTextContent('running · 3 / 5');
    expect(items[3]).toHaveTextContent('done');
    expect(items[4]).toHaveTextContent('waiting');
    expect(items[5]).toHaveTextContent('waiting');
  });

  it('shows the title, the left / elapsed time and the shots', () => {
    renderWithI18n(<RunningView job={base} template={template} minutesLeft={3} elapsedSeconds={220} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Fragrance layering recipe' })).toBeInTheDocument();
    expect(screen.getByText('4 products · Fast · 1 variant')).toBeInTheDocument();
    expect(screen.getByText('Estimated time')).toBeInTheDocument();
    expect(screen.getByText('about 3 min')).toBeInTheDocument();
    expect(screen.getByText(/left · 3 min 40 sec elapsed/)).toBeInTheDocument();
    expect(screen.getAllByText('clip ready')).toHaveLength(3);
    expect(screen.getAllByText('making the clip')).toHaveLength(2);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('You can leave this page. We email you when it is ready.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('running longer than usual: the info box, and "Taking longer than usual" instead of the time left', () => {
    renderWithI18n(<RunningView job={{ ...base, delayed: true }} template={template} minutesLeft={1} elapsedSeconds={900} />);
    expect(screen.getByRole('status')).toHaveTextContent('This is taking longer than usual. Your job is still running; you do not need to start it again.');
    expect(screen.getByText('Taking longer than usual')).toBeInTheDocument();
    expect(screen.queryByText(/elapsed/)).toBeNull();
    expect(screen.queryByText(/about 1 min/)).toBeNull();
  });

  it('generation paused: the warning says nothing extra is charged', () => {
    renderWithI18n(<RunningView job={{ ...base, paused: true }} template={template} minutesLeft={3} elapsedSeconds={60} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Generation is paused for a short time. Your job continues when it is back. Nothing extra is charged.');
  });
});

describe('AutoRefresh while hidden', () => {
  beforeEach(() => void vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })));
  afterEach(() => void vi.unstubAllGlobals());
  const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  afterEach(() => setHidden(false));

  it('does not refresh while the tab is hidden, and refreshes once when it becomes visible again', async () => {
    vi.useFakeTimers();
    setHidden(true);
    renderWithI18n(<AutoRefresh />);
    await act(async () => void vi.advanceTimersByTime(6100));
    expect(refresh).not.toHaveBeenCalled();
    setHidden(false);
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('AutoRefresh reconnecting', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says "Reconnecting…" after two answers in a row that did not come, and stops saying it with the first one that does', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    renderWithI18n(<AutoRefresh />);
    await act(async () => void vi.advanceTimersByTime(2100));
    expect(screen.queryByRole('status')).toBeNull(); // one miss is a hiccup
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting… Your job keeps running while this page reconnects.');
    expect(refresh).not.toHaveBeenCalled(); // no refresh without a connection: the router would leave for the browser's offline page
    fetchMock.mockResolvedValue({ ok: true });
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('status')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('AutoRefresh', () => {
  beforeEach(() => void vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })));
  afterEach(() => void vi.unstubAllGlobals());

  it('refreshes the route every 2 seconds and stops when it unmounts', async () => {
    vi.useFakeTimers();
    const view = renderWithI18n(<AutoRefresh />);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(2100));
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(refresh).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => void vi.advanceTimersByTime(6000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('asks at the pace it is given, every 2 seconds when none is given', async () => {
    vi.useFakeTimers();
    renderWithI18n(<AutoRefresh everyMs={5000} />);
    await act(async () => void vi.advanceTimersByTime(4900));
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(200));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(refresh).toHaveBeenCalledTimes(2);
    cleanup();
    refresh.mockClear();
    renderWithI18n(<AutoRefresh />);
    await act(async () => void vi.advanceTimersByTime(2100));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

const done = (n: 1 | 2 | 3, video: string | null = '/samples/layering.mp4'): Job => ({
  ...base, status: 'done', input: { ...base.input, variants: n }, finishedAt: '2026-10-04T12:07:00Z',
  steps: live.map((s) => ({ ...s, status: 'done' as const, done: s.total })),
  variants: Array.from({ length: n }, (_, i) => ({ id: `job-1-v${i + 1}`, image: `/samples/v${i + 1}.jpg`, video, status: 'done' as const, reason: null })),
});

describe('ResultView', () => {
  it('a job whose template is gone from the catalog (hidden) shows no length and no compare link', () => {
    renderWithI18n(<ResultView job={done(1)} template={{ ...template, video: null, seconds: 0 }} />);
    expect(screen.getByText('Fragrance layering recipe · 720p · mp4')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Compare with the sample' })).toBeNull();
  });

  it('prints a measured template length as whole seconds', () => {
    renderWithI18n(<ResultView job={done(1)} template={{ ...template, seconds: 20.433333333333334 }} />);
    expect(screen.getByText('Fragrance layering recipe · 20 sec · 720p · mp4')).toBeInTheDocument();
  });
  it('one variant: ready title, one download link, compare link, no variants strip', () => {
    renderWithI18n(<ResultView job={done(1)} template={template} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your video is ready.');
    expect(screen.getByText('Fragrance layering recipe · 8 sec · 720p · mp4')).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Download' });
    expect(download).toHaveAttribute('href', '/samples/layering.mp4');
    expect(download).toHaveAttribute('download');
    expect(screen.queryByRole('group', { name: 'Variants' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Generate a new variant' })).toHaveAttribute('href', '/templates/tpl-layering/generate?from=job-1');
    expect(screen.getByRole('link', { name: /Compare with the sample/ })).toHaveAttribute('href', '/jobs/job-1/compare');
    expect(screen.getByText('Aurora Body Oil, Aurora Body Mist, Aurora Hair Mist, Solace Perfume')).toBeInTheDocument();
    expect(screen.getByText('Fast · 720p')).toBeInTheDocument();
  });

  it('a product name of 60 characters with nowhere to break wraps instead of pushing the page sideways (Review Focus 6)', () => {
    const long = 'Overnightrepairhairandscalpserumwithrosemaryandbiotinnumber5';
    const job = done(1);
    renderWithI18n(<ResultView job={{ ...job, input: { ...job.input, products: [{ name: long, description: '', images: ['/samples/a.jpg'] }] } }} template={template} />);
    expect(screen.getByText(long)).toHaveClass('min-w-0', 'wrap-anywhere');
  });

  it('three variants: strip of three, the download follows the picked variant', async () => {
    renderWithI18n(<ResultView job={{ ...done(3), variants: done(3).variants.map((v, i) => ({ ...v, video: `/v${i + 1}.mp4` })) }} template={template} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('3 variants are ready.');
    const strip = screen.getByRole('group', { name: 'Variants' });
    expect(within(strip).getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Download variant 1' })).toHaveAttribute('href', '/v1.mp4');
    await userEvent.click(within(strip).getByRole('button', { name: 'Variant 2' }));
    expect(within(strip).getByRole('button', { name: 'Variant 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'Download variant 2' })).toHaveAttribute('href', '/v2.mp4');
    expect(screen.getByRole('button', { name: 'Download all 3' })).toBeInTheDocument();
  });

  it('plays a native video when the file exists; shows the image with a play mark when it does not', () => {
    const { container, unmount } = renderWithI18n(<ResultView job={done(1)} template={template} />);
    expect(container.querySelector('video')).toHaveAttribute('controls');
    unmount();
    const none = renderWithI18n(<ResultView job={done(1, null)} template={template} />);
    expect(none.container.querySelector('video')).toBeNull();
    expect(screen.getByAltText('Frame from the generated video')).toHaveAttribute('src', '/samples/v1.jpg');
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
    expect(screen.getByText('The video file is not available in this demo yet.')).toBeInTheDocument();
  });

  it('several variants on the phone: the compare link takes its own row and starts at the left edge (board A-Sonuc-Varyant-M)', () => {
    renderWithI18n(<ResultView job={done(3)} template={template} />);
    expect(screen.getByRole('link', { name: /Compare with the sample/ }).className.split(' ')).toEqual(expect.arrayContaining(['basis-full', 'nav:basis-auto']));
  });

  it('the compare link carries the picked variant (several variants only)', async () => {
    renderWithI18n(<ResultView job={done(3)} template={template} />);
    expect(screen.getByRole('link', { name: /Compare with the sample/ })).toHaveAttribute('href', '/jobs/job-1/compare?v=job-1-v1');
    await userEvent.click(screen.getByRole('button', { name: 'Variant 3' }));
    expect(screen.getByRole('link', { name: /Compare with the sample/ })).toHaveAttribute('href', '/jobs/job-1/compare?v=job-1-v3');
  });
});

describe('pickVariant', () => {
  const variants = done(3).variants;
  it('finds the variant by id, and falls back to the first for no or an unknown id', () => {
    expect(pickVariant(variants, 'job-1-v2')?.id).toBe('job-1-v2');
    expect(pickVariant(variants, undefined)?.id).toBe('job-1-v1');
    expect(pickVariant(variants, 'nope')?.id).toBe('job-1-v1');
    expect(pickVariant([], 'x')).toBeUndefined();
  });
});
