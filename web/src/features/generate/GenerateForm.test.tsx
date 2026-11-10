import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import type { Estimate, GenerateInput } from '@/data/ports';
import { readDraft, writeDraft } from '@/shared/lib/session-draft';

const estimateGeneration = vi.fn();
const confirmGeneration = vi.fn();
const findStartedJob = vi.fn<(key: string) => Promise<string | null>>(async () => null);
const saveFormDraft = vi.fn<(raw: unknown) => Promise<boolean>>(async () => true);
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }), unstable_rethrow: () => undefined }));
// The upload of the fake data layer keeps a photo by its file name: the same answer here.
const uploadProductImage = vi.fn(async (form: FormData) => ({ status: 'saved', path: (form.get('file') as File).name }));
vi.mock('./actions', () => ({
  estimateGeneration: (...a: unknown[]) => estimateGeneration(...a),
  confirmGeneration: (...a: unknown[]) => confirmGeneration(...a),
  findStartedJob: (key: string) => findStartedJob(key),
  saveFormDraft: (raw: unknown) => saveFormDraft(raw),
  uploadProductImage: (form: FormData) => uploadProductImage(form),
}));

import { GenerateForm, START_TIMEOUT_MS } from './GenerateForm';

const template = { id: 'tpl-layering', title: 'Fragrance layering recipe', image: '/samples/x.jpg', products: 4, shots: 5, seconds: 8, format: 'no-talking' as const };
const DRAFT_KEY = 'vc:draft:generate:usr-test:tpl-layering';
const RATES = { fast: 2, best: 5 };
const baseEstimate: Estimate = { images: 5, clips: 5, clipSeconds: 20, musicTracks: 1, minutes: 7, credits: 2, coveredByFreeVideo: false, balance: 12, enough: true };
const ready = (estimate: Partial<Estimate> = {}) => ({
  status: 'ready' as const,
  title: template.title,
  estimate: { ...baseEstimate, ...estimate },
  input: { templateId: template.id, products: [], quality: 'fast' as const, variants: 1 as const, language: 'en' },
});

