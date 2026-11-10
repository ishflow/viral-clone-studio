import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ICONS } from '@/shared/ui';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { CompareView } from './CompareView';


const shots = [1, 2, 3, 4, 5].map((n) => ({ n, from: (n - 1) * 1.6, to: n * 1.6, action: `Action ${n}` }));
const props = {
  title: 'Fragrance layering recipe',
  seconds: 8,
  jobId: 'job-1',
  shots,
  sample: { image: '/s.jpg', video: '/s.mp4' },
  yours: { image: '/y.jpg', video: '/y.mp4' },
};

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(cleanup);

describe('CompareView', () => {
  it('puts the sample and the job video side by side with the playback controls and one download', () => {
    const { container } = renderWithI18n(<CompareView {...props} />);
    expect(screen.getByText('Sample in the gallery')).toBeInTheDocument();
    expect(screen.getByText('Your video')).toBeInTheDocument();
    expect(container.querySelectorAll('video')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Playback, both videos together' })).toBeInTheDocument();
    expect(screen.getByText('0:00 / 0:08')).toBeInTheDocument();
    expect(screen.getByText('Shot 1 of 5 · Action 1')).toBeInTheDocument();
    // one Download per layout (desktop strip / phone bottom); CSS shows only one of them
    for (const link of screen.getAllByRole('link', { name: 'Download' })) expect(link).toHaveAttribute('href', '/y.mp4');
  });

  it('play starts both videos together, pause stops both', async () => {
    renderWithI18n(<CompareView {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);
  });

  it('follows the video: time and shot caption', () => {
    const { container } = renderWithI18n(<CompareView {...props} />);
    const yours = container.querySelectorAll('video')[1]!;
    Object.defineProperty(yours, 'currentTime', { value: 2.4, configurable: true });
    act(() => void fireEvent.timeUpdate(yours));
    expect(screen.getByText('0:02 / 0:08')).toBeInTheDocument();
    expect(screen.getByText('Shot 2 of 5 · Action 2')).toBeInTheDocument();
  });

  it('without a file for the job video: poster image, play disabled, download disabled', () => {
    const { container } = renderWithI18n(<CompareView {...props} sample={{ image: '/s.jpg', video: null }} yours={{ image: '/y.jpg', video: null }} />);
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(screen.getByAltText('Frame from your video')).toHaveAttribute('src', '/y.jpg');
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Download' })) expect(button).toBeDisabled();
  });

  it('has a back link to the result of this job', () => {
    renderWithI18n(<CompareView {...props} />);
    expect(screen.getByRole('link', { name: 'Back to result' })).toHaveAttribute('href', '/jobs/job-1');
  });

  it('the sound button shows the state with the shared icons: "sound off" while muted, "sound on" after', async () => {
    renderWithI18n(<CompareView {...props} />);
    const drawings = (name: string) => Array.from(screen.getByRole('button', { name }).querySelectorAll('path')).map((path) => path.getAttribute('d'));
    expect(drawings('Sound on')).toEqual([ICONS['sound off']]);
    await userEvent.click(screen.getByRole('button', { name: 'Sound on' }));
    expect(drawings('Sound off')).toEqual([ICONS['sound on']]);
  });
});
