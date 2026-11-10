import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobMade, JobShot, JobStep } from '@/data/ports';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { loadMessages } from '@/core/i18n/messages';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { RunningView } from './RunningView';

// The stage list on the left opens what a stage made on the right: Images, Clips and Music once something of them is made; Adaptation, Edit and Render never.

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
const STEPS: JobStep[] = [step('adaptation', 'done', 1, 1), step('images', 'done', 4, 4), step('clips', 'running', 2, 3), step('music', 'done', 1, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)];
const jobWith = (shots: JobShot[], made?: JobMade, steps: JobStep[] = STEPS): Job => ({
  id: 'job-1', userId: 'u', templateId: 'tpl-1', templateTitle: 'Layering',
  input: { templateId: 'tpl-1', quality: 'fast', variants: 1, language: 'en', products: [{ name: 'Oil', description: '', images: [] }] },
  credits: 2, status: 'running', steps, stoppedReason: null, startedAt: '2026-10-04T12:00:00Z', finishedAt: null, variants: [], shots, made,
  freeVideo: false, creditsReturned: 0, queuePosition: null, delayed: false, paused: false, stoppedAt: null, continueUntil: null,
  closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: true, imagesStored: true, deletedAt: null,
});
const shot = (n: number, image: string | null, clipUrl: string | null): JobShot => ({ variant: 1, n, image, clip: clipUrl !== null, clipUrl });
const FRAME = (n: number) => `/media/jobs/r/paid/v1/image-s${n}.png`;
const CLIP = (n: number) => `/media/jobs/r/paid/v1/clip-s${n}.mp4`;
const SHOTS = [shot(1, FRAME(1), CLIP(1)), shot(2, FRAME(2), CLIP(2)), shot(3, FRAME(3), null)];
const MADE: JobMade = { music: [{ variant: 1, url: '/media/jobs/r/paid/v1/music.mp3' }], shared: [{ variant: 1, url: '/media/jobs/r/paid/v1/image-woman.png' }] };
const template = { id: 'tpl-1', title: 'Layering', image: '/samples/poster.jpg', video: null, seconds: 8 };
const view = (job: Job) => <RunningView job={job} template={template} minutesLeft={2} elapsedSeconds={30} />;
const render = (job: Job) => {
  const shown = renderWithI18n(view(job));
  // a refresh of the page hands the same tree new data: the provider stays
  return { ...shown, rerender: (next: ReturnType<typeof view>) => shown.rerender(<I18nProvider locale="en" messages={loadMessages('en')}>{next}</I18nProvider>) };
};
const panel = () => screen.getByRole('tabpanel');

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('which stages can be pressed', () => {
  it('Images, Clips and Music are tabs once they have made something; Adaptation, Edit and Render are never anything to press', () => {
    render(jobWith(SHOTS, MADE));
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    ['Images', 'Clips', 'Music'].forEach((name, index) => expect(tabs[index]).toHaveAccessibleName(name));
    const list = screen.getByRole('tablist');
    for (const name of ['Adaptation', 'Edit', 'Render']) {
      const row = within(list).getByText(name).closest('li')!;
      expect(row.querySelector('button, [role="tab"], a, [tabindex]')).toBeNull();
      expect(row.className).not.toMatch(/cursor-pointer|hover:/);
    }
  });

  it('a stage that has made nothing yet is not a tab, whatever its counter says', () => {
    render(jobWith([], undefined, [step('adaptation', 'done', 1, 1), step('images', 'running', 0, 4), step('clips', 'waiting', 0, 3), step('music', 'waiting', 0, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)]));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('the pressable stage is told apart by more than its colour: it carries a mark that points at the panel', () => {
    render(jobWith(SHOTS, MADE));
    for (const tab of screen.getAllByRole('tab')) expect(tab.querySelector('svg')).not.toBeNull();
    const row = within(screen.getByRole('tablist')).getByText('Edit').closest('li')!;
    expect(row.querySelector('svg')).toBeNull();
  });
});

describe('what the panel shows', () => {
  it('while nobody pressed anything it follows the job: the pictures first, the clips once one is made', () => {
    const early = render(jobWith([shot(1, FRAME(1), null)], undefined, [step('adaptation', 'done', 1, 1), step('images', 'running', 1, 4), step('clips', 'waiting', 0, 3), step('music', 'waiting', 0, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)]));
    expect(screen.getByRole('tab', { name: /Images/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel()).getAllByRole('button', { name: /Open the picture/ })).toHaveLength(1);
    early.rerender(view(jobWith(SHOTS, MADE)));
    expect(screen.getByRole('tab', { name: /Clips/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Images/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('once a stage is pressed the choice stays, though the job moves on', () => {
    const early = render(jobWith([shot(1, FRAME(1), null)], undefined, [step('adaptation', 'done', 1, 1), step('images', 'running', 1, 4), step('clips', 'waiting', 0, 3), step('music', 'waiting', 0, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)]));
    fireEvent.click(screen.getByRole('tab', { name: /Images/ }));
    early.rerender(view(jobWith(SHOTS, MADE)));
    expect(screen.getByRole('tab', { name: /Images/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('a picture opened large counts as the stage chosen: the panel does not move on to the clips under it', () => {
    const early = render(jobWith([shot(1, FRAME(1), null)], undefined, [step('adaptation', 'done', 1, 1), step('images', 'running', 1, 4), step('clips', 'waiting', 0, 3), step('music', 'waiting', 0, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)]));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open the picture of shot 1' }));
    early.rerender(view(jobWith(SHOTS, MADE)));
    expect(screen.getByRole('tab', { name: /Images/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Shot 1');
  });

  it('a stage can be chosen with the keyboard: the arrows move between the pressable stages and select, Home and End jump', () => {
    render(jobWith(SHOTS, MADE));
    const [images, clips, music] = screen.getAllByRole('tab');
    expect(clips).toHaveAttribute('tabindex', '0');
    expect([images, music].map((tab) => tab!.getAttribute('tabindex'))).toEqual(['-1', '-1']);
    clips!.focus();
    fireEvent.keyDown(clips!, { key: 'ArrowDown' });
    expect(music).toHaveAttribute('aria-selected', 'true');
    expect(music).toHaveFocus();
    fireEvent.keyDown(music!, { key: 'ArrowDown' });
    expect(images).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(images!, { key: 'End' });
    expect(music).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(music!, { key: 'Home' });
    expect(images).toHaveAttribute('aria-selected', 'true');
  });

  it('the panel is named by the pressed stage', () => {
    render(jobWith(SHOTS, MADE));
    fireEvent.click(screen.getByRole('tab', { name: /Music/ }));
    expect(panel()).toHaveAccessibleName(/Music/);
  });
});

describe('pressing a stage on a narrow screen', () => {
  const scrollIntoView = vi.fn();
  // The panel lies at `top` pixels from the top of the window (the window is 768 px high); every other element sits at the top.
  const panelAt = (top: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.getAttribute('role') === 'tabpanel' ? top : 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) };
  });
  beforeEach(() => { scrollIntoView.mockClear(); Element.prototype.scrollIntoView = scrollIntoView; });
  afterEach(() => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });

  it('pressing a stage whose panel lies below the screen brings the panel into view; with the panel on screen the page does not move; the panel following the job on its own never scrolls', () => {
    const early = render(jobWith([shot(1, FRAME(1), null)], undefined, [step('adaptation', 'done', 1, 1), step('images', 'running', 1, 4), step('clips', 'waiting', 0, 3), step('music', 'waiting', 0, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)]));
    const below = panelAt(1100);
    early.rerender(view(jobWith(SHOTS, MADE))); // the panel follows the job from Images to Clips by itself, far below the screen
    expect(screen.getByRole('tab', { name: /Clips/ })).toHaveAttribute('aria-selected', 'true');
    expect(scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: /Music/ }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(scrollIntoView.mock.contexts[0]).toBe(panel());
    scrollIntoView.mockClear();
    below.mockRestore();
    panelAt(200); // wide screen: the panel is beside the list, on screen
    fireEvent.click(screen.getByRole('tab', { name: /Images/ }));
    expect(screen.getByRole('tab', { name: /Images/ })).toHaveAttribute('aria-selected', 'true');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('the focus stays on the stage that was pressed', () => {
    render(jobWith(SHOTS, MADE));
    panelAt(1100);
    const music = screen.getByRole('tab', { name: /Music/ });
    music.focus();
    fireEvent.click(music);
    expect(music).toHaveFocus();
  });
});

describe('Images', () => {
  const open = () => { fireEvent.click(screen.getByRole('tab', { name: /Images/ })); };

  it('a made frame is pressable and opens large; a shot with none is not', () => {
    render(jobWith(SHOTS, MADE));
    open();
    expect(within(panel()).getAllByRole('button', { name: /Open the picture of shot/ })).toHaveLength(3);
    cleanup();
    render(jobWith([shot(1, FRAME(1), null), shot(2, null, null), shot(3, null, null)]));
    open();
    expect(within(panel()).getAllByRole('button', { name: /Open the picture/ })).toHaveLength(1);
  });

  it('pressing a frame opens its large picture; Escape closes it and the focus goes back to the box', () => {
    render(jobWith(SHOTS, MADE));
    open();
    const box = within(panel()).getByRole('button', { name: 'Open the picture of shot 2' });
    box.focus();
    fireEvent.click(box);
    const large = screen.getByRole('dialog', { name: /Shot 2/ });
    expect(within(large).getByRole('img')).toHaveAttribute('src', FRAME(2));
    within(large).getByRole('button', { name: 'Close' }).focus();   // the focus is inside the picture, so it is the close that gives it back (not a focus that never left the box)
    expect(box).not.toHaveFocus();
    fireEvent.keyDown(large, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(box).toHaveFocus();
  });

  it('a shot opens its own picture even when another shot shows the very same address (the sample pictures of the fake)', () => {
    render(jobWith([shot(1, '/same.png', null), shot(2, '/same.png', null), shot(3, '/same.png', null)]));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open the picture of shot 3' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Shot 3');
  });

  it('a picture that is open stays the one open when a new frame arrives; previous and next go by the list as it is now', () => {
    const early = render(jobWith([shot(1, FRAME(1), null), shot(3, FRAME(3), null)], MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open the picture of shot 3' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Shot 3');
    early.rerender(view(jobWith([shot(1, FRAME(1), null), shot(2, FRAME(2), null), shot(3, FRAME(3), null)], MADE)));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Shot 3');
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', FRAME(3));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Shot 2');
  });

  it('the shared picture stays open when a frame arrives before it in the list', () => {
    const early = render(jobWith([shot(1, FRAME(1), null)], MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open the shared picture' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Shared picture/);
    early.rerender(view(jobWith([shot(1, FRAME(1), null), shot(2, FRAME(2), null)], MADE)));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Shared picture/);
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', MADE.shared[0]!.url);
  });

  it('pressing outside the picture closes it too', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open the picture of shot 1' }));
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the arrow keys and the buttons go to the previous and next picture, shots first, the shared picture last; no wrapping', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open the picture of shot 3' }));
    const large = () => screen.getByRole('dialog');
    expect(within(large()).getByRole('button', { name: 'Next picture' })).toBeEnabled();
    fireEvent.keyDown(large(), { key: 'ArrowRight' });
    expect(large()).toHaveAccessibleName(/Shared picture/);
    expect(within(large()).getByRole('img')).toHaveAttribute('src', MADE.shared[0]!.url);
    expect(within(large()).getByRole('button', { name: 'Next picture' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(large(), { key: 'ArrowRight' });
    expect(large()).toHaveAccessibleName(/Shared picture/);
    fireEvent.click(within(large()).getByRole('button', { name: 'Previous picture' }));
    expect(large()).toHaveAccessibleName(/Shot 3/);
    fireEvent.keyDown(large(), { key: 'ArrowLeft' });
    fireEvent.keyDown(large(), { key: 'ArrowLeft' });
    expect(large()).toHaveAccessibleName(/Shot 1/);
    expect(within(large()).getByRole('button', { name: 'Previous picture' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('at the last picture the Next button stays focusable and keeps the focus, and the left arrow still goes back; the same at the first picture with Previous', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open the picture of shot 3' }));
    const large = () => screen.getByRole('dialog');
    const next = within(large()).getByRole('button', { name: 'Next picture' });
    next.focus();
    fireEvent.keyDown(next, { key: 'ArrowRight' });
    expect(large()).toHaveAccessibleName(/Shared picture/);
    expect(next).not.toBeDisabled(); // a disabled button drops the focus to the page, and the arrows would stop reaching the picture
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).toHaveFocus();
    expect(large()).toContainElement(document.activeElement as HTMLElement);
    fireEvent.click(next); // pressing it at the end does nothing
    expect(large()).toHaveAccessibleName(/Shared picture/);
    fireEvent.keyDown(next, { key: 'ArrowLeft' });
    expect(large()).toHaveAccessibleName(/Shot 3/);
    fireEvent.keyDown(large(), { key: 'ArrowLeft' });
    fireEvent.keyDown(large(), { key: 'ArrowLeft' });
    expect(large()).toHaveAccessibleName(/Shot 1/);
    const previous = within(large()).getByRole('button', { name: 'Previous picture' });
    previous.focus();
    fireEvent.keyDown(previous, { key: 'ArrowLeft' });
    expect(previous).not.toBeDisabled();
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(previous).toHaveFocus();
    fireEvent.click(previous);
    expect(large()).toHaveAccessibleName(/Shot 1/);
    fireEvent.keyDown(previous, { key: 'ArrowRight' });
    expect(large()).toHaveAccessibleName(/Shot 2/);
  });

  it('the shared picture is shown after the shots under a label of its own, and opens large too', () => {
    render(jobWith(SHOTS, MADE));
    open();
    const shared = within(panel()).getByRole('button', { name: 'Open the shared picture' });
    expect(panel().textContent).toContain('Used by every shot');
    fireEvent.click(shared);
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Shared picture/);
  });

  it('a frame that cannot be loaded is no longer in the large view\'s order: next goes past it and the count leaves it out', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.error(within(panel()).getByRole('button', { name: 'Open the picture of shot 2' }).querySelector('img')!);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open the picture of shot 1' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('1 of 3');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Shot 3');
  });

  it('the shared picture that cannot be loaded is not offered, and is not in the large view\'s order', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.error(within(panel()).getByRole('button', { name: 'Open the shared picture' }).querySelector('img')!);
    expect(within(panel()).queryByRole('button', { name: 'Open the shared picture' })).toBeNull();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open the picture of shot 3' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Next picture' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('a picture that cannot be loaded gives its box back to the numbered frame, with nothing to press', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.error(within(panel()).getByRole('button', { name: 'Open the picture of shot 1' }).querySelector('img')!);
    expect(within(panel()).queryByRole('button', { name: 'Open the picture of shot 1' })).toBeNull();
  });
});

describe('Clips', () => {
  const open = () => { fireEvent.click(screen.getByRole('tab', { name: /Clips/ })); };
  const videos = () => [...document.querySelectorAll('video')];

  it('a ready clip is pressable; one that is not ready is not, and says where it is', () => {
    render(jobWith(SHOTS, MADE));
    open();
    expect(within(panel()).getAllByRole('button', { name: /Play the clip of shot/ })).toHaveLength(2);
    const third = within(panel()).getByText('Shot 3').closest('figure')!;
    expect(third.querySelector('button')).toBeNull();
    expect(third.textContent).toContain('making the clip');
  });

  it('nothing plays until a clip is pressed, and the cover of a clip is the picture made for its shot', () => {
    render(jobWith(SHOTS, MADE));
    open();
    const first = within(panel()).getByRole('button', { name: 'Play the clip of shot 1' });
    fireEvent.mouseOver(first);
    fireEvent.mouseEnter(first);
    expect(videos()).toHaveLength(0);
    expect(first.querySelector('img')).toHaveAttribute('src', FRAME(1));
  });

  it('pressing a ready clip plays it in its box, with the browser\'s own controls and sound', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Play the clip of shot 2' }));
    const [video] = videos();
    expect(videos()).toHaveLength(1);
    expect(video).toHaveAttribute('src', CLIP(2));
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('poster', FRAME(2));   // the cover stays until the first picture of the clip is there
    expect(video).toHaveAttribute('playsinline');
    expect(video!.muted).toBe(false);
    expect(video!.closest('figure')).toHaveTextContent('Shot 2');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('the focus goes to the player when a clip is pressed, so the keyboard goes on in the player and not on the page body', () => {
    render(jobWith(SHOTS, MADE));
    open();
    const button = within(panel()).getByRole('button', { name: 'Play the clip of shot 2' });
    button.focus();
    fireEvent.click(button);
    expect(videos()[0]).toHaveFocus();
  });

  it('only one clip plays at a time: pressing another takes the first back to its cover', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Play the clip of shot 1' }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Play the clip of shot 2' }));
    expect(videos().map((video) => video.getAttribute('src'))).toEqual([CLIP(2)]);
    expect(within(panel()).getByRole('button', { name: 'Play the clip of shot 1' })).toBeInTheDocument();
  });

  it('the clip goes on playing when the page is refreshed with the same job', () => {
    const first = render(jobWith(SHOTS, MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Play the clip of shot 1' }));
    const video = videos()[0];
    first.rerender(view(jobWith([...SHOTS.slice(0, 2), shot(3, FRAME(3), CLIP(3))], MADE)));
    expect(videos()[0]).toBe(video);
  });

  it('a clip that cannot be loaded goes back to its cover and is not offered until the page is refreshed', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Play the clip of shot 1' }));
    act(() => { fireEvent.error(videos()[0]!); });
    expect(videos()).toHaveLength(0);
    expect(within(panel()).queryByRole('button', { name: 'Play the clip of shot 1' })).toBeNull();
  });

  it('a clip that could not be loaded is offered again when the page is refreshed', () => {
    const first = render(jobWith(SHOTS, MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Play the clip of shot 1' }));
    act(() => { fireEvent.error(videos()[0]!); });
    expect(within(panel()).queryByRole('button', { name: 'Play the clip of shot 1' })).toBeNull();
    first.rerender(view(jobWith(SHOTS, MADE)));
    expect(within(panel()).getByRole('button', { name: 'Play the clip of shot 1' })).toBeInTheDocument();
  });

  it('leaving the Clips stage stops the clip', () => {
    render(jobWith(SHOTS, MADE));
    open();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Play the clip of shot 1' }));
    fireEvent.click(screen.getByRole('tab', { name: /Music/ }));
    expect(videos()).toHaveLength(0);
  });
});

describe('Music', () => {
  it('shows the sound in the browser\'s own audio player, with a short label', () => {
    render(jobWith(SHOTS, MADE));
    fireEvent.click(screen.getByRole('tab', { name: /Music/ }));
    const audio = panel().querySelector('audio')!;
    expect(audio).toHaveAttribute('src', MADE.music[0]!.url);
    expect(audio).toHaveAttribute('controls');
    expect(panel().textContent).toContain('The music we made for your video');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('with a track for each variant, each is told by its variant', () => {
    render(jobWith(SHOTS, { music: [{ variant: 1, url: '/a.mp3' }, { variant: 2, url: '/b.mp3' }], shared: [] }));
    fireEvent.click(screen.getByRole('tab', { name: /Music/ }));
    expect([...panel().querySelectorAll('audio')].map((audio) => audio.getAttribute('src'))).toEqual(['/a.mp3', '/b.mp3']);
    expect(panel().textContent).toContain('Variant 2');
  });
});
