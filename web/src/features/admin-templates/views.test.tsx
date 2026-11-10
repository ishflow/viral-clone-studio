import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate, Template } from '@/data/ports';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { loadMessages } from '@/core/i18n/messages';
import { renderWithI18n } from '@/shared/ui/test-utils';

const saveTemplate = vi.fn();
const hideTemplate = vi.fn();
const noop = vi.fn();
const linkList = vi.fn();
const sampleCostFor = vi.fn();
const startSample = vi.fn();
const uploadProductImage = vi.fn();
vi.mock('./actions', () => ({
  uploadSamplePhoto: (...a: unknown[]) => uploadProductImage(...a),
  sampleCostFor: (...a: unknown[]) => sampleCostFor(...a),
  startSample: (...a: unknown[]) => startSample(...a),
  saveTemplate: (...a: unknown[]) => saveTemplate(...a),
  hideTemplate: (...a: unknown[]) => hideTemplate(...a),
  publishTemplate: (...a: unknown[]) => noop('publish', ...a),
  rejectTemplate: (...a: unknown[]) => noop('reject', ...a),
  addCandidateToGallery: (...a: unknown[]) => noop('add', ...a),
  rejectCandidateAction: (...a: unknown[]) => noop('rejectCandidate', ...a),
  runScanNow: (...a: unknown[]) => noop('scan', ...a),
  addLink: (...a: unknown[]) => noop('link', ...a),
  prepareLinkList: (...a: unknown[]) => linkList(...a),
}));

import { InboxView } from './InboxView';
import { ListView } from './ListView';
import { ScansView } from './ScansView';
import { EditView } from './EditView';
import type { InboxData, ListData, ScansData, WaitingCard } from './load';

const template = (over: Partial<Template> = {}): Template => ({
  id: 'tpl-1', title: 'Eye close-up with a day counter', category: 'Lashes', format: 'no-talking', seconds: 13, referenceViews: '19.8M', image: '/samples/x.jpg',
  video: null, products: 1, status: 'published', ownerId: null, timesGenerated: 4, editedAt: '2026-10-01T10:00:00Z', source: 'topads', description: '', tags: [],
  preparation: null, preparationNote: null, sample: 'none',
  shots: [
    { n: 1, from: 0, to: 4, action: 'Close-up of one bare eye', text: 'hook', product: null },
    { n: 2, from: 4, to: 9, action: 'Product goes on the lash line', text: 'counter', product: 1 },
    { n: 3, from: 9, to: 13, action: 'Product next to the eye', text: 'name', product: 1 },
  ], ...over,
});
const card = (over: Partial<WaitingCard> = {}): WaitingCard => ({ id: 'w1', title: 'Fragrance layering recipe', category: 'Fragrance', format: 'no-talking', seconds: 8, referenceViews: '1.9M', image: '/samples/x.jpg', products: 4, preparation: null, preparationNote: null, sampleRunning: null, ...over });
const PAID = { images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 };
const candidate = (over: Partial<Candidate> = {}): Candidate => ({ id: 'c1', title: 'Phone screen recording', source: 'shorts', views: '15.2M', seconds: 25, score: 58, image: '/samples/x.jpg', foundAt: '2026-10-04T08:00:00Z', ...over });
const inbox = (over: Partial<InboxData> = {}): InboxData => ({ waiting: [], candidates: [], source: 'all', threshold: 70, scanTimes: ['09:00', '15:00', '21:00'], next: '15:00', tomorrow: false, stoppedSources: [], ...over });

/** The photograph and the name of every product of the confirmation (the sample needs them all). */
async function fill(dialog: HTMLElement) {
  const photos = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type=file]'));
  for (const [i, photo] of photos.entries()) {
    await userEvent.upload(photo, new File(['x'], `p${i}.png`, { type: 'image/png' }));
    await userEvent.type(within(dialog).getAllByRole('textbox')[i]!, `Serum ${i + 1}`);
  }
  await within(dialog).findAllByText('Replace photo');
}

afterEach(cleanup);
beforeEach(() => {
  saveTemplate.mockReset();
  hideTemplate.mockReset();
  noop.mockReset();
  saveTemplate.mockResolvedValue({ status: 'idle', errors: {} });
  hideTemplate.mockResolvedValue({ status: 'idle', errors: {} });
  noop.mockResolvedValue({ status: 'done' });
  sampleCostFor.mockReset();
  startSample.mockReset();
  sampleCostFor.mockResolvedValue({ status: 'ok', paid: PAID });
  startSample.mockResolvedValue({ status: 'ok', jobId: 'job-s1' });
  uploadProductImage.mockReset();
  uploadProductImage.mockImplementation(async (form: FormData) => ({ status: 'saved', path: `uploads/u/${(form.get('file') as File).name}` }));
});

