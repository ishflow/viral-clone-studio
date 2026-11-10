import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ICONS } from '@/shared/ui';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { makeTemplate } from './fixtures';
import { PlayerDialog, currentShot } from './PlayerDialog';
import { toPlayer } from './player-data';

vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
beforeAll(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(cleanup);

const template = makeTemplate({ video: '/samples/a.mp4' });

describe('currentShot', () => {
  it('picks the shot that holds the time, the last one at the end', () => {
    expect(currentShot(template.shots, 0)).toBe(1);
    expect(currentShot(template.shots, 1.3)).toBe(2);
    expect(currentShot(template.shots, 5)).toBe(3);
    expect(currentShot(template.shots, 99)).toBe(3);
  });
});

describe('PlayerDialog', () => {
  const t = (key: string) => key;
  it('shows title, tags, shot list, Clone it and Open template; highlights the shot from the playback time', () => {
    const { container } = renderWithI18n(<PlayerDialog open onClose={() => {}} player={toPlayer(template, t)} />);
    expect(screen.getByRole('dialog', { name: 'Fragrance layering recipe' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clone it' })).toHaveAttribute('href', '/templates/tpl-a/generate');
    expect(screen.getByRole('link', { name: 'Open template' })).toHaveAttribute('href', '/templates/tpl-a');
    const items = screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('sec') && li.textContent.includes('in hand'));
    expect(items).toHaveLength(2);
    const video = container.ownerDocument.querySelector('video')!;
    Object.defineProperty(video, 'duration', { value: 8, configurable: true });
    video.currentTime = 2;
    fireEvent.timeUpdate(video);
    expect(screen.getByText('Product 1 in hand').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Products side by side').closest('li')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('0:02 / 0:08')).toBeInTheDocument();
  });
  it('closes with the Close button and with Escape', () => {
    const onClose = vi.fn();
    renderWithI18n(<PlayerDialog open onClose={onClose} player={toPlayer(template, t)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('toggles the sound between muted and on', () => {
    const { container } = renderWithI18n(<PlayerDialog open onClose={() => {}} player={toPlayer(template, t)} />);
    const video = container.ownerDocument.querySelector('video')!;
    expect(video.muted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sound on' }));
    const off = screen.getByRole('button', { name: 'Sound off' });
    expect(off).toHaveAttribute('aria-pressed', 'true');
    expect(video.muted).toBe(false);
    fireEvent.click(off);
    expect(screen.getByRole('button', { name: 'Sound on' })).toHaveAttribute('aria-pressed', 'false');
    expect(video.muted).toBe(true);
  });
  it('the sound button shows the state with the shared icons: "sound off" while muted, "sound on" after', () => {
    renderWithI18n(<PlayerDialog open onClose={() => {}} player={toPlayer(template, t)} />);
    const drawing = (name: string) => screen.getByRole('button', { name }).querySelector('path')?.getAttribute('d');
    expect(drawing('Sound on')).toBe(ICONS['sound off']);
    fireEvent.click(screen.getByRole('button', { name: 'Sound on' }));
    expect(drawing('Sound off')).toBe(ICONS['sound on']);
  });
  it('writes the times of the shots with the unit of the interface language', () => {
    renderWithI18n(<PlayerDialog open onClose={() => {}} player={toPlayer(template, t)} />, 'tr');
    const list = screen.getByRole('region', { name: 'Çekim listesi' });
    expect(list).toHaveTextContent('0.0–1.3 sn');
    expect(list).not.toHaveTextContent(/\bsec\b/);
  });
  it('closes on a click on the backdrop only, not inside the dialog box', () => {
    const onClose = vi.fn();
    renderWithI18n(<PlayerDialog open onClose={onClose} player={toPlayer(template, t)} />);
    fireEvent.click(screen.getByRole('heading', { name: 'Fragrance layering recipe' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('renders nothing when closed', () => {
    renderWithI18n(<PlayerDialog open={false} onClose={() => {}} player={toPlayer(template, t)} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
