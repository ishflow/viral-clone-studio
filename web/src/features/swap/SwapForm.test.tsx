import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Estimate } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), unstable_rethrow: () => {} }));
const actions = vi.hoisted(() => ({ estimateSwap: vi.fn(), confirmSwap: vi.fn(), findStartedSwap: vi.fn(), uploadPersonPhoto: vi.fn() }));
vi.mock('./actions', () => actions);
const measure = vi.hoisted(() => ({ measurePicture: vi.fn() }));
vi.mock('./measure', () => measure);

import { SwapForm } from './SwapForm';
import { SwapGallery } from './SwapGallery';

const estimate = (over: Partial<Estimate> = {}): Estimate => ({ images: 0, clips: 2, clipSeconds: 12, musicTracks: 0, minutes: 4, credits: 3, coveredByFreeVideo: false, balance: 19, enough: true, ...over });
const template = { id: 'tpl-swap', title: 'Walk to the camera', image: '/samples/a.jpg', video: null, seconds: 12, people: 1, persons: [{ slot: 1, box: { left: 30, top: 12, right: 70, bottom: 96 } }] };
const show = (over: Partial<Parameters<typeof SwapForm>[0]> = {}, locale: 'en' | 'tr' = 'en') =>
  renderWithI18n(<SwapForm template={template} estimate={estimate()} paused={false} consentVersion="v1" reviewed {...over} />, locale);
const photo = (name = 'me.jpg', type = 'image/jpeg') => new File(['x'], name, { type });
const start = () => screen.getByRole('button', { name: 'Start' });
const boxes = () => screen.getAllByRole('checkbox');
const addBody = async (file = photo()) => userEvent.upload(screen.getByLabelText('Add full-body photo'), file, { applyAccept: false });
const addSide = async (file = photo('side.jpg')) => userEvent.upload(screen.getByLabelText('Add side photo'), file, { applyAccept: false });
/** The form as a customer leaves it when everything is in order: the photo stored, the three boxes ticked. */
async function fill() {
  await addBody();
  await screen.findByAltText('Your full-body photo');
  for (const box of boxes()) await userEvent.click(box);
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} }));
  measure.measurePicture.mockResolvedValue({ width: 600, height: 900 });
  actions.uploadPersonPhoto.mockResolvedValue({ status: 'saved', path: 'uploads/me.jpg' });
  actions.estimateSwap.mockResolvedValue({ status: 'ready', estimate: estimate() });
  actions.confirmSwap.mockResolvedValue({ status: 'error', code: 'generic' });
  actions.findStartedSwap.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the list of person-swap videos', () => {
  it('shows each video with its length, its people and the price it was given', () => {
    renderWithI18n(<SwapGallery cards={[{ ...template, credits: 3, uses: 0 }, { ...template, id: 'two', title: 'Two friends', people: 2, credits: null, uses: 0 }]} />);
    const [first, second] = screen.getAllByRole('article');
    expect(within(first!).getByRole('link', { name: 'Walk to the camera' })).toHaveAttribute('href', '/swap/tpl-swap');
    expect(first).toHaveTextContent('1 person');
    expect(first).toHaveTextContent('12 sec');
    expect(first).toHaveTextContent('3 credits');
    expect(second).toHaveTextContent('2 people');
    expect(second).toHaveTextContent('Price is shown on the next page');
  });
});