describe('ListView', () => {
  const data = (over: Partial<ListData> = {}): ListData => ({
    rows: [
      { id: 'a', title: 'Fragrance layering recipe', category: 'Fragrance', format: 'no-talking', seconds: 8, referenceViews: '1.9M', image: '/samples/x.jpg', status: 'published', editedAt: '2026-10-01T10:00:00Z', timesGenerated: 3, sample: 'current' },
      { id: 'b', title: 'Hidden one', category: 'Hair', format: 'talking', seconds: 30, referenceViews: '8.9M', image: '/samples/x.jpg', status: 'hidden', editedAt: '2026-10-01T10:00:00Z', timesGenerated: 0, sample: 'outdated' },
      { id: 'c', title: 'Own video', category: '', format: 'no-talking', seconds: 9, referenceViews: '', image: '/samples/x.jpg', status: 'private', editedAt: '2026-10-01T10:00:00Z', timesGenerated: 0, sample: 'none' },
    ], total: 3, status: 'all', q: '', ...over,
  });

  it('lists the templates with status, length, format and an Edit link; private shows who sees it', () => {
    renderWithI18n(<ListView {...data()} />);
    const table = screen.getByRole('table', { name: 'Templates' });
    const a = within(table).getByRole('row', { name: /Fragrance layering recipe/ });
    expect(within(a).getByText('Published')).toBeInTheDocument();
    expect(within(a).getByText('8 sec')).toBeInTheDocument();
    expect(within(a).getByText('No talking')).toBeInTheDocument();
    expect(within(a).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/admin/templates/a');
    expect(within(within(table).getByRole('row', { name: /Hidden one/ })).getByText('Hidden')).toBeInTheDocument();
    expect(within(table).getByText('Only the owner sees it')).toBeInTheDocument();
  });

  it('has the sub navigation, the Add from a link button and status filter links that keep the search', () => {
    renderWithI18n(<ListView {...data({ status: 'hidden', q: 'ann' })} />);
    const nav = screen.getByRole('navigation', { name: 'Templates' });
    expect(within(nav).getByRole('link', { name: 'All templates' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Inbox' })).toHaveAttribute('href', '/admin/templates/inbox');
    expect(within(nav).getByRole('link', { name: 'Scan history' })).toHaveAttribute('href', '/admin/templates/scans');
    expect(screen.getByRole('link', { name: 'Add from a link' })).toHaveAttribute('href', '/admin/templates/inbox');
    const group = screen.getByRole('group', { name: 'Status' });
    expect(within(group).getByRole('link', { name: 'Hidden' })).toHaveAttribute('aria-current', 'page');
    expect(within(group).getByRole('link', { name: 'Waiting' })).toHaveAttribute('href', '/admin/templates?status=waiting&q=ann');
    expect(within(group).getByRole('link', { name: 'All' })).toHaveAttribute('href', '/admin/templates?q=ann');
  });

  it('tells a person-swap video from a product template by a label, and leads to the page that adds one', () => {
    const rows = data().rows;
    renderWithI18n(<ListView {...data({ rows: [...rows, { ...rows[0]!, id: 'sw', title: 'Walk to the camera', swapVideo: true }] })} />);
    const table = screen.getByRole('table', { name: 'Templates' });
    expect(within(within(table).getByRole('row', { name: /Walk to the camera/ })).getByText('Person swap')).toBeInTheDocument();
    expect(within(table).getAllByText('Person swap')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Add a person-swap video' })).toHaveAttribute('href', '/admin/templates/new-swap');
    expect(screen.getByRole('link', { name: 'Add from a link' })).toHaveAttribute('href', '/admin/templates/inbox');
  });

  it('shows an empty state with a way back', () => {
    renderWithI18n(<ListView {...data({ rows: [], q: 'zzz' })} />);
    expect(screen.getByText('No templates match your search or filter.')).toBeInTheDocument();
  });
});

describe('InboxView: prepare from a list of links', () => {
  const submit = async (text: string) => {
    renderWithI18n(<InboxView {...inbox()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Links, one per line' }), text);
    await userEvent.click(screen.getByRole('button', { name: 'Prepare' }));
  };

  it('sends the box as it is, and then tells each line what became of it, with a count of each kind', async () => {
    linkList.mockResolvedValue({ status: 'done', rows: [
      { line: 'https://youtu.be/a', status: 'queued' }, { line: 'https://youtu.be/b', status: 'exists' }, { line: 'https://example.com/x', status: 'invalid' },
      { line: 'https://youtu.be/c', status: 'limit' }, { line: 'https://youtu.be/d', status: 'failed' },
    ] });
    await submit('https://youtu.be/a');
    const list = await screen.findByRole('list', { name: 'Result for each link' });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'https://youtu.be/aQueued to be prepared', 'https://youtu.be/bAlready there', 'https://example.com/xNot a link the gallery takes',
      'https://youtu.be/cDaily limit reached', 'https://youtu.be/dNot queued. Try again.',
    ]);
    expect(screen.getByText('1 queued · 1 already there · 1 not valid · 1 over the daily limit · 1 not queued')).toBeInTheDocument();
    expect(((linkList.mock.calls.at(-1)![1]) as FormData).get('links')).toBe('https://youtu.be/a');
  });

  it.each([['empty', 'Paste at least one link.'], ['tooMany', 'At most 50 links at a time. Nothing was prepared.'], ['failed', 'The list was not prepared. Try again.']])('says what is wrong with the list: %s', async (error, text) => {
    linkList.mockResolvedValue({ status: 'error', error, rows: [] });
    await submit('x');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByRole('list', { name: 'Result for each link' })).toBeNull();
  });
});

describe('InboxView', () => {
  it('empty state per the board: nothing waiting, no candidates, the next scan time', () => {
    renderWithI18n(<InboxView {...inbox()} />);
    expect(screen.getByText(/Nothing is waiting/)).toBeInTheDocument();
    expect(screen.getByText('No candidates yet. The next scan runs at 15:00. You can also paste a video link above.')).toBeInTheDocument();
    expect(screen.getByText(/Scans run 3 times a day · next at 15:00\./)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Video link' })).toHaveAttribute('placeholder', 'Paste a link: TikTok or YouTube video');
  });

  it('a waiting card with no category offers no Publish and says to choose a category first', () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ category: '' })] })} />);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByText('Choose a category before publishing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('the no-category line takes its own row above the Choose a category link, so the two never share a line', () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ category: '' })] })} />);
    const line = screen.getByText('Choose a category before publishing.').closest('p')!;
    const row = line.nextElementSibling!;
    expect(row).toContainElement(screen.getByRole('link', { name: 'Choose a category' }));
    expect(row).toContainElement(screen.getByRole('button', { name: 'Reject' }));
    expect(row).not.toContainElement(line);
  });

  it('a waiting template with no category links to its edit page', () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ id: 'w9', category: '' })] })} />);
    expect(screen.getByRole('link', { name: 'Choose a category' })).toHaveAttribute('href', '/admin/templates/w9');
    cleanup();
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ id: 'w9' })] })} />);
    expect(screen.queryByRole('link', { name: 'Choose a category' })).toBeNull();
  });

  it('the waiting cards grid fills rows with columns of the card width, so one card does not stretch over the page', () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card()] })} />);
    const grid = screen.getByRole('heading', { name: /waiting/i, level: 2 }).parentElement!.querySelector('.grid')!;
    expect(grid.className).toContain('auto-fill');
    expect(grid.className).not.toContain('auto-fit');
  });

  it('only the first waiting card has a lime Publish; Reject is secondary', () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card(), card({ id: 'w2', title: 'Second' }), card({ id: 'w3', title: 'Third' })] })} />);
    const publish = screen.getAllByRole('button', { name: 'Publish' });
    expect(publish).toHaveLength(3);
    expect(publish[0]!.className).toContain('bg-accent');
    expect(publish[1]!.className).not.toContain('bg-accent');
    expect(publish[2]!.className).not.toContain('bg-accent');
    expect(screen.getAllByRole('button', { name: 'Reject' })[0]!.className).not.toContain('bg-accent');
  });

  it('a card without a sample offers "Generate sample": the confirmation lists the paid requests, nothing is sent before it', async () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ image: '' })] })} />);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByText('No sample yet. It is generated after you confirm its paid requests.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate sample' }));
    expect(sampleCostFor).toHaveBeenCalledWith('w1');
    const dialog = await screen.findByRole('dialog', { name: 'Generate a sample?' });
    const value = (name: string) => within(dialog).getByText(name).nextElementSibling?.textContent;
    expect(value('Images')).toBe('5');
    expect(value('Clips')).toBe('5 · 20 sec billed');
    expect(value('Music tracks')).toBe('1');
    expect(within(dialog).queryByText('Voice-overs')).toBeNull();
    // a sample needs the template's products: four photographs and names (the card says 4); nothing can be confirmed before
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(4);
    expect(within(dialog).getByRole('button', { name: 'Generate sample' })).toBeDisabled();
    expect(within(dialog).getByText('Add a photo and a name for every product to generate the sample.')).toBeInTheDocument();
    expect(startSample).not.toHaveBeenCalled();
    expect(noop).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(startSample).not.toHaveBeenCalled();
  });

  it('confirming starts the sample once with the counts shown, then links to its job', async () => {
    sampleCostFor.mockResolvedValue({ status: 'ok', paid: { ...PAID, voice: 1 } });
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ image: '' })] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate sample' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Voice-overs').nextElementSibling).toHaveTextContent('1');
    await fill(dialog);
    expect(within(dialog).getByRole('button', { name: 'Generate sample' })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate sample' }));
    expect(startSample).toHaveBeenCalledTimes(1);
    expect(startSample).toHaveBeenCalledWith('w1', { ...PAID, voice: 1 }, [1, 2, 3, 4].map((n) => ({ name: `Serum ${n}`, images: [`uploads/u/p${n - 1}.png`] })));
    expect(await screen.findByText('The sample is being generated.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Follow it' })).toHaveAttribute('href', '/jobs/job-s1');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate sample' })).toBeDisabled();
  });

  it('when the paid requests changed, the confirmation shows the new counts and asks again', async () => {
    startSample.mockResolvedValueOnce({ status: 'changed', paid: { ...PAID, clips: 6, clipSeconds: 24 } });
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ image: '' })] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate sample' }));
    const dialog = await screen.findByRole('dialog');
    await fill(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate sample' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The paid requests changed.');
    expect(within(dialog).getByText('Clips').nextElementSibling).toHaveTextContent('6 · 24 sec billed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate sample' }));
    expect(startSample).toHaveBeenLastCalledWith('w1', { ...PAID, clips: 6, clipSeconds: 24 }, expect.any(Array));
  });

  it('a double click on the confirmation starts one sample', async () => {
    // Held open while clicking, then settled: an unsettled transition would hold back React's later transitions in this file.
    let settle: (value: unknown) => void = () => {};
    startSample.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ image: '' })] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate sample' }));
    const opened = await screen.findByRole('dialog');
    await fill(opened);
    const confirm = within(opened).getByRole('button', { name: 'Generate sample' });
    await userEvent.dblClick(confirm);
    await userEvent.click(confirm);
    expect(startSample).toHaveBeenCalledTimes(1);
    settle({ status: 'ok', jobId: 'job-s1' });
    expect(await screen.findByText('The sample is being generated.')).toBeInTheDocument();
  });

  it('a sample already running: the button is disabled, says so and links to that job; nothing is asked', async () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ image: '', sampleRunning: { jobId: 'job-7' } })] })} />);
    expect(screen.getByRole('button', { name: 'Generate sample' })).toBeDisabled();
    expect(screen.getByText(/A sample of this template is already being generated\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Follow it' })).toHaveAttribute('href', '/jobs/job-7');
    expect(sampleCostFor).not.toHaveBeenCalled();
  });

  it('when the server says a sample is running, no confirmation opens', async () => {
    sampleCostFor.mockResolvedValue({ status: 'running', jobId: null });
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ image: '' })] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate sample' }));
    expect(await screen.findByText('A sample of this template is already being generated.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Follow it' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate sample' })).toBeDisabled();
  });

  it('a refused start keeps the confirmation open with "nothing was spent"; an unknown one closes it and offers no second start', async () => {
    startSample.mockResolvedValueOnce({ status: 'refused' }).mockResolvedValueOnce({ status: 'unknown' });
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ image: '' })] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate sample' }));
    const dialog = await screen.findByRole('dialog');
    await fill(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate sample' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The sample did not start. Nothing was spent.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate sample' }));
    expect(await screen.findByText(/It is not known whether the sample started/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Jobs' })).toHaveAttribute('href', '/admin/jobs');
    expect(screen.getByRole('button', { name: 'Generate sample' })).toBeDisabled();
    expect(startSample).toHaveBeenCalledTimes(2);
  });

  it('a template being prepared shows its state and no actions; a failed one says why and can only be rejected', () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [
      card({ id: 'p', title: 'Preparing one', image: '', preparation: 'preparing' }),
      card({ id: 'f', title: 'Failed one', image: '', preparation: 'failed', preparationNote: 'too-long' }),
    ] })} />);
    const [preparing, failed] = screen.getAllByRole('heading', { level: 3 }).map((h) => h.closest('div.flex.min-w-0') as HTMLElement);
    expect(within(preparing!).getByText('Being prepared')).toBeInTheDocument();
    expect(within(preparing!).queryByRole('button')).toBeNull();
    expect(within(failed!).getByRole('status')).toHaveTextContent('Not prepared. The video is longer than the maximum length in Settings.');
    expect(within(failed!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reject']);
  });

  it('a failed template with a note it does not know gets the generic line', () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card({ preparation: 'failed', preparationNote: 'weird' as never })] })} />);
    expect(screen.getByText('The template could not be prepared.', { exact: false }).closest('p')).toHaveTextContent('Not prepared. The template could not be prepared.');
  });

  it('candidates: below the threshold have Add to gallery + Reject, above are queued; the score is named', async () => {
    renderWithI18n(<InboxView {...inbox({ candidates: [candidate(), candidate({ id: 'c2', title: 'Dupe comparison', score: 77, source: 'topads' })] })} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByRole('button', { name: 'Add to gallery' })).toBeInTheDocument();
    expect(within(items[0]!).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(within(items[0]!).getByText('Shorts · 15.2M views · 25 sec')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('img', { name: 'Score 58' })).toBeInTheDocument();
    expect(within(items[1]!).getByText('Queued')).toBeInTheDocument();
    expect(within(items[1]!).queryByRole('button')).toBeNull();
    expect(screen.getByText('Threshold 70: anything above becomes a template automatically.')).toBeInTheDocument();
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Add to gallery' }));
    expect(noop).toHaveBeenCalledTimes(1);
    expect(noop.mock.calls[0]![0]).toBe('add');
    expect((noop.mock.calls[0]![2] as FormData).get('id')).toBe('c1');
  });

  it('a candidate with notes opens "Why this score" with each note as plain text; one without has no such line', async () => {
    const markup = '<img src=x onerror=alert(1)> <b>bold</b>';
    const long = `Very long note ${'x'.repeat(300)}`;
    renderWithI18n(<InboxView {...inbox({ candidates: [candidate({ scoreNotes: ['No product shown', markup, long] }), candidate({ id: 'c2', title: 'No notes' })] })} />);
    const [first, second] = screen.getAllByRole('listitem');
    expect(within(second!).queryByText('Why this score')).toBeNull();
    const summary = within(first!).getByText('Why this score');
    await userEvent.click(summary);
    expect(within(first!).getByText('No product shown')).toBeVisible();
    expect(within(first!).getByText(markup)).toBeVisible();
    expect(first!.querySelector('b, img[src="x"]')).toBeNull();
    expect(within(first!).getByText(long).className).toMatch(/overflow-wrap:anywhere/);
  });

  it('says "Bu puanın nedeni" in Turkish', () => {
    renderWithI18n(<InboxView {...inbox({ candidates: [candidate({ scoreNotes: ['Ürün görünmüyor'] })] })} />, 'tr');
    expect(screen.getByText('Bu puanın nedeni')).toBeInTheDocument();
    expect(screen.getByText('Ürün görünmüyor')).toBeInTheDocument();
  });

  it('shows the scan warning with the translated reason code when a source stopped', () => {
    renderWithI18n(<InboxView {...inbox({ stoppedSources: [{ source: 'shorts', reason: 'source-unavailable' }] })} />);
    expect(screen.getByText('The YouTube Shorts scan stopped on its last run.')).toBeInTheDocument();
    expect(screen.getByText(/could not be reached/)).toBeInTheDocument();
  });

  it('a scan that stopped on an unexpected error says so (scan-failed)', () => {
    renderWithI18n(<InboxView {...inbox({ stoppedSources: [{ source: 'topads', reason: 'scan-failed' as never }] })} />);
    expect(screen.getByText(/stopped on an unexpected error/)).toBeInTheDocument();
  });

  it('a reason code it does not know gets the generic line', () => {
    renderWithI18n(<InboxView {...inbox({ stoppedSources: [{ source: 'topads', reason: 'weird' as never }] })} />);
    expect(screen.getByText('The scan stopped.')).toBeInTheDocument();
  });
});

