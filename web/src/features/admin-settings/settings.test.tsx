import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

const saveSettings = vi.fn();
const checkConnection = vi.fn();
vi.mock('./actions', () => ({ saveSettings: (...a: unknown[]) => saveSettings(...a), checkConnection: (...a: unknown[]) => checkConnection(...a) }));

import type { SiteLimits } from '@/data/ports';
import type { HealthView } from './health';
import type { FullSettings } from './schema';
import { SettingsView as View } from './SettingsView';

const settings: FullSettings = {
  scanTimes: ['09:00', '15:00', '21:00'], threshold: 70, dailyCandidates: 45, dailyTemplates: 10, providerAccount: 'default',
  sources: { topads: true, shorts: true }, searches: ['skincare', 'makeup'], secondsMin: 6, secondsMax: 35, shortsMinViews: 500000, topAdsCards: 30, perScan: 15,
};
const READY: HealthView = { worker: 'running', lastSeen: '2026-10-05T08:00:00.000Z', provider: 'ready', lastSeenText: '2026-10-05 11:00' };
const LIMITS: SiteLimits = { jobsAtOnce: 2, ownVideosPerDay: 3, freeFirstVideo: true, showTalkingTemplates: false, dailySpendingLimit: null, warnAtPercent: 80, onLimitReached: 'pause-new-jobs', generationPaused: false };
const SettingsView = ({ settings: given, health = READY, limits = LIMITS }: { settings: FullSettings; health?: HealthView | null; limits?: SiteLimits }) => <View settings={given} limits={limits} health={health} />;

afterEach(cleanup);
beforeEach(() => {
  saveSettings.mockReset();
  saveSettings.mockResolvedValue({ status: 'idle', errors: {} });
  checkConnection.mockReset();
});

describe('SettingsView inputs', () => {
  it('a value that failed validation stays in the field next to its error', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { threshold: 'invalid', time2: 'invalid' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.clear(screen.getByLabelText('Score threshold (0–100)'));
    await userEvent.type(screen.getByLabelText('Score threshold (0–100)'), '150');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a whole number from 0 to 100.')).toBeInTheDocument();
    expect(screen.getByLabelText('Score threshold (0–100)')).toHaveValue(150);
  });

  it('a country code that failed validation stays in its box, as the number boxes do', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { topAdsCountry: 'invalid' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.clear(screen.getByLabelText('Top Ads country code (e.g. US)'));
    await userEvent.type(screen.getByLabelText('Top Ads country code (e.g. US)'), 'XX');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use a two-letter country code, like US or GB.')).toBeInTheDocument();
    expect(screen.getByLabelText('Top Ads country code (e.g. US)')).toHaveValue('XX');
  });

  it('shows as many time inputs as there are times plus one empty optional slot, and the timezone note', () => {
    renderWithI18n(<SettingsView settings={{ ...settings, scanTimes: ['09:00'] }} />);
    expect(screen.getByLabelText('Scan time 1')).toHaveValue('09:00');
    expect(screen.getByLabelText('Scan time 2')).toHaveValue('');
    expect(screen.queryByLabelText('Scan time 3')).toBeNull();
    expect(screen.getByText('Server time')).toBeInTheDocument();
  });

  it('shows the duplicate-time message', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { time2: 'duplicate' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Each scan time must be different.')).toBeInTheDocument();
  });
});