beforeEach(() => {
  estimateGeneration.mockReset();
  confirmGeneration.mockReset();
  findStartedJob.mockClear();
  saveFormDraft.mockClear();
  push.mockClear();
  window.sessionStorage.clear();   // the form keeps itself in the tab: one test must not hand its form to the next
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

const setup = (props: { free?: boolean; freeHeld?: boolean; paused?: boolean; fromJob?: boolean; draft?: GenerateInput | null; template?: typeof template } = {}) =>
  renderWithI18n(<GenerateForm template={props.template ?? template} rates={RATES} free={props.free ?? false} freeHeld={props.freeHeld ?? false} paused={props.paused ?? false} draft={props.draft ?? null} fromJob={props.fromJob ?? false} draftKey={DRAFT_KEY} />);
const generate = () => userEvent.click(screen.getByRole('button', { name: 'Generate' }));
const confirmButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Confirm and generate' });

describe('GenerateForm', () => {
  it('draws the template picture when it has one, and an empty frame of the same size (never an img without a src) when it has none', () => {
    const { unmount } = setup();
    expect(within(screen.getByRole('complementary')).getByRole('presentation')).toHaveAttribute('src', '/samples/x.jpg');
    unmount();
    setup({ template: { ...template, image: '' } });
    const aside = screen.getByRole('complementary');
    expect(aside.querySelector('img')).toBeNull();
    expect(aside.querySelector('[aria-hidden="true"]')).toHaveClass('aspect-[9/16]');
  });
  it('shows one block per product, the template card with the section 11 promise, and the photo rules once', () => {
    setup();
    expect(screen.getAllByRole('group', { name: /^Product \d$/ })).toHaveLength(4);
    expect(screen.getByText('Needs 4 products · 5 shots · 8 sec · no talking')).toBeInTheDocument();
    expect(screen.getByText(/The structure stays the same: shots, order, timing and on-screen text\. People, setting and music are made new around your product\./)).toBeInTheDocument();
    expect(screen.getAllByText('JPG, PNG or WebP · up to 10 MB each · 1 to 8 images per product')).toHaveLength(1);
  });

  it('an empty product has the wide drop area, and picked files go to it', async () => {
    setup();
    const block = screen.getByRole('group', { name: 'Product 1' });
    expect(within(block).getByText('Drop images here or choose files')).toBeInTheDocument();
    const drop = within(block).getByText('Drop images here or choose files').closest('label')!;
    expect(drop.className).toContain('border-edge-strong');
    await act(async () => {
      fireEvent.drop(drop, { dataTransfer: { files: [new File(['x'], 'oil.png', { type: 'image/png' })] } });
    });
    await waitFor(() => expect(uploadProductImage).toHaveBeenCalledTimes(1));
    expect(within(block).queryByText('Drop images here or choose files')).toBeNull(); // the small + once there is an image
  });

  it('a product with no image shows the drop area in the warning colour after a failed check', async () => {
    estimateGeneration.mockResolvedValue({ status: 'invalid', problems: [{ product: 0, field: 'images' }] });
    setup();
    await generate();
    const drop = within(screen.getByRole('group', { name: 'Product 1' })).getByText('Drop images here or choose files').closest('label')!;
    await waitFor(() => expect(drop.className).toContain('border-warn'));
  });

  it('"Add at least one image" stands with the drop area of its product, not below the name and description boxes', async () => {
    estimateGeneration.mockResolvedValue({ status: 'invalid', problems: [{ product: 0, field: 'images' }] });
    setup();
    await generate();
    const block = screen.getByRole('group', { name: 'Product 1' });
    const message = await within(block).findByText('Add at least one image of this product.');
    const drop = within(block).getByText('Drop images here or choose files').closest('label')!;
    let shared: HTMLElement | null = message.parentElement;
    while (shared && !shared.contains(drop)) shared = shared.parentElement;
    expect(shared).not.toBeNull();
    expect(shared).not.toBe(block);
    expect(within(shared!).queryByLabelText('Product name')).toBeNull();
  });

  it('the language menu has two languages and the note that the site language is in the account', () => {
    setup();
    const select = screen.getByLabelText(/Video language/);
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['English', 'Türkçe']);
    expect(screen.getByText('The site language is set in your account.')).toBeInTheDocument();
    expect(screen.queryByText('[MORE LANGUAGES]')).toBeNull();
  });

  describe('the price line', () => {
    it.each([
      [false, 'fast', 1, '2 credits · 8 sec · 9:16 · 720p'],
      [false, 'best', 1, '5 credits · 8 sec · 9:16 · 1080p'],
      [false, 'best', 3, '15 credits · 8 sec · 9:16 · 1080p · 3 variants'],
    ] as const)('free %s, %s, %i variants: %s', async (free, quality, variants, line) => {
      setup({ free });
      if (quality === 'best') await userEvent.click(screen.getByRole('button', { name: /Best/ }));
      if (variants > 1) await userEvent.click(screen.getByRole('button', { name: String(variants) }));
      expect(screen.getByText(line)).toBeInTheDocument();
      expect(screen.getByText('You are charged when you confirm. If the video is not delivered, the credits come back.')).toBeInTheDocument();
      expect(screen.queryByText(/images · .* clips/)).toBeNull(); // the raw amounts are for the confirmation only
    });
    it('free video, Fast, one variant: 0 credits and the note that it uses the free video', () => {
      setup({ free: true });
      expect(screen.getByText('Free video · 0 credits · 8 sec · 9:16 · 720p')).toBeInTheDocument();
      expect(screen.getByText('This uses your one free video.')).toBeInTheDocument();
    });
    it('free video but Best or more variants: the price and what the free video covers', async () => {
      setup({ free: true });
      await userEvent.click(screen.getByRole('button', { name: /Best/ }));
      expect(screen.getByText('5 credits · 8 sec · 9:16 · 1080p')).toBeInTheDocument();
      expect(screen.getByText('Your free video covers Fast quality and one variant. This choice costs 5 credits.')).toBeInTheDocument();
    });
    it('the free video is kept but today\'s share is closed: the price is credits and the line says why, and it says nothing while the free video applies', () => {
      const note = "Today's free videos are all taken. Your free video is kept: use it another day, or make this one with credits.";
      const { unmount } = setup({ freeHeld: true });
      expect(screen.getByText('2 credits · 8 sec · 9:16 · 720p')).toBeInTheDocument();
      expect(screen.getByText(note)).toBeInTheDocument();
      unmount();
      setup({ free: true });
      expect(screen.queryByText(note)).toBeNull();
    });
    it('only a talking template says that the presenter\'s words come from the typed description', () => {
      const note = 'What the presenter says is written from your product description. Only claims you typed are used.';
      const { unmount } = setup();
      expect(screen.queryByText(note)).toBeNull();
      unmount();
      setup({ template: { ...template, format: 'talking' as never } });
      expect(screen.getByText(note)).toBeInTheDocument();
    });
    it('a talking template never shows the free video lines', () => {
      setup({ free: true, template: { ...template, format: 'talking' as never } });
      expect(screen.queryByText(/free video/i)).toBeNull();
    });
  });

  it('previews picked images and submits only their stored names', async () => {
    estimateGeneration.mockResolvedValue({ status: 'invalid', problems: [] });
    setup();
    const block = screen.getByRole('group', { name: 'Product 1' });
    await userEvent.upload(within(block).getByLabelText('Add image'), new File(['x'], 'oil.png', { type: 'image/png' }));
    expect(within(block).getByAltText('Uploaded product image')).toHaveAttribute('src', 'blob:preview');
    await userEvent.type(within(block).getByLabelText('Product name'), 'Body Oil');
    await generate();
    const sent = estimateGeneration.mock.calls[0]![0];
    expect(sent.products[0]).toEqual({ name: 'Body Oil', description: '', images: ['oil.png'] });
    expect(sent).toMatchObject({ templateId: 'tpl-layering', quality: 'fast', variants: 1, language: 'en' });
    expect(JSON.stringify(sent)).not.toContain('blob:');
  });

  it('Replace swaps a photo for the new one; Remove drops it', async () => {
    setup();
    const block = screen.getByRole('group', { name: 'Product 1' });
    await userEvent.upload(within(block).getByLabelText('Add image'), new File(['x'], 'one.png', { type: 'image/png' }));
    await waitFor(() => expect(within(block).getByRole('button', { name: /Remove image one\.png/ })).toBeInTheDocument());
    await userEvent.upload(within(block).getByLabelText(/^Replace/), new File(['y'], 'two.png', { type: 'image/png' }));
    await waitFor(() => expect(within(block).getByRole('button', { name: /Remove image two\.png/ })).toBeInTheDocument());
    expect(within(block).queryByRole('button', { name: /Remove image one\.png/ })).toBeNull();
    await userEvent.click(within(block).getByRole('button', { name: /Remove image two\.png/ }));
    expect(within(block).queryByAltText('Uploaded product image')).toBeNull();
  });

  it('a draft brings back the entries and the stored photos, and says so', () => {
    const draft: GenerateInput = {
      templateId: template.id, quality: 'best', variants: 2, language: 'tr',
      products: [{ name: 'Oil', description: 'smooth', images: ['uploads/abc/1.png', 'oil.jpg'] }, ...Array.from({ length: 3 }, () => ({ name: '', description: '', images: [] as string[] }))],
    };
    setup({ draft });
    const block = screen.getByRole('group', { name: 'Product 1' });
    expect(within(block).getByLabelText('Product name')).toHaveValue('Oil');
    expect(within(block).getAllByAltText('Uploaded product image')).toHaveLength(1); // only a stored photo the media route can show
    expect(within(block).getByAltText('Uploaded product image')).toHaveAttribute('src', '/media/uploads/abc/1.png');
    expect(screen.getByRole('status')).toHaveTextContent('We kept your entries from your last visit, with their images.');
    cleanup();
    setup({ draft: { ...draft, products: draft.products.map((p) => ({ ...p, images: ['oil.jpg'] })) } });
    expect(screen.getByRole('status')).toHaveTextContent('We kept your entries from your last visit. Add the images again.');
    expect(screen.getByRole('button', { name: /Best/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the entries of an earlier video say where they come from, not that they are from the last visit', () => {
    const draft: GenerateInput = {
      templateId: template.id, quality: 'fast', variants: 1, language: 'en',
      products: [{ name: 'Oil', description: '', images: ['uploads/abc/1.png'] }, ...Array.from({ length: 3 }, () => ({ name: 'B', description: '', images: ['uploads/abc/2.png'] }))],
    };
    setup({ draft, fromJob: true });
    expect(screen.getByRole('status')).toHaveTextContent('We filled in the entries of this video, with their images. Check them, then generate.');
    cleanup();
    setup({ draft: { ...draft, products: draft.products.map((p) => ({ ...p, images: [] })) }, fromJob: true });
    expect(screen.getByRole('status')).toHaveTextContent('We filled in the entries of this video. Add the images again.');
  });

  it('shows the field messages and the summary alert exactly as the error board', async () => {
    estimateGeneration.mockResolvedValue({
      status: 'invalid',
      problems: [
        { product: 1, field: 'images' },
        { product: 2, field: 'name' },
      ],
    });
    setup();
    await generate();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Two things to fix before generating. Product 2 needs an image. Product 3 needs a name.');
    expect(screen.getByText('Add at least one image of this product.')).toBeInTheDocument();
    expect(screen.getByText('Give this product a name.')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Product 3' })).getByLabelText('Product name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the name box stops at 120 characters and the description box at 300', () => {
    setup();
    const block = screen.getByRole('group', { name: 'Product 1' });
    expect(within(block).getByLabelText('Product name')).toHaveAttribute('maxlength', '120');
    expect(within(block).getByPlaceholderText(/./)).toHaveAttribute('maxlength', '300');
  });

  it('says that a name or a description is too long, not that the name is missing', async () => {
    estimateGeneration.mockResolvedValue({
      status: 'invalid',
      problems: [
        { product: 0, field: 'name-long' },
        { product: 1, field: 'description-long' },
      ],
    });
    setup();
    await generate();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Two things to fix before generating. Product 1: the name can be at most 120 characters. Product 2: the description can be at most 300 characters.');
    expect(within(screen.getByRole('group', { name: 'Product 1' })).getByLabelText('Product name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Give this product a name.')).toBeNull();
  });

  it('while generation is paused the form says so at the top and Generate is off, so nothing is asked of the server', async () => {
    setup({ paused: true });
    expect(screen.getByRole('status')).toHaveTextContent('Generation is paused for a short time. Come back a little later: nothing is charged.');
    const button = screen.getByRole('button', { name: 'Generate' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(estimateGeneration).not.toHaveBeenCalled();
  });

  it('without a pause there is no such note and Generate is on', () => {
    setup();
    expect(screen.queryByText(/paused for a short time/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
  });

  it('a description over 300 characters is told under its own box too, and the box is marked', async () => {
    estimateGeneration.mockResolvedValue({ status: 'invalid', problems: [{ product: 1, field: 'description-long' }] });
    setup();
    await generate();
    const block = await screen.findByRole('group', { name: 'Product 2' });
    const box = within(block).getByLabelText('Short description');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(within(block).getByText('The description can be at most 300 characters.')).toBeInTheDocument();
    expect(box).toHaveAccessibleDescription('The description can be at most 300 characters.');
    expect(within(screen.getByRole('group', { name: 'Product 1' })).queryByText(/at most 300/)).toBeNull();
  });

  it('after a refused Generate the first marked box gets the focus and is scrolled into view; typing later does not pull it back', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    estimateGeneration.mockResolvedValue({
      status: 'invalid',
      problems: [{ product: 1, field: 'name' }, { product: 2, field: 'description-long' }],
    });
    setup();
    await generate();
    const name = within(await screen.findByRole('group', { name: 'Product 2' })).getByLabelText('Product name');
    await waitFor(() => expect(name).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts).toContain(name);
    const other = within(screen.getByRole('group', { name: 'Product 4' })).getByLabelText('Product name');
    await userEvent.type(other, 'x');
    expect(other).toHaveFocus(); // the name of Product 2 is still marked, yet the typing is not interrupted
  });

  it('typing a name after an empty Generate removes that product\'s name error from the strip', async () => {
    estimateGeneration.mockResolvedValue({
      status: 'invalid',
      problems: [
        { product: 0, field: 'name' },
        { product: 1, field: 'name' },
      ],
    });
    setup();
    await generate();
    expect(await screen.findByRole('alert')).toHaveTextContent('Two things to fix before generating. Product 1 needs a name. Product 2 needs a name.');
    await userEvent.type(within(screen.getByRole('group', { name: 'Product 1' })).getByLabelText('Product name'), 'Oil');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('One thing to fix before generating. Product 2 needs a name.');
    expect(alert).not.toHaveTextContent('Product 1 needs a name');
    await userEvent.type(within(screen.getByRole('group', { name: 'Product 2' })).getByLabelText('Product name'), 'Mist');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a form-level message when the template is not ready', async () => {
    estimateGeneration.mockResolvedValue({ status: 'error', code: 'not-ready' });
    setup();
    await generate();
    expect(await screen.findByRole('alert')).toHaveTextContent('This template is not ready yet.');
  });

  it('prints the template length through the shared duration format', () => {
    setup();
    expect(screen.getAllByText(/· 8 sec ·/).length).toBeGreaterThan(0);
  });
});

describe('GenerateForm: the confirmation', () => {
  it('prints a measured template length (20.433 s) as whole seconds in the confirmation', async () => {
    estimateGeneration.mockResolvedValue(ready());
    const measured = { ...template, products: 1, seconds: 20.433333333333334 };
    const { container } = setup({ template: measured });
    await userEvent.type(within(container).getByLabelText('Product name'), 'x');
    await userEvent.upload(within(screen.getByRole('group', { name: 'Product 1' })).getByLabelText('Add image'), new File(['x'], 'p1.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled());
    await generate();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('Final video20 sec · 9:16 · 720p'));
  });

  it('opens at once with the price being asked, nothing can be confirmed, then shows the rows of section 5 in order', async () => {
    let answer: (value: unknown) => void = () => {};
    estimateGeneration.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const { container } = setup();
    // a complete form: the window does not wait for the answer
    const names = within(container).getAllByLabelText('Product name');
    for (const name of names) await userEvent.type(name, 'x');
    for (let i = 1; i <= 4; i += 1) await userEvent.upload(within(screen.getByRole('group', { name: `Product ${i}` })).getByLabelText('Add image'), new File(['x'], `p${i}.png`, { type: 'image/png' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled());
    await generate();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Getting the price…');
    expect(within(dialog).getByRole('button', { name: 'Confirm and generate' })).toBeDisabled();
    expect(confirmGeneration).not.toHaveBeenCalled();
    await act(async () => answer(ready()));
    await waitFor(() => expect(dialog).not.toHaveTextContent('Getting the price…'));
    const text = dialog.textContent ?? '';
    const order = ['Final video', 'Credits for this job', 'Balance now', 'After this job', 'Estimated time', 'What we generate'].map((label) => text.indexOf(label));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(dialog).toHaveTextContent('Fragrance layering recipe · Fast · 1 variant · English');
    expect(dialog).toHaveTextContent('Final video8 sec · 9:16 · 720p');
    expect(dialog).toHaveTextContent('Credits for this job2 credits');
    expect(dialog).toHaveTextContent('Balance now12 credits');
    expect(dialog).toHaveTextContent('After this job10 credits');
    expect(dialog).toHaveTextContent('Estimated timeabout 7 min');
    expect(dialog).toHaveTextContent('You are charged when you confirm. A job cannot be cancelled once it starts. If the video is not delivered, the credits come back.');
    expect(dialog).not.toHaveTextContent('Estimated credits');
    expect(confirmGeneration).not.toHaveBeenCalled();
  });

  it('What we generate opens to the raw amounts and the cut to the template length', async () => {
    estimateGeneration.mockResolvedValue(ready());
    setup();
    await generate();
    const dialog = await screen.findByRole('dialog');
    const toggle = within(dialog).getByRole('button', { name: 'What we generate' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toHaveTextContent("5 images · 5 clips (20 sec of footage) · 1 music track. The clips are cut to the template's 8 seconds.");
  });

  it('free video: 0 credits, the note, and the balance stays', async () => {
    estimateGeneration.mockResolvedValue(ready({ coveredByFreeVideo: true, credits: 0 }));
    setup({ free: true });
    await generate();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Credits for this jobFree video · 0 credits');
    expect(dialog).toHaveTextContent('This uses your one free video.');
    expect(dialog).toHaveTextContent('After this job12 credits');
  });

  it('confirm sends the idempotency key made when the dialog opened; reopening makes a new one', async () => {
    estimateGeneration.mockResolvedValue(ready());
    confirmGeneration.mockResolvedValue({ status: 'error', code: 'generic' });
    setup();
    await generate();
    const dialog = await screen.findByRole('dialog');
    const hidden = dialog.querySelector<HTMLInputElement>('input[name="key"]')!;
    expect(hidden.value).toMatch(/^[0-9a-f-]{36}$/);
    await userEvent.click(confirmButton(dialog));
    await waitFor(() => expect(confirmGeneration).toHaveBeenCalledTimes(1));
    expect(confirmGeneration.mock.calls[0]![1]).toBe(hidden.value);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); // a server answer of "generic" closes the window; the form says it
    await generate();
    const second = (await screen.findByRole('dialog')).querySelector<HTMLInputElement>('input[name="key"]')!;
    expect(second.value).not.toBe(hidden.value);
  });

  it('confirm sends the amount the dialog shows: the credits and whether the free video covers them', async () => {
    estimateGeneration.mockResolvedValue(ready({ coveredByFreeVideo: true, credits: 0 }));
    confirmGeneration.mockResolvedValue({ status: 'error', code: 'generic' });
    setup({ free: true });
    await generate();
    await userEvent.click(confirmButton(await screen.findByRole('dialog')));
    await waitFor(() => expect(confirmGeneration).toHaveBeenCalledTimes(1));
    expect(confirmGeneration.mock.calls[0]![2]).toEqual({ credits: 0, free: true });
  });

  it('K3: a job over the provider limit is refused: the window closes and the form says that nothing was charged', async () => {
    estimateGeneration.mockResolvedValue(ready({ credits: 2 }));
    confirmGeneration.mockResolvedValue({ status: 'error', code: 'provider-cap' });
    setup();
    await generate();
    await userEvent.click(confirmButton(await screen.findByRole('dialog')));
    expect(await screen.findByRole('alert')).toHaveTextContent('The provider spending limit has been reached. No credits were charged and no provider request was sent.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the free videos of the day are used up: the window closes and the form says so', async () => {
    estimateGeneration.mockResolvedValue(ready({ coveredByFreeVideo: true, credits: 0 }));
    confirmGeneration.mockResolvedValue({ status: 'error', code: 'free-video-cap' });
    setup({ free: true });
    await generate();
    await userEvent.click(confirmButton(await screen.findByRole('dialog')));
    expect(await screen.findByRole('alert')).toHaveTextContent("A free video is not available right now. You can continue with credits.");
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the price changed: the old amount is struck through, the text says what it is now, the next confirm sends it with the same key', async () => {
    estimateGeneration.mockResolvedValue(ready({ credits: 2 }));
    confirmGeneration.mockResolvedValueOnce({ ...ready({ credits: 3 }), status: 'changed' }).mockReturnValue(new Promise(() => {}));
    setup();
    await generate();
    const dialog = await screen.findByRole('dialog');
    const key = dialog.querySelector<HTMLInputElement>('input[name="key"]')!.value;
    await userEvent.click(confirmButton(dialog));
    expect(await within(dialog).findByText('Our prices were updated since you opened this. This job is now 3 credits, not 2. Check and confirm again.')).toBeInTheDocument();
    expect(dialog.querySelector('s')).toHaveTextContent('2');
    expect(dialog).toHaveTextContent('3 credits');
    await userEvent.click(confirmButton(dialog));
    await waitFor(() => expect(confirmGeneration).toHaveBeenCalledTimes(2));
    expect(confirmGeneration.mock.calls[1]![1]).toBe(key);
    expect(confirmGeneration.mock.calls[1]![2]).toEqual({ credits: 3, free: false });
  });

  it('only the balance changed (another tab): says so, no struck-through price', async () => {
    estimateGeneration.mockResolvedValue(ready({ credits: 2, balance: 12 }));
    confirmGeneration.mockResolvedValueOnce({ ...ready({ credits: 2, balance: 9 }), status: 'changed' });
    setup();
    await generate();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(confirmButton(dialog));
    expect(await within(dialog).findByText('Your balance changed in another tab. Check and confirm again.')).toBeInTheDocument();
    expect(dialog.querySelector('s')).toBeNull();
    expect(dialog).toHaveTextContent('Balance now9 credits');
  });

  it('the free video was used elsewhere: the credits row is a price now', async () => {
    estimateGeneration.mockResolvedValue(ready({ coveredByFreeVideo: true, credits: 0 }));
    confirmGeneration.mockResolvedValueOnce({ ...ready({ credits: 2, balance: 5 }), status: 'changed' });
    setup({ free: true });
    await generate();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(confirmButton(dialog));
    expect(await within(dialog).findByText(/This job is now 2 credits, not 0/)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('This uses your one free video.');
  });

  it('while the job starts: Starting…, both buttons off, the double-charge note; a double click sends one request', async () => {
    estimateGeneration.mockResolvedValue(ready());
    confirmGeneration.mockReturnValue(new Promise(() => {}));
    setup();
    await generate();
    const dialog = await screen.findByRole('dialog');
    await userEvent.dblClick(confirmButton(dialog));
    expect(confirmGeneration).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(dialog).toHaveTextContent('Starting your job. You will not be charged twice.');
  });

  it('generation is paused (at the price, or at the start): the window says so, nothing is charged, Close ends it', async () => {
    estimateGeneration.mockResolvedValue({ status: 'error', code: 'paused' });
    setup();
    await generate();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Generation is paused for a short time. Nothing was charged. Try again later.');
    expect(within(dialog).queryByRole('button', { name: 'Confirm and generate' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    estimateGeneration.mockResolvedValue(ready());
    confirmGeneration.mockResolvedValue({ status: 'error', code: 'paused' });
    await generate();
    await userEvent.click(confirmButton(await screen.findByRole('dialog')));
    expect(await screen.findByText(/Generation is paused for a short time/)).toBeInTheDocument();
  });

  describe('no answer to the start (R6)', () => {
    it('after the time limit, a job with this key is found: the customer goes to it', async () => {
      estimateGeneration.mockResolvedValue(ready());
      confirmGeneration.mockReturnValue(new Promise(() => {}));
      findStartedJob.mockResolvedValue('job-9');
      setup();
      await generate();
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await userEvent.click(confirmButton(await screen.findByRole('dialog')));
        await act(async () => { await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS + 1); });
        await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs/job-9'));
      } finally {
        vi.useRealTimers();
      }
    });
    it('a request that throws, and no job with this key: says it could not confirm, offers only Open My videos, and Generate is not offered again', async () => {
      estimateGeneration.mockResolvedValue(ready());
      confirmGeneration.mockRejectedValue(new Error('network'));
      findStartedJob.mockResolvedValue(null);
      setup();
      await generate();
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(confirmButton(dialog));
      await waitFor(() => expect(dialog).toHaveTextContent('We could not confirm that your job started. Check My videos before you try again. You are not charged twice.'));
      expect(within(dialog).getByRole('link', { name: 'Open My videos' })).toHaveAttribute('href', '/videos');
      expect(within(dialog).queryByRole('button', { name: 'Confirm and generate' })).toBeNull();
      expect(findStartedJob).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/));
    });
  });

  describe('not enough credits', () => {
    it('says what is needed and what there is, that nothing was charged and the form is saved; Balance now in the warning colour; no After row; buy link', async () => {
      estimateGeneration.mockResolvedValue(ready({ credits: 15, balance: 12, enough: false }));
      setup();
      await generate();
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('You need 15 credits and have 12 credits. Nothing was charged. Your form is saved.');
      expect(dialog).not.toHaveTextContent('After this job');
      expect(dialog).not.toHaveTextContent('Missing');
      expect(within(dialog).getByText('12 credits', { selector: 'dd' }).className).toContain('text-warn');
      expect(within(dialog).getByRole('link', { name: 'Buy credits' })).toHaveAttribute('href', '/pricing?returnTo=%2Ftemplates%2Ftpl-layering%2Fgenerate');
      expect(within(dialog).queryByRole('button', { name: 'Confirm and generate' })).not.toBeInTheDocument();
    });
    it('Buy credits keeps the form on the server first, then opens the pricing page', async () => {
      estimateGeneration.mockResolvedValue(ready({ credits: 15, balance: 12, enough: false }));
      setup();
      await userEvent.type(within(screen.getByRole('group', { name: 'Product 1' })).getByLabelText('Product name'), 'Oil');
      await generate();
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('link', { name: 'Buy credits' }));
      expect(saveFormDraft).toHaveBeenCalledTimes(1);
      expect(saveFormDraft.mock.calls[0]![0]).toMatchObject({ templateId: 'tpl-layering', products: [{ name: 'Oil' }, {}, {}, {}] });
      await waitFor(() => expect(push).toHaveBeenCalledWith('/pricing?returnTo=%2Ftemplates%2Ftpl-layering%2Fgenerate'));
    });
  });

  it('Cancel closes the dialog', async () => {
    estimateGeneration.mockResolvedValue(ready());
    setup();
    await generate();
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a new dialog after an edit gets a new idempotency key; the same dialog keeps its key', async () => {
    estimateGeneration.mockResolvedValue(ready());
    confirmGeneration.mockResolvedValue(ready({ credits: 15, balance: 12, enough: false }));
    setup();
    await generate();
    const dialog = await screen.findByRole('dialog');
    const keyOf = () => screen.getByRole('dialog').querySelector<HTMLInputElement>('input[name="key"]')!.value;
    const first = keyOf();
    await userEvent.click(confirmButton(dialog));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('You need 15 credits'));
    expect(keyOf()).toBe(first); // same dialog, same key
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await userEvent.type(within(screen.getByRole('group', { name: 'Product 1' })).getByLabelText('Product name'), 'x');
    await generate();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled());
    await screen.findByRole('dialog');
    expect(keyOf()).not.toBe(first);
  });
});

describe('GenerateForm: the photos are uploaded as they are picked', () => {
  const block = () => screen.getByRole('group', { name: 'Product 1' });
  const pick = (...files: File[]) => userEvent.upload(within(block()).getByLabelText('Add image'), files);
  const photo = (name: string, size = 1) => new File([new Uint8Array(size)], name, { type: 'image/png' });

  beforeEach(() => {
    uploadProductImage.mockClear();
    uploadProductImage.mockImplementation(async (form: FormData) => ({ status: 'saved', path: `uploads/u/${(form.get('file') as File).name}` }));
  });

  it('sends the stored path, not the file name, and says the terms before anything is picked', async () => {
    estimateGeneration.mockResolvedValue({ status: 'invalid', problems: [] });
    setup();
    expect(screen.getAllByText('JPG, PNG or WebP · up to 10 MB each · 1 to 8 images per product')).toHaveLength(1); // once for the whole form
    await pick(photo('oil.png'));
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(estimateGeneration.mock.calls[0]![0].products[0].images).toEqual(['uploads/u/oil.png']);
  });

  it('while a photo uploads, Generate waits and says why', async () => {
    let finish: (value: unknown) => void = () => {};
    uploadProductImage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    setup();
    await pick(photo('oil.png'));
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    expect(screen.getByText('Wait for the uploads to finish.')).toBeInTheDocument();
    expect(within(block()).getByText('Uploading…')).toBeInTheDocument();
    finish({ status: 'saved', path: 'uploads/u/oil.png' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled());
  });

  it('a refused photo leaves the block with a line that names it; the other fields stay', async () => {
    uploadProductImage.mockResolvedValueOnce({ status: 'refused', code: 'type' } as never);
    setup();
    await userEvent.type(within(block()).getByLabelText('Product name'), 'Body Oil');
    await pick(photo('scan.png'));
    expect(await within(block()).findByText('scan.png is not supported. Use JPG, PNG or WebP.')).toBeInTheDocument();
    expect(within(block()).queryByAltText('Uploaded product image')).toBeNull();
    expect(within(block()).getByLabelText('Product name')).toHaveValue('Body Oil');
    await userEvent.click(within(block()).getByRole('button', { name: 'Dismiss' }));
    expect(within(block()).queryByText(/is not supported/)).toBeNull();
  });

  it('a photo over 10 MB is refused before it is sent; a ninth photo is not taken', async () => {
    setup();
    await pick(photo('big.png', 10 * 1024 * 1024 + 1));
    expect(within(block()).getByText('big.png is larger than 10 MB.')).toBeInTheDocument();
    expect(uploadProductImage).not.toHaveBeenCalled();
    await pick(...Array.from({ length: 9 }, (_, n) => photo(`p${n}.png`)));
    expect(uploadProductImage).toHaveBeenCalledTimes(8);
    expect(within(block()).getByText('You can add up to 8 images per product.')).toBeInTheDocument();
  });

  it('replacing a photo with a file the server refuses keeps the old photo and names the refused file', async () => {
    setup();
    await pick(photo('one.png'));
    await within(block()).findByRole('button', { name: /Remove image one\.png/ });
    uploadProductImage.mockResolvedValueOnce({ status: 'refused', code: 'type' } as never);
    await userEvent.upload(within(block()).getByLabelText(/^Replace/), photo('scan.png'));
    expect(await within(block()).findByText('scan.png is not supported. Use JPG, PNG or WebP.')).toBeInTheDocument();
    expect(within(block()).getByRole('button', { name: /Remove image one\.png/ })).toBeInTheDocument();
    expect(within(block()).queryByRole('button', { name: /Remove image scan\.png/ })).toBeNull();
  });

  it('replacing a photo with a good file leaves only the new one', async () => {
    setup();
    await pick(photo('one.png'), photo('side.png'));
    await within(block()).findByRole('button', { name: /Remove image side\.png/ });
    await userEvent.upload(within(block()).getAllByLabelText(/^Replace/)[0]!, photo('two.png'));
    await within(block()).findByRole('button', { name: /Remove image two\.png/ });
    expect(within(block()).queryByRole('button', { name: /Remove image one\.png/ })).toBeNull();
    expect(within(block()).getAllByRole('button', { name: /^Remove image/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Remove image two.png', 'Remove image side.png']);
  });

  it('removing a replacement that did not upload puts the old photo back in its place', async () => {
    setup();
    await pick(photo('one.png'), photo('side.png'));
    await within(block()).findByRole('button', { name: /Remove image side\.png/ });
    uploadProductImage.mockRejectedValueOnce(new Error('fetch failed'));
    await userEvent.upload(within(block()).getAllByLabelText(/^Replace/)[0]!, photo('two.png'));
    await within(block()).findByRole('button', { name: 'Try again' });
    await userEvent.click(within(block()).getByRole('button', { name: /Remove image two\.png/ }));
    expect(within(block()).getAllByRole('button', { name: /^Remove image/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Remove image one.png', 'Remove image side.png']);
  });

  it('a saved photo removes that product\'s image problem from the strip', async () => {
    estimateGeneration.mockResolvedValue({
      status: 'invalid',
      problems: [
        { product: 0, field: 'images' },
        { product: 1, field: 'images' },
      ],
    });
    setup();
    await generate();
    expect(await screen.findByRole('alert')).toHaveTextContent('Two things to fix before generating. Product 1 needs an image. Product 2 needs an image.');
    await pick(photo('oil.png'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('One thing to fix before generating. Product 2 needs an image.'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Product 1');
  });

  describe('a picture that cannot be drawn, and a file of another type', () => {
    const NOTE = (name: string) => `${name} could not be read as a picture. Use a JPG, PNG or WebP photo.`;
    const thumb = () => within(block()).getByAltText('Uploaded product image');

    it('a picked file whose picture cannot be drawn leaves the block with a line that names it, and Generate does not send its path', async () => {
      estimateGeneration.mockResolvedValue({ status: 'invalid', problems: [] });
      setup();
      await pick(photo('fake.png'));
      await within(block()).findByRole('button', { name: /Remove image fake\.png/ });
      fireEvent.error(thumb());
      expect(within(block()).getByText(NOTE('fake.png'))).toBeInTheDocument();
      expect(within(block()).queryByAltText('Uploaded product image')).toBeNull();
      await generate();
      expect(estimateGeneration.mock.calls[0]![0].products[0].images).toEqual([]);
    });

    it('the line is not told twice when the server refuses the same file after the picture failed', async () => {
      let answer: (value: unknown) => void = () => {};
      uploadProductImage.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }) as never);
      setup();
      await pick(photo('fake.png'));
      fireEvent.error(thumb());
      answer({ status: 'refused', code: 'unreadable' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled());
      expect(within(block()).getAllByText(NOTE('fake.png'))).toHaveLength(1);
    });

    it('a broken replacement gives the old photo back', async () => {
      setup();
      await pick(photo('one.png'));
      await within(block()).findByRole('button', { name: /Remove image one\.png/ });
      uploadProductImage.mockImplementationOnce(() => new Promise(() => {}) as never);   // the server has not answered yet: the old photo is still set aside
      await userEvent.upload(within(block()).getByLabelText(/^Replace/), photo('two.png'));
      await within(block()).findByRole('button', { name: /Remove image two\.png/ });
      fireEvent.error(thumb());
      expect(within(block()).getByText(NOTE('two.png'))).toBeInTheDocument();
      expect(within(block()).getByRole('button', { name: /Remove image one\.png/ })).toBeInTheDocument();
      expect(within(block()).queryByRole('button', { name: /Remove image two\.png/ })).toBeNull();
    });

    it('a photo that came back from a draft is never dropped for a failed thumbnail', () => {
      const draft: GenerateInput = {
        templateId: template.id, quality: 'fast', variants: 1, language: 'en',
        products: [{ name: 'Oil', description: '', images: ['uploads/abc/1.png'] }, ...Array.from({ length: 3 }, () => ({ name: '', description: '', images: [] as string[] }))],
      };
      setup({ draft });
      fireEvent.error(thumb());
      expect(thumb()).toBeInTheDocument();
      expect(within(block()).queryByRole('alert')).toBeNull();
    });

    it('a HEIC or a file with no type is refused before it is sent, with the line that names it and the three formats', async () => {
      setup();
      const drop = within(block()).getByText('Drop images here or choose files').closest('label')!;
      await act(async () => {
        fireEvent.drop(drop, { dataTransfer: { files: [new File(['x'], 'IMG_1.heic', { type: 'image/heic' }), new File(['x'], 'scan', { type: '' })] } });
      });
      expect(within(block()).getByText('IMG_1.heic is not supported. Use JPG, PNG or WebP.')).toBeInTheDocument();
      expect(within(block()).getByText('scan is not supported. Use JPG, PNG or WebP.')).toBeInTheDocument();
      expect(uploadProductImage).not.toHaveBeenCalled();
      expect(within(block()).queryByAltText('Uploaded product image')).toBeNull();
    });
  });

  it('an upload that fails (connection) offers Try again, which sends it once more', async () => {
    uploadProductImage.mockRejectedValueOnce(new Error('fetch failed'));
    setup();
    await pick(photo('oil.png'));
    await userEvent.click(await within(block()).findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(uploadProductImage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(block()).queryByRole('button', { name: 'Try again' })).toBeNull());
  });
});

describe('GenerateForm: the form is kept in the tab', () => {
  const STORED = 'uploads/0b9e6a52-6a1c-4c53-9d0e-3f5b8a1c2d4e/1.png';
  const block = (n = 1) => screen.getByRole('group', { name: `Product ${n}` });
  const kept = { name: 'Browser oil', description: 'from the tab', images: [STORED] };
  const empty = { name: '', description: '', images: [] as string[] };
  const keptForm = (over: Record<string, unknown> = {}) => ({ products: [kept, empty, empty, empty], quality: 'best', variants: 2, language: 'tr', ...over });

  beforeEach(() => {
    uploadProductImage.mockImplementation(async (form: FormData) => ({ status: 'saved', path: STORED }));
  });

  it('what the customer typed, the choices and the stored photos come back when the form is mounted again', async () => {
    const first = setup();
    await userEvent.type(within(block()).getByLabelText('Product name'), 'Body Oil');
    await userEvent.type(within(block()).getByLabelText(/^Short description/), 'smooth');
    await userEvent.upload(within(block()).getByLabelText('Add image'), new File(['x'], 'oil.png', { type: 'image/png' }));
    await within(block()).findByRole('button', { name: /Remove image oil\.png/ });
    await userEvent.click(screen.getByRole('button', { name: /Best/ }));
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await userEvent.selectOptions(screen.getByLabelText(/Video language/), 'tr');
    first.unmount();

    setup();
    await waitFor(() => expect(within(block()).getByLabelText('Product name')).toHaveValue('Body Oil'));
    expect(within(block()).getByLabelText(/^Short description/)).toHaveValue('smooth');
    expect(within(block()).getByAltText('Uploaded product image')).toHaveAttribute('src', `/media/${STORED}`);
    expect(screen.getByRole('button', { name: /Best/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/Video language/)).toHaveValue('tr');
  });

  it('an empty form writes nothing, and a form that is emptied again drops what was kept', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Best/ }));   // a choice alone is not an entry
    expect(window.sessionStorage.length).toBe(0);
    const name = within(block()).getByLabelText('Product name');
    await userEvent.type(name, 'Oil');
    expect(readDraft(DRAFT_KEY)).not.toBeNull();
    await userEvent.clear(name);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('the kept form is dropped when the job is asked to start, and written again when the start is refused', async () => {
    estimateGeneration.mockResolvedValue(ready());
    let answer: (value: unknown) => void = () => {};
    confirmGeneration.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    setup();
    await userEvent.type(within(block()).getByLabelText('Product name'), 'Oil');
    expect(readDraft(DRAFT_KEY)).not.toBeNull();
    await generate();
    await userEvent.click(confirmButton(await screen.findByRole('dialog')));
    await waitFor(() => expect(confirmGeneration).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.length).toBe(0);
    answer({ status: 'error', code: 'generic' });
    await waitFor(() => expect(readDraft<{ products: { name: string }[] }>(DRAFT_KEY)?.products[0]?.name).toBe('Oil'));
  });

  it('a draft from the server wins over the browser\'s', async () => {
    writeDraft(DRAFT_KEY, keptForm());
    const draft: GenerateInput = { templateId: template.id, quality: 'fast', variants: 1, language: 'en', products: [{ name: 'Server oil', description: '', images: [] }, ...Array.from({ length: 3 }, () => ({ ...empty }))] };
    setup({ draft });
    await waitFor(() => expect(within(block()).getByLabelText('Product name')).toHaveValue('Server oil'));
    expect(screen.getByRole('button', { name: /Best/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText(/Video language/)).toHaveValue('en');
  });

  it.each([
    ['not JSON', '{nope'],
    ['a quality that does not exist', JSON.stringify(keptForm({ quality: 'ultra' }))],
    ['products that are not a list', JSON.stringify(keptForm({ products: 'x' }))],
    ['a name longer than the box', JSON.stringify(keptForm({ products: [{ ...kept, name: 'x'.repeat(121) }] }))],
    ['a language the site does not have', JSON.stringify(keptForm({ language: 'de' }))],
  ])('a kept form of another shape is ignored: %s', async (_label, text) => {
    window.sessionStorage.setItem(DRAFT_KEY, text);
    setup();
    await userEvent.click(screen.getByRole('button', { name: '2' }));   // the form is alive and empty
    expect(within(block()).getByLabelText('Product name')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Fast/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/Video language/)).toHaveValue('en');
  });

  it('keeps only the products the template has and the photos of the media folder', async () => {
    const extra = { name: 'Fifth', description: '', images: [] as string[] };
    writeDraft(DRAFT_KEY, keptForm({ products: [{ ...kept, images: ['oil.jpg', 'uploads/../x', STORED] }, empty, empty, empty, extra] }));
    setup();
    await waitFor(() => expect(within(block()).getByLabelText('Product name')).toHaveValue('Browser oil'));
    expect(screen.getAllByRole('group', { name: /^Product \d$/ })).toHaveLength(4);
    expect(within(block()).getAllByAltText('Uploaded product image')).toHaveLength(1);
  });
});