describe('ScansView', () => {
  const scans = (over: Partial<ScansData> = {}): ScansData => ({
    scans: [
      { id: 's1', startedAt: '2026-10-04T09:00:00', source: 'topads', checked: 15, queued: 12, aboveThreshold: 4, prepared: 3, status: 'done', reason: null },
      { id: 's2', startedAt: '2026-10-04T09:00:00', source: 'shorts', checked: 0, aboveThreshold: 0, prepared: 0, status: 'stopped', reason: 'source-unavailable' },
    ], total: 5, period: '30d', threshold: 70, published: 6, times: ['09:00', '15:00', '21:00'], next: '15:00', tomorrow: false, ...over,
  });

  it('shows the schedule line with the next time and a link to settings, and the sums in the tiles', () => {
    renderWithI18n(<ScansView {...scans()} />);
    expect(screen.getByText('Scans run 3 times a day: 09:00, 15:00, 21:00 · next at 15:00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change times' })).toHaveAttribute('href', '/admin/settings');
    expect(screen.getByText('Scored above 70')).toBeInTheDocument();
    expect(screen.getAllByText('15').length).toBeGreaterThan(0);
  });

  it('the table names the source, translates the stopped reason and links to the inbox', () => {
    renderWithI18n(<ScansView {...scans()} />);
    const table = screen.getByRole('table', { name: 'Scans' });
    const stopped = within(table).getByRole('row', { name: /YouTube Shorts/ });
    expect(within(stopped).getByText('Stopped')).toBeInTheDocument();
    expect(within(stopped).getByText(/could not be reached/)).toBeInTheDocument();
    expect(within(stopped).getByRole('link', { name: 'Open candidates' })).toHaveAttribute('href', '/admin/templates/inbox?source=shorts');
    expect(within(within(table).getByRole('row', { name: /Top Ads/ })).getByText('Done')).toBeInTheDocument();
  });

  it('the table has a "Sent to scoring" column between checked and above the threshold; a scan without the count shows 0', () => {
    renderWithI18n(<ScansView {...scans()} />);
    const table = screen.getByRole('table', { name: 'Scans' });
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.slice(2, 5)).toEqual(['Videos checked', 'Sent to scoring', 'Above the threshold']);
    const cells = (name: RegExp) => within(within(table).getByRole('row', { name })).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells(/Top Ads/).slice(1, 4)).toEqual(['15', '12', '4']);
    expect(cells(/YouTube Shorts/).slice(1, 4)).toEqual(['0', '0', '0']);
  });

  it('says "Puanlamaya giden" in Turkish', () => {
    renderWithI18n(<ScansView {...scans()} />, 'tr');
    expect(screen.getByRole('columnheader', { name: 'Puanlamaya giden' })).toBeInTheDocument();
  });

  it('Run a scan now calls the action once', async () => {
    renderWithI18n(<ScansView {...scans()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run a scan now' }));
    expect(noop).toHaveBeenCalledTimes(1);
    expect(noop.mock.calls[0]![0]).toBe('scan');
    expect(await screen.findByText('A scan is running.')).toBeInTheDocument();
  });
});