describe('SettingsView', () => {
  it('shows the worker and the provider from health, without any key, and the saved values', () => {
    renderWithI18n(<SettingsView settings={settings} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('The API key is set on the server. It is never shown here.')).toBeInTheDocument();
    expect(screen.getByLabelText('Scan time 2')).toHaveValue('15:00');
    expect(screen.getByLabelText('Score threshold (0–100)')).toHaveValue(70);
    expect(screen.getByLabelText('Candidates pre-screened')).toHaveValue(45);
    expect(screen.getByLabelText('Templates prepared')).toHaveValue(10);
  });

  it('out of credits: a warning row under the provider, nothing without it', () => {
    renderWithI18n(<SettingsView settings={settings} health={{ ...READY, outOfCredits: true }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The provider refused the last paid request: no credits.');
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('out of credits: the warning says how the stop ends, a retried job after the top-up, in English and in Turkish', () => {
    renderWithI18n(<SettingsView settings={settings} health={{ ...READY, outOfCredits: true }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The provider refused the last paid request: no credits. Top up the account; customers\' jobs stop until then. After the top-up, press "Retry job" on a job that stopped for it; once that job gets through, new jobs run again.');
    cleanup();
    renderWithI18n(<SettingsView settings={settings} health={{ ...READY, outOfCredits: true }} />, 'tr');
    expect(screen.getByRole('alert')).toHaveTextContent('Sağlayıcı son ücretli isteği reddetti: kredi yok. Hesaba kredi yükleyin; o zamana kadar müşteri işleri durur. Kredi yükledikten sonra bu yüzden durmuş bir işte "İşi tekrar dene"ye basın; o iş geçince yeni işler de açılır.');
  });

  it('health down → the warning state: not running, when it was last seen, what waits', () => {
    renderWithI18n(<SettingsView settings={settings} health={{ worker: 'down', lastSeen: null, provider: 'ready', lastSeenText: null }} />);
    expect(screen.getByText('Not running')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Never seen. Jobs, samples and scans wait until it runs again.');
    expect(screen.queryByText('Running')).toBeNull();
  });

  it('a provider that is not configured is a warning; the fake is test mode; unreadable health says so', () => {
    renderWithI18n(<SettingsView settings={settings} health={{ ...READY, provider: 'not-configured' }} />);
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('no paid request can be made');
    expect(screen.queryByText('The API key is set on the server. It is never shown here.')).toBeNull();
    cleanup();
    renderWithI18n(<SettingsView settings={settings} health={{ ...READY, provider: 'fake' }} />);
    expect(screen.getByText('Test mode')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).toBeNull();
    cleanup();
    renderWithI18n(<SettingsView settings={settings} health={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The status could not be read.');
  });

  it('every setting is editable and shows its saved value; the sources are toggles', async () => {
    renderWithI18n(<SettingsView settings={{ ...settings, sources: { topads: true, shorts: false } }} />);
    expect(screen.getByLabelText('Minimum length (sec)')).toHaveValue(6);
    expect(screen.getByLabelText('Maximum length (sec)')).toHaveValue(35);
    expect(screen.getByLabelText('Shorts: minimum views')).toHaveValue(500000);
    expect(screen.getByLabelText('Top Ads: cards scanned')).toHaveValue(30);
    expect(screen.getByLabelText('Candidates per scan')).toHaveValue(15);
    expect(screen.getByLabelText('Shorts hashtags')).toHaveValue('skincare\nmakeup');
    for (const label of ['Minimum length (sec)', 'Shorts hashtags']) expect(screen.getByLabelText(label)).toBeEnabled();
    const shorts = screen.getByRole('button', { name: /YouTube Shorts/ });
    expect(shorts).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(shorts);
    expect(shorts).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /TikTok Top Ads/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const sent = saveSettings.mock.calls[0]![1] as FormData;
    expect([sent.get('sourceTopads'), sent.get('sourceShorts')]).toEqual(['0', '1']);
  });

  it('Check connection asks for health again and shows what it says', async () => {
    checkConnection.mockResolvedValue({ worker: 'down', lastSeen: '2026-10-05T07:00:00.000Z', provider: 'ready', lastSeenText: '2026-10-05 10:00' });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check connection' }));
    expect(checkConnection).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Not running')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Last seen 2026-10-05 10:00 (server time). Jobs, samples and scans wait until it runs again.');
    expect(await screen.findByText('Checked just now.')).toBeInTheDocument(); // drawn one render after the status: when the check's transition ends
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('a check that cannot read the status says so, and not "Checked just now."', async () => {
    checkConnection.mockResolvedValue(null);
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check connection' }));
    expect(await screen.findByText('The status could not be read.')).toBeInTheDocument();
    expect(screen.queryByText('Checked just now.')).toBeNull();
  });

  it('shows the length order and the empty hashtag list errors', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { secondsMax: 'order', searches: 'required' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The maximum length must not be below the minimum length.')).toBeInTheDocument();
    expect(screen.getByText('Add at least one hashtag, or turn YouTube Shorts off.')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximum length (sec)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('an empty hashtag list also says so beside the YouTube Shorts toggle, where the cause is, and points to the hashtag box', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { searches: 'required' } });
    renderWithI18n(<SettingsView settings={settings} />);
    expect(screen.queryByText(/YouTube Shorts needs a hashtag/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const sources = await screen.findByRole('group', { name: 'Sources' });
    expect(within(sources).getByText('YouTube Shorts needs a hashtag: add one under Shorts hashtags, or turn it off.')).toBeInTheDocument();
  });

  it('a wrong country code is told under its own box what a country code is, not the whole filter sentence', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { topAdsCountry: 'invalid' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use a two-letter country code, like US or GB.')).toBeInTheDocument();
    expect(screen.queryByText(/Choose an industry/)).toBeNull();
  });

  it('a field error also shows beside Save changes that nothing was saved, and the first marked field gets the focus', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { secondsMax: 'order', searches: 'required' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was saved. A field above is marked: fix it and save again.');
    expect(screen.getByLabelText('Shorts hashtags')).toHaveFocus();
  });

  it('a form-level failure keeps its own line and no field is marked', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { form: 'failed' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings were not saved. Try again.');
    expect(screen.queryByText(/A field above is marked/)).toBeNull();
  });

  it('Save changes is the lime primary at the bottom, with the note beside it, and sends the form once', async () => {
    renderWithI18n(<SettingsView settings={settings} />);
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save.className).toContain('bg-accent');
    expect(screen.getByText('Scan settings apply from the next scan. Limits and safety apply as soon as you save.')).toBeInTheDocument();
    await userEvent.click(save);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const sent = saveSettings.mock.calls[0]![1] as FormData;
    expect(sent.get('threshold')).toBe('70');
    expect(sent.get('time3')).toBe('21:00');
    expect(sent.get('secondsMin')).toBe('6');
    expect(sent.get('perScan')).toBe('15');
    expect(sent.get('searches')).toBe('skincare\nmakeup');
  });

  it('shows the field errors the action returns', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { time2: 'invalid', threshold: 'invalid', dailyTemplates: 'invalid' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use a time like 09:00.')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number from 0 to 100.')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number from 1 to 1,000,000.')).toBeInTheDocument();
    expect(screen.getByLabelText('Scan time 2')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Score threshold (0–100)')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('the range messages', () => {
  it('101 jobs at once is refused with a message that names 1 to 100', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { jobsAtOnce: 'invalid' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a whole number from 1 to 100.')).toBeInTheDocument();
  });

  it('every number field names the range its schema takes, not only the lower end', async () => {
    saveSettings.mockResolvedValue({ status: 'error', errors: { ownVideosPerDay: 'invalid', dailySpendingLimit: 'invalid', shortsMinViews: 'invalid', perScan: 'invalid' } });
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a whole number from 1 to 1,000.')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number from 1 to 1,000,000,000.')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number from 0 to 10,000,000,000.')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number from 1 to 1,000,000.')).toBeInTheDocument();
  });
});

describe('Limits and safety', () => {
  it('shows the eight fields with the saved values, in one section', () => {
    renderWithI18n(<SettingsView settings={settings} />);
    const section = screen.getByRole('region', { name: 'Limits and safety' });
    expect(within(section).getByLabelText('Jobs per user at the same time')).toHaveValue(2);
    expect(within(section).getByLabelText('Own videos per user per day')).toHaveValue(3);
    expect(within(section).getByRole('button', { name: 'Free first video' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(section).getByRole('button', { name: 'Show talking templates' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(section).getByLabelText('Daily spending limit (provider credits)')).toHaveValue(null);
    expect(within(section).getByLabelText('Warn me at (%)')).toHaveValue(80);
    expect(within(section).getByLabelText('When the limit is reached')).toHaveDisplayValue('Pause new jobs');
    expect(within(section).getByRole('button', { name: 'Pause generation now' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(section).getByText(/While generation is paused, no new job starts/)).toBeInTheDocument();
    expect(screen.getByText('Scan settings apply from the next scan. Limits and safety apply as soon as you save.')).toBeInTheDocument();
  });

  it('a toggle flips the value that the form sends', async () => {
    renderWithI18n(<SettingsView settings={settings} />);
    const pause = screen.getByRole('button', { name: 'Pause generation now' });
    await userEvent.click(pause);
    expect(pause).toHaveAttribute('aria-pressed', 'true');
    expect((document.querySelector('input[name="generationPaused"]') as HTMLInputElement).value).toBe('1');
  });
});

it('shows beauty/US/7 defaults for old settings and submits changed filters', async () => {
  renderWithI18n(<SettingsView settings={settings} />);
  expect(screen.getByLabelText('Top Ads industry')).toHaveValue('beauty-personal-care');
  expect(screen.getByLabelText('Top Ads country code (e.g. US)')).toHaveValue('US');
  expect(screen.getByLabelText('Top Ads period')).toHaveValue('7');
  await userEvent.selectOptions(screen.getByLabelText('Top Ads industry'), 'haircare');
  await userEvent.clear(screen.getByLabelText('Top Ads country code (e.g. US)'));
  await userEvent.type(screen.getByLabelText('Top Ads country code (e.g. US)'), 'GB');
  await userEvent.selectOptions(screen.getByLabelText('Top Ads period'), '30');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  const sent = saveSettings.mock.calls[0]![1] as FormData;
  expect(sent.get('topAdsIndustry')).toBe('haircare');
  expect(sent.get('topAdsCountry')).toBe('GB');
  expect(sent.get('topAdsPeriod')).toBe('30');
});

describe('person swap', () => {
  const card = () => screen.getByRole('region', { name: 'Person swap' });
  const sent = (name: string) => (document.querySelector(`input[name="${name}"]`) as HTMLInputElement).value;

  it('has its two switches, each with the sentence that says what it does, on the saved values', () => {
    renderWithI18n(<SettingsView settings={settings} limits={{ ...LIMITS, personSwap: true, swapReview: false }} />);
    expect(within(card()).getByRole('button', { name: 'Person swap for customers' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card()).getByText('While this is on, customers see the person-swap pages and can start a person-swap job.')).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Look at photos before generation' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(card()).getByText('While this is on, every person-swap job waits until an admin has looked at its photos and approved them.')).toBeInTheDocument();
    expect([sent('personSwap'), sent('swapReview')]).toEqual(['1', '0']);
  });

  it('is shown while person swap is off, and a store that never saved the switches reads off and on', () => {
    renderWithI18n(<SettingsView settings={settings} />);
    expect(within(card()).getByRole('button', { name: 'Person swap for customers' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(card()).getByRole('button', { name: 'Look at photos before generation' })).toHaveAttribute('aria-pressed', 'true');
    expect([sent('personSwap'), sent('swapReview')]).toEqual(['0', '1']);
  });

  it('switching the look off asks first, and keeping it on changes nothing', async () => {
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Look at photos before generation' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch off the look at photos?' });
    expect(within(dialog).getByText(/Generation will start without anyone looking at the photos\./)).toBeInTheDocument();
    expect(sent('swapReview')).toBe('1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it on' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent('swapReview')).toBe('1');
  });

  it('the look goes off only after the admin confirmed, and comes back on without a question', async () => {
    renderWithI18n(<SettingsView settings={settings} />);
    const look = screen.getByRole('button', { name: 'Look at photos before generation' });
    await userEvent.click(look);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Switch it off' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(look).toHaveAttribute('aria-pressed', 'false');
    expect(sent('swapReview')).toBe('0');
    await userEvent.click(look);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent('swapReview')).toBe('1');
  });

  it('switching person swap itself on or off asks nothing', async () => {
    renderWithI18n(<SettingsView settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Person swap for customers' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent('personSwap')).toBe('1');
  });

  it.each([
    ['ready', 'Connected', null],
    ['fake', 'Test mode', 'Nothing is sent to a provider; no person-swap request is paid.'],
    ['not-configured', 'Not configured', 'This worker has no person-swap provider: a person-swap job would stop.'],
  ] as const)('says the state of its provider beside the switch (%s)', (swap, word, note) => {
    renderWithI18n(<SettingsView settings={settings} health={{ ...READY, swap }} />);
    const row = within(card()).getByText('Person-swap provider').closest('div')!;
    expect(within(row).getByText(word)).toBeInTheDocument();
    if (note) expect(within(row).getByText(note)).toBeInTheDocument();
    expect(within(card()).queryAllByRole('alert')).toHaveLength(swap === 'not-configured' ? 1 : 0);
  });

  it.each([['a worker that says nothing of it', READY], ['no health at all', null]] as const)('has no provider line with %s: nothing is guessed', (_name, health) => {
    renderWithI18n(<SettingsView settings={settings} health={health} />);
    expect(within(card()).queryByText('Person-swap provider')).toBeNull();
  });
});