describe('the person-swap form', () => {
  it('keeps Start off until the photo is stored and every one of the three boxes is ticked', async () => {
    show();
    expect(boxes()).toHaveLength(3);
    expect(start()).toBeDisabled();
    await addBody();
    await screen.findByAltText('Your full-body photo');
    expect(start()).toBeDisabled();
    await userEvent.click(boxes()[0]!);
    await userEvent.click(boxes()[1]!);
    expect(start()).toBeDisabled();
    expect(screen.getByText('Tick all three boxes to start.')).toBeInTheDocument();
    await userEvent.click(boxes()[2]!);
    expect(start()).toBeEnabled();
    await userEvent.click(boxes()[1]!);
    expect(start()).toBeDisabled();
  });

  it('keeps Start off with the three boxes ticked while there is no full-body photo', async () => {
    show();
    for (const box of boxes()) await userEvent.click(box);
    expect(start()).toBeDisabled();
    expect(screen.getByText('Add a full-body photo to start.')).toBeInTheDocument();
  });

  it('says what is kept and for how long, and that the video is labelled, in both languages', () => {
    show();
    const kept = screen.getByText(/What we keep and for how long/);
    expect(kept).toHaveTextContent('at the latest 24 hours later');
    expect(kept).toHaveTextContent('kept for 30 days');
    expect(kept).toHaveTextContent('"AI-generated" label');
    cleanup();
    show({}, 'tr');
    const saklanan = screen.getByText(/Neyi ne kadar saklıyoruz/);
    expect(saklanan).toHaveTextContent('en geç 24 saat sonra silinir');
    expect(saklanan).toHaveTextContent('30 gün saklanır');
  });

  it('names the look at the photo only while the admin looks at every photo', () => {
    show();
    expect(screen.getByText(/A person may look at your photo before the video is made/)).toBeInTheDocument();
    cleanup();
    show({ reviewed: false });
    expect(screen.queryByText(/A person may look at your photo/)).toBeNull();
    expect(screen.getByText(/What we keep and for how long/)).toBeInTheDocument();
  });

  it('shows the price it was given, never one of its own', () => {
    show({ estimate: estimate({ credits: 7 }) });
    expect(screen.getByText(/7 credits · 12 sec/)).toBeInTheDocument();
  });

  it('refuses a full-body photo that lies on its side under its box, and sends nothing', async () => {
    measure.measurePicture.mockResolvedValue({ width: 900, height: 600 });
    show();
    await addBody(photo('wide.jpg'));
    expect(await screen.findByRole('alert')).toHaveTextContent('wide.jpg was not added: a full-body photo must be upright');
    expect(actions.uploadPersonPhoto).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Your full-body photo')).toBeNull();
  });

  it.each([
    ['a file that is not a picture', photo('notes.pdf', 'application/pdf'), { width: 600, height: 900 }, 'notes.pdf was not added: only JPG, PNG or WebP.'],
    ['a picture that is too small', photo('tiny.jpg'), { width: 300, height: 900 }, 'tiny.jpg was not added: its short side is under 340 px.'],
    ['a file the browser cannot read', photo('broken.jpg'), null, 'broken.jpg was not added: the file could not be read as a picture.'],
  ])('refuses %s with its reason', async (_, file, size, text) => {
    measure.measurePicture.mockResolvedValue(size);
    show();
    await addBody(file);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(actions.uploadPersonPhoto).not.toHaveBeenCalled();
  });

  it.each([
    ['a HEIC photo, as an iPhone stores it', photo('IMG_0001.HEIC', 'image/heic')],
    ['a file whose type the browser does not know', photo('IMG_0002.heic', '')],
  ])('refuses %s under its box with its name and the three formats it takes, and sends nothing', async (_, file) => {
    show();
    await addBody(file);
    expect(await screen.findByRole('alert')).toHaveTextContent(`${file.name} was not added: only JPG, PNG or WebP.`);
    expect(measure.measurePicture).not.toHaveBeenCalled();
    expect(actions.uploadPersonPhoto).not.toHaveBeenCalled();
  });

  it('says why the server did not keep a photo', async () => {
    actions.uploadPersonPhoto.mockResolvedValue({ status: 'refused', code: 'quota' });
    show();
    await addBody();
    expect(await screen.findByRole('alert')).toHaveTextContent("me.jpg was not added: you have reached today's number of uploads.");
  });

  it('asks for the price when Start is pressed and shows credits, balance and time before anything is charged', async () => {
    actions.estimateSwap.mockResolvedValue({ status: 'ready', estimate: estimate({ credits: 5, balance: 19, minutes: 6 }) });
    show();
    await fill();
    await userEvent.click(start());
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('5 credits');
    expect(dialog).toHaveTextContent('19 credits');
    expect(dialog).toHaveTextContent('14 credits');
    expect(dialog).toHaveTextContent('about 6 min');
    expect(actions.confirmSwap).not.toHaveBeenCalled();
  });

  it('starts with the stored photos, the three boxes, the text version and the price the window showed', async () => {
    actions.uploadPersonPhoto.mockResolvedValueOnce({ status: 'saved', path: 'uploads/body.jpg' }).mockResolvedValueOnce({ status: 'saved', path: 'uploads/face.jpg' });
    show();
    await fill();
    await userEvent.upload(screen.getByLabelText('Add face photo'), photo('face.jpg'), { applyAccept: false });
    await screen.findByAltText('Your face photo');
    await userEvent.click(start());
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Confirm and start' }));
    await waitFor(() => expect(actions.confirmSwap).toHaveBeenCalledTimes(1));
    const [form, key, shown] = actions.confirmSwap.mock.calls[0]!;
    expect(form).toEqual({
      templateId: 'tpl-swap', people: [{ slot: 1, body: 'uploads/body.jpg', face: 'uploads/face.jpg' }], outfit: 'keep',
      consent: { ownPerson: true, adults: true, notCelebrity: true, version: 'v1' },
    });
    expect(key).toEqual(expect.any(String));
    expect(shown).toEqual({ credits: 3 });
  });

  it('takes a third photo, from the side, that may be left out: Start does not wait for it, and once stored it is sent with the others', async () => {
    actions.uploadPersonPhoto.mockResolvedValueOnce({ status: 'saved', path: 'uploads/body.jpg' }).mockResolvedValueOnce({ status: 'saved', path: 'uploads/side.jpg' });
    show();
    expect(screen.getByText('Optional. Taken from the side, for the moments the person turns.')).toBeInTheDocument();
    await fill();
    expect(start()).toBeEnabled();
    await addSide();
    await screen.findByAltText('Your side photo');
    await userEvent.click(start());
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Confirm and start' }));
    await waitFor(() => expect(actions.confirmSwap).toHaveBeenCalledTimes(1));
    expect(actions.confirmSwap.mock.calls[0]![0]).toMatchObject({ people: [{ slot: 1, body: 'uploads/body.jpg', face: null, side: 'uploads/side.jpg' }] });
    expect(actions.confirmSwap.mock.calls[0]![2]).toEqual({ credits: 3 });
  });

  it('sends no side photo once it was removed again', async () => {
    show();
    await fill();
    await addSide();
    await screen.findByAltText('Your side photo');
    await userEvent.click(screen.getByRole('button', { name: /^Remove\s*side\.jpg$/ }));
    expect(screen.getByLabelText('Add side photo')).toBeInTheDocument();
    await userEvent.click(start());
    await waitFor(() => expect(actions.estimateSwap).toHaveBeenCalledTimes(1));
    expect(actions.estimateSwap.mock.calls[0]![0].people).toEqual([{ slot: 1, body: 'uploads/me.jpg', face: null }]);
  });

  it('checks the side photo before it is sent like the face photo: too small is refused under its box, lying on its side is taken', async () => {
    measure.measurePicture.mockResolvedValue({ width: 300, height: 900 });
    show();
    await addSide(photo('tiny.jpg'));
    expect(await screen.findByRole('alert')).toHaveTextContent('tiny.jpg was not added: its short side is under 340 px.');
    expect(actions.uploadPersonPhoto).not.toHaveBeenCalled();
    measure.measurePicture.mockResolvedValue({ width: 900, height: 600 });
    await addSide(photo('wide.jpg'));
    expect(await screen.findByAltText('Your side photo')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(actions.uploadPersonPhoto).toHaveBeenCalledTimes(1);
  });

  it('keeps Start off while the side photo is still on its way to the server', async () => {
    show();
    await fill();
    let stored!: (outcome: { status: 'saved'; path: string }) => void;
    actions.uploadPersonPhoto.mockReturnValueOnce(new Promise((resolve) => { stored = resolve; }));
    await addSide();
    await screen.findByAltText('Your side photo');
    expect(start()).toBeDisabled();
    stored({ status: 'saved', path: 'uploads/side.jpg' });
    await waitFor(() => expect(start()).toBeEnabled());
  });

  it('puts the third box in Turkish', () => {
    show({}, 'tr');
    expect(screen.getByText('Yandan fotoğraf')).toBeInTheDocument();
    expect(screen.getByText('İsteğe bağlı. Yandan çekilmiş; kişinin döndüğü anlar için.')).toBeInTheDocument();
    expect(screen.getByLabelText('Yandan fotoğraf ekle')).toBeInTheDocument();
  });

  it('asks what the person wears, the clothes of the video on to begin with, and sends the one that is on', async () => {
    show();
    const group = screen.getByRole('radiogroup', { name: 'Clothes' });
    expect(within(group).getByRole('radio', { name: 'Keep the clothes from the video' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Use the clothes from my photo' })).not.toBeChecked();
    await fill();
    await userEvent.click(within(group).getByRole('radio', { name: 'Use the clothes from my photo' }));
    expect(within(group).getByRole('radio', { name: 'Keep the clothes from the video' })).not.toBeChecked();
    await userEvent.click(start());
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Confirm and start' }));
    await waitFor(() => expect(actions.confirmSwap).toHaveBeenCalledTimes(1));
    expect(actions.confirmSwap.mock.calls[0]![0]).toMatchObject({ outfit: 'photo' });
  });

  it('sends the clothes it was changed to when the window was closed and Start is pressed again', async () => {
    show();
    await fill();
    await userEvent.click(start());
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Use the clothes from my photo' }));
    await userEvent.click(start());
    await waitFor(() => expect(actions.estimateSwap).toHaveBeenCalledTimes(2));
    expect(actions.estimateSwap.mock.calls[0]![0]).toMatchObject({ outfit: 'keep' });
    expect(actions.estimateSwap.mock.calls[1]![0]).toMatchObject({ outfit: 'photo' });
  });

  it('puts the question about the clothes in Turkish', () => {
    show({}, 'tr');
    const group = screen.getByRole('radiogroup', { name: 'Kıyafet' });
    expect(within(group).getByRole('radio', { name: 'Videodaki kıyafet kalsın' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Fotoğraftaki kıyafet olsun' })).toBeInTheDocument();
  });

  it('offers credits instead of a start when the balance does not reach the price', async () => {
    actions.estimateSwap.mockResolvedValue({ status: 'ready', estimate: estimate({ credits: 3, balance: 1, enough: false }) });
    show();
    await fill();
    await userEvent.click(start());
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('link', { name: 'Buy credits' })).toHaveAttribute('href', '/pricing?returnTo=%2Fswap%2Ftpl-swap');
    expect(within(dialog).queryByRole('button', { name: 'Confirm and start' })).toBeNull();
    expect(dialog).toHaveTextContent('You need 3 credits, and you have 1 credit.');
  });

  it('keeps the window and says so when the price changed, and starts only for the new price', async () => {
    actions.confirmSwap.mockResolvedValueOnce({ status: 'changed', estimate: estimate({ credits: 4 }) });
    show();
    await fill();
    await userEvent.click(start());
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Confirm and start' }));
    expect(await screen.findByText(/The price changed while this window was open: it is now 4 credits \(was 3\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and start' }));
    await waitFor(() => expect(actions.confirmSwap).toHaveBeenCalledTimes(2));
    expect(actions.confirmSwap.mock.calls[1]![2]).toEqual({ credits: 4 });
    expect(actions.confirmSwap.mock.calls[1]![1]).toBe(actions.confirmSwap.mock.calls[0]![1]);
  });

  it('goes to the job when the answer to the start was lost but the job was made', async () => {
    actions.confirmSwap.mockRejectedValue(new Error('network'));
    actions.findStartedSwap.mockResolvedValue('job-9');
    show();
    await fill();
    await userEvent.click(start());
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Confirm and start' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs/job-9'));
  });

  it('closes the window and says why when the start is refused', async () => {
    actions.confirmSwap.mockResolvedValue({ status: 'error', code: 'people' });
    show();
    await fill();
    await userEvent.click(start());
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Confirm and start' }));
    expect(await screen.findByText('The full-body photo is missing or can no longer be used. Add it again.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a photo the server did not take: says why and what to do, and the photos leave the form (the refused one is deleted there)', async () => {
    actions.confirmSwap.mockResolvedValue({ status: 'error', code: 'photo' });
    show();
    await fill();
    await addSide();
    await screen.findByAltText('Your side photo');
    await userEvent.click(start());
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Confirm and start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A photo could not be used: it is too small (short side under 340 px), a full-body photo is not upright, or the file cannot be read as a picture. Nothing was charged. Add your photos again and start.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByAltText('Your full-body photo')).toBeNull();
    expect(screen.queryByAltText('Your side photo')).toBeNull();
    expect(screen.getByLabelText('Add full-body photo')).toBeInTheDocument();
    expect(screen.getByLabelText('Add side photo')).toBeInTheDocument();
    expect(start()).toBeDisabled();
  });

  it('a photo the server did not take, in Turkish', async () => {
    actions.confirmSwap.mockResolvedValue({ status: 'error', code: 'photo' });
    show({}, 'tr');
    await userEvent.upload(screen.getByLabelText('Tam boy fotoğraf ekle'), photo(), { applyAccept: false });
    await screen.findByAltText('Tam boy fotoğrafın');
    for (const box of boxes()) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Başlat' }));
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Onayla ve başlat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Bir fotoğraf kullanılamadı: çok küçük (kısa kenarı 340 px'in altında), tam boy fotoğraf dik değil ya da dosya resim olarak okunamıyor. Hiçbir şey kesilmedi. Fotoğraflarını yeniden ekleyip başlat.");
  });

  it('says that generation is paused and keeps Start off', async () => {
    show({ estimate: null, paused: true });
    await fill();
    expect(screen.getByText(/Generation is paused for a short time. You can fill in the form/)).toBeInTheDocument();
    expect(start()).toBeDisabled();
  });

  it('draws the numbered place of the person on the picture of the video', () => {
    show();
    expect(within(screen.getByRole('complementary')).getByText('Person 1').closest('[data-box]')).toHaveStyle({ left: '30%', top: '12%', width: '40%', height: '84%' });
  });
});