async function ask(opener: string) {
  await userEvent.click(screen.getByRole('button', { name: opener }));
  return screen.getByRole('dialog');
}

describe('publishing needs a category', () => {
  it('the edit page of a waiting template with no category offers no Publish and says why', () => {
    renderWithI18n(<EditView template={template({ status: 'waiting', sample: 'current', category: '' })} categories={['Lashes']} />);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByText('Choose a category before publishing.')).toBeInTheDocument();
  });

  it('with a category the same page offers Publish and no such line', () => {
    renderWithI18n(<EditView template={template({ status: 'waiting', sample: 'current' })} categories={['Lashes']} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.queryByText('Choose a category before publishing.')).toBeNull();
  });
});

describe('destructive actions ask first', () => {
  it('Hide template: nothing is sent until the dialog is confirmed; Cancel and Escape send nothing', async () => {
    hideTemplate.mockResolvedValue({ status: 'hidden', errors: {} });
    renderWithI18n(<EditView template={template()} categories={['Lashes']} />);
    let dialog = await ask('Hide template');
    expect(within(dialog).getByText('Hide this template?')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' }).className).not.toContain('border-warn');
    expect(within(dialog).getByRole('button', { name: 'Hide template' }).className).toContain('border-warn');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    dialog = await ask('Hide template');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hideTemplate).not.toHaveBeenCalled();
    dialog = await ask('Hide template');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hide template' }));
    expect(hideTemplate).toHaveBeenCalledTimes(1);
    expect((hideTemplate.mock.calls[0]![1] as FormData).has('confirmed')).toBe(false);
  });

  it('Reject on a waiting card and on a candidate asks first, then sends once', async () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card()], candidates: [candidate()] })} />);
    const buttons = screen.getAllByRole('button', { name: 'Reject' });
    await userEvent.click(buttons[0]!);
    expect(noop).not.toHaveBeenCalled();
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Reject this template?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(noop).not.toHaveBeenCalled();
    await userEvent.click(buttons[0]!);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reject' }));
    expect(noop).toHaveBeenCalledTimes(1);
    expect(noop.mock.calls[0]![0]).toBe('reject');
    noop.mockClear();
    await userEvent.click(screen.getAllByRole('button', { name: 'Reject' })[1]!);
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Reject this candidate?')).toBeInTheDocument();
    expect(noop).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(noop).toHaveBeenCalledTimes(1);
    expect(noop.mock.calls[0]![0]).toBe('rejectCandidate');
  });

  it('Publish and Add to gallery need no dialog', async () => {
    renderWithI18n(<InboxView {...inbox({ waiting: [card()], candidates: [candidate()] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add to gallery' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(noop).toHaveBeenCalledTimes(2);
  });
});

describe('shot times', () => {
  const uneven = template({ shots: [
    { n: 1, from: 0, to: 1, action: 'a', text: '', product: null },
    { n: 2, from: 1, to: 9, action: 'b', text: '', product: null },
    { n: 3, from: 9, to: 13, action: 'c', text: '', product: null },
  ] });
  const sent = () => JSON.parse((screen.getByRole('button', { name: 'Save changes' }).closest('form')!.querySelector('input[name="shots"]') as HTMLInputElement).value);

  it('opening and saving without edits sends the stored times verbatim', async () => {
    renderWithI18n(<EditView template={uneven} categories={['Lashes']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const form = saveTemplate.mock.calls[0]![1] as FormData;
    expect(JSON.parse(String(form.get('shots'))).map((x: { from: number; to: number }) => [x.from, x.to])).toEqual([[0, 1], [1, 9], [9, 13]]);
    expect(sent().map((x: { from: number }) => x.from)).toEqual([0, 1, 9]);
  });

  it('typing in a field keeps the times; adding a shot re-tiles them', async () => {
    renderWithI18n(<EditView template={uneven} categories={['Lashes']} />);
    await userEvent.type(screen.getByLabelText('Shot 1: what happens'), 'x');
    expect(sent().map((x: { from: number }) => x.from)).toEqual([0, 1, 9]);
    await userEvent.click(screen.getByRole('button', { name: 'Add shot' }));
    expect(sent().map((x: { from: number; to: number }) => [x.from, x.to])).toEqual([[0, 3], [3, 7], [7, 10], [10, 13]]);
  });
});

describe('copy', () => {
  it('the title field stops at 120 characters, like the server', () => {
    renderWithI18n(<EditView template={template()} categories={['Lashes']} />);
    expect(screen.getByLabelText('Title')).toHaveAttribute('maxlength', '120');
  });
  it('the next scan wraps to "tomorrow at" when none is left today', () => {
    renderWithI18n(<InboxView {...inbox({ next: '09:00', tomorrow: true })} />);
    expect(screen.getByText(/next tomorrow at 09:00\./)).toBeInTheDocument();
    expect(screen.getByText(/The next scan runs tomorrow at 09:00\./)).toBeInTheDocument();
  });
});

describe('EditView', () => {
  const view = (t = template()) => renderWithI18n(<EditView template={t} categories={['Fragrance', 'Lashes', 'Hair']} />);
  const row = (n: number) => screen.getAllByRole('row').filter((r) => within(r).queryByLabelText(`Shot ${n}: what happens`))[0]!;
  const shotsSent = () => JSON.parse((screen.getByRole('button', { name: 'Save changes' }).closest('form')!.querySelector('input[name="shots"]') as HTMLInputElement).value);

  it('shows the details, the read-only length and times, and the shot list with icon buttons that have names', () => {
    view();
    expect(screen.getByRole('heading', { level: 1, name: 'Eye close-up with a day counter' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Eye close-up with a day counter');
    expect(screen.getByLabelText('Category')).toHaveValue('Lashes');
    expect(screen.getByLabelText('Length')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Length')).toHaveValue('13 sec');
    expect(screen.getByLabelText('Products needed')).toHaveValue(1);
    expect(within(row(1)).getByText('0:00–0:04')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move shot 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move shot 3 down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete shot 2' })).toBeEnabled();
    expect(screen.getByText('3 shots · 13 sec')).toBeInTheDocument();
  });

  it("the edit page shows each shot's own frame in its row, and an empty frame for a shot that has none or was just added", async () => {
    const shots = template().shots.map((s, i) => ({ ...s, image: i === 1 ? null : `/samples/frame-${s.n}.jpg` }));
    view(template({ shots }));
    const frame = (n: number) => row(n).querySelector('img');
    const empty = (n: number) => row(n).querySelector('span.border-dashed');
    expect(frame(1)?.getAttribute('src')).toContain('frame-1');
    expect(empty(1)).toBeNull();
    expect(frame(2)).toBeNull();
    expect(empty(2)).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add shot' }));
    expect(frame(4)).toBeNull();
    expect(empty(4)).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Move shot 3 up' }));
    expect(frame(2)?.getAttribute('src')).toContain('frame-3');
    expect(empty(3)).not.toBeNull();
    expect(JSON.parse((screen.getByRole('button', { name: 'Save changes' }).closest('form')!.querySelector('input[name="shots"]') as HTMLInputElement).value)[0]).not.toHaveProperty('image');
  });

  it('a private template shows the note and no visibility choice', () => {
    view(template({ status: 'private', ownerId: 'usr-1' }));
    expect(screen.getByText('Private: only its owner sees it. A customer\'s own template cannot be published.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Published' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hidden' })).toBeNull();
    cleanup();
    view(template({ status: 'published' }));
    expect(screen.queryByText(/A customer's own template cannot be published/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Published' })).toBeInTheDocument();
  });

  it('Save changes is the only lime button; Hide template is the warning outline', () => {
    view();
    expect(screen.getByRole('button', { name: 'Save changes' }).className).toContain('bg-accent');
    expect(screen.getByRole('button', { name: 'Discard changes' }).className).not.toContain('bg-accent');
    expect(screen.getByRole('button', { name: 'Hide template' }).className).toContain('border-warn');
  });

  it('adding, removing and moving shots recomputes the times so they tile the length', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Add shot' }));
    expect(screen.getByText('4 shots · 13 sec')).toBeInTheDocument();
    expect(shotsSent().map((s: { from: number; to: number }) => [s.from, s.to])).toEqual([[0, 3], [3, 7], [7, 10], [10, 13]]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete shot 4' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move shot 1 down' }));
    const sent = shotsSent();
    expect(sent.map((s: { action: string }) => s.action)).toEqual(['Product goes on the lash line', 'Close-up of one bare eye', 'Product next to the eye']);
    expect(sent.at(0).from).toBe(0);
    expect(sent.at(-1).to).toBe(13);
  });

  it('Add shot stops at one shot per second', async () => {
    view(template({ seconds: 3 }));
    expect(screen.getByRole('button', { name: 'Add shot' })).toBeDisabled();
    expect(screen.getByText(/holds 3 shots at most/)).toBeInTheDocument();
  });

  it('Discard changes puts back everything the user typed', async () => {
    view();
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Changed');
    await userEvent.click(screen.getByRole('button', { name: 'Delete shot 1' }));
    expect(screen.getByText('2 shots · 13 sec')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Eye close-up with a day counter');
    expect(screen.getByText('3 shots · 13 sec')).toBeInTheDocument();
  });

  it('the product select offers None and Product 1..n for the products needed', async () => {
    view(template({ products: 2 }));
    const select = screen.getByLabelText('Shot 1: product');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', 'Product 1', 'Product 2']);
  });

  it('Save sends the form once and shows the field errors the action returns', async () => {
    saveTemplate.mockResolvedValue({ status: 'error', errors: { title: 'invalid', shots: { code: 'range', n: 2 } } });
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveTemplate).toHaveBeenCalledTimes(1);
    const sent = saveTemplate.mock.calls[0]![1] as FormData;
    expect(sent.get('id')).toBe('tpl-1');
    expect(sent.get('title')).toBe('Eye close-up with a day counter');
    expect(await screen.findByText('Write a title of 3 to 120 characters.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Shot 2 is outside the template length.');
  });

  it('Hide template sends its own form; a hidden template cannot be hidden again', async () => {
    hideTemplate.mockResolvedValue({ status: 'hidden', errors: {} });
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Hide template' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hide template' }));
    expect(hideTemplate).toHaveBeenCalledTimes(1);
    expect(saveTemplate).not.toHaveBeenCalled();
    expect(await screen.findByText('The template is hidden.')).toBeInTheDocument();
    cleanup();
    view(template({ status: 'hidden' }));
    expect(screen.getByRole('button', { name: 'Hide template' })).toBeDisabled();
  });

  it('on the phone the sample is a small frame next to the reference and the button (board A-Sablon-Duzenle-M)', () => {
    view(template({ sample: 'current' }));
    const panel = screen.getByRole('complementary', { name: 'Sample' });
    const layout = panel.querySelector('[data-sample-layout]')!;
    expect(layout.className.split(' ')).toEqual(expect.arrayContaining(['grid', 'grid-cols-[132px_minmax(0,1fr)]', 'nav:flex', 'nav:flex-col']));
    expect(within(panel).getByText('Sample video, generated by this system.').className.split(' ')).toEqual(expect.arrayContaining(['max-nav:order-3', 'max-nav:col-span-2']));
    expect(within(panel).getByRole('button', { name: /Regenerate sample/ })).toBeInTheDocument();
  });

  it('a refused save keeps the chosen category in the select, so the next save sends it', async () => {
    saveTemplate.mockResolvedValue({ status: 'error', errors: { title: 'invalid' } });
    view();
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Hair');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Write a title of 3 to 120 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toHaveValue('Hair');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((saveTemplate.mock.calls[1]![1] as FormData).get('category')).toBe('Hair');
  });

  it('the confirmation stays when the server sends the changed template back (new last-edit time restarts the editor)', async () => {
    const page = (t: Template) => (
      <I18nProvider locale="en" messages={loadMessages('en')}>
        <EditView template={t} categories={['Fragrance', 'Lashes', 'Hair']} />
      </I18nProvider>
    );
    saveTemplate.mockResolvedValue({ status: 'saved', errors: {} });
    const { rerender } = view();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    rerender(page(template({ title: 'Eye close-up, saved', editedAt: '2026-10-04T12:00:00Z' })));
    expect(screen.getByLabelText('Title')).toHaveValue('Eye close-up, saved');
    expect(screen.getByText('Changes saved.')).toBeInTheDocument();

    hideTemplate.mockResolvedValue({ status: 'hidden', errors: {} });
    await userEvent.click(screen.getByRole('button', { name: 'Hide template' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hide template' }));
    expect(await screen.findByText('The template is hidden.')).toBeInTheDocument();
    rerender(page(template({ status: 'hidden', editedAt: '2026-10-04T12:05:00Z' })));
    expect(screen.getByText('The template is hidden.')).toBeInTheDocument();
    expect(screen.queryByText('Changes saved.')).toBeNull();

    // A refused save takes the old confirmation away.
    saveTemplate.mockResolvedValue({ status: 'error', errors: { title: 'invalid' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Write a title of 3 to 120 characters.')).toBeInTheDocument();
    expect(screen.queryByText('The template is hidden.')).toBeNull();
  });

  it('Regenerate sample asks for the paid requests of this template first', async () => {
    view(template({ sample: 'current' }));
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate sample' }));
    expect(sampleCostFor).toHaveBeenCalledWith('tpl-1');
    expect(await screen.findByRole('dialog', { name: 'Generate a sample?' })).toBeInTheDocument();
    expect(startSample).not.toHaveBeenCalled();
  });

  it('no Regenerate sample on a private template or one whose preparation failed or runs', () => {
    for (const over of [{ status: 'private' as const, ownerId: 'u' }, { status: 'waiting' as const, preparation: 'failed' as const }, { status: 'waiting' as const, preparation: 'preparing' as const }]) {
      view(template(over));
      expect(screen.queryByRole('button', { name: /generate .*sample|generate sample/i })).toBeNull();
      cleanup();
    }
  });

  it('a template with no sample says so: the reference is not called a sample, and the button reads "Generate sample"', async () => {
    view(template({ sample: 'none', video: null, referenceVideo: '/samples/ref.mp4', image: '' }));
    const panel = screen.getByRole('complementary', { name: 'Sample' });
    expect(within(panel).getByText('No sample yet. The reference is shown here instead.')).toBeInTheDocument();
    expect(within(panel).queryByText('Sample video, generated by this system.')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /Regenerate/ })).toBeNull();
    expect(within(panel).getByText('A sample is generated after you confirm its paid requests.')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Generate sample' }));
    expect(sampleCostFor).toHaveBeenCalledWith('tpl-1');
  });

  it('a template with no sample reads the same in Turkish, and one with a sample keeps its own note', () => {
    renderWithI18n(<EditView template={template({ sample: 'none', referenceVideo: '/samples/ref.mp4' })} categories={['Lashes']} />, 'tr');
    const panel = screen.getByRole('complementary', { name: 'Örnek' });
    expect(within(panel).getByText('Henüz örnek yok. Burada onun yerine kaynak video görünür.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Örnek üret' })).toBeInTheDocument();
    expect(within(panel).queryByText('Örnek video, bu sistem tarafından üretildi.')).toBeNull();
    cleanup();
    renderWithI18n(<EditView template={template({ sample: 'current' })} categories={['Lashes']} />, 'tr');
    expect(screen.getByText('Örnek video, bu sistem tarafından üretildi.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Örneği yeniden üret' })).toBeInTheDocument();
  });

  it('shows a preparing state, and the note of an edit that was not taken over', () => {
    view(template({ preparation: 'preparing', status: 'waiting' }));
    expect(screen.getByText('Being prepared')).toBeInTheDocument();
    cleanup();
    view(template({ preparationNote: 'check-failed' }));
    expect(screen.getByText('The card did not pass the system check, so the change was not taken over.')).toBeInTheDocument();
    expect(screen.queryByText('Not prepared.')).toBeNull();
  });
});

describe('sample state (B11)', () => {
  const view = (t: Template) => renderWithI18n(<EditView template={t} categories={['Fragrance', 'Lashes', 'Hair']} />);

  it('a current sample says "Sample up to date" next to its heading; no warning, Publish is offered', () => {
    view(template({ status: 'waiting', sample: 'current' }));
    expect(within(screen.getByRole('complementary')).getByText('Sample up to date')).toBeInTheDocument();
    expect(document.querySelector('[data-outdated-notice]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Regenerate sample' })).toBeInTheDocument();
  });

  it('an out-of-date sample: the warning, the label, one lime "Generate a new sample", Publish and Published are off, Save changes is secondary, Discard and Hide are gone', () => {
    view(template({ status: 'hidden', sample: 'outdated' }));
    const notice = document.querySelector('[data-outdated-notice]') as HTMLElement;
    expect(notice).toHaveTextContent('The shots changed after this sample was made. Generate a new sample before you publish.');
    expect(within(screen.getByRole('complementary')).getByText('Sample out of date')).toBeInTheDocument();
    const generate = screen.getByRole('button', { name: 'Generate a new sample' });
    expect(generate.className).toContain('bg-accent');
    expect(screen.getByText('A new sample is generated after credit confirmation.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Published' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' }).className).not.toContain('bg-accent');
    expect(screen.getByText(/Publish turns on when the new sample is ready/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide template' })).toBeNull();
  });

  it('the list has a Sample column: up to date, out of date (warning), no sample yet', () => {
    const rows = (['current', 'outdated', 'none'] as const).map((sample, i) => ({ id: `r${i}`, title: `T${i}`, category: 'Hair', format: 'no-talking' as const, seconds: 8, referenceViews: '1M', image: '/samples/x.jpg', status: 'hidden' as const, editedAt: '2026-10-01T10:00:00Z', timesGenerated: 0, sample }));
    renderWithI18n(<ListView rows={rows} total={3} status="all" q="" />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toContain('Sample');
    expect(within(within(table).getByRole('row', { name: /T0/ })).getByText('Sample up to date')).toBeInTheDocument();
    expect(within(within(table).getByRole('row', { name: /T1/ })).getByText('Sample out of date').className).toContain('text-warn');
    expect(within(within(table).getByRole('row', { name: /T2/ })).getByText('No sample yet')).toBeInTheDocument();
  });
});

it('publishes a current hidden sample once, without a confirmation or sample-generation request', async () => {
  renderWithI18n(<EditView template={template({ status: 'hidden', sample: 'current' })} categories={['Lashes']} />);
  const publish = screen.getByRole('button', { name: 'Publish' });
  await userEvent.click(publish);
  expect(noop).toHaveBeenCalledTimes(1);
  expect(noop.mock.calls[0]![0]).toBe('publish');
  expect((noop.mock.calls[0]![2] as FormData).get('id')).toBe('tpl-1');
  expect(publish).toBeDisabled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(startSample).not.toHaveBeenCalled();
});

it('Inbox uses source metrics, rounds fractional seconds, omits unknown counters and plays the reference', () => {
  renderWithI18n(<InboxView {...inbox({ waiting: [card({ referenceImage: '/media/templates/w1/reference.jpg', referenceVideo: '/media/templates/w1/reference.mp4', image: '', referenceMetric: { kind: 'likes', count: 155300 }, seconds: 20.433333333333334 })], candidates: [candidate({ referenceMetric: { kind: 'views', count: 1200 } }), candidate({ id: 'empty', title: 'Unknown metrics', views: '' })] })} />);
  expect(screen.getByText('Reference video · 155.3K likes')).toBeInTheDocument();
  expect(screen.getByText('Shorts · 1.2K views · 25 sec')).toBeInTheDocument();
  expect(screen.getByText('Shorts · 25 sec')).toBeInTheDocument();
  expect(screen.getByText(/Fragrance · 20 sec/)).toBeInTheDocument();
  expect(document.querySelector('video')?.getAttribute('poster')).toBe('/media/templates/w1/reference.jpg');
});

it('a successful scan with no matching industry shows the empty-result explanation', () => {
  const scan = { id: 'empty-industry', startedAt: '2026-10-04T10:00:00Z', source: 'topads' as const, checked: 100, aboveThreshold: 0, prepared: 0, status: 'done' as const, reason: 'no-matching-industry' as const };
  renderWithI18n(<ScansView scans={[scan]} total={1} period="all" threshold={70} published={0} times={['09:00']} next="09:00" tomorrow={false} />);
  expect(screen.getByText('No ads matched the selected industry. The scan completed without candidates.')).toBeInTheDocument();
});
