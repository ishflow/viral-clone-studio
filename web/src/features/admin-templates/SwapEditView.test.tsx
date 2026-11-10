import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwapSlot, Template } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

const saveSwapPeople = vi.fn();
const publishSwapVideo = vi.fn();
const withdrawSwapVideo = vi.fn();
vi.mock('./swap-actions', () => ({
  saveSwapPeople: (...a: unknown[]) => saveSwapPeople(...a),
  publishSwapVideo: (...a: unknown[]) => publishSwapVideo(...a),
  withdrawSwapVideo: (...a: unknown[]) => withdrawSwapVideo(...a),
}));

import { SwapEditView } from './SwapEditView';

const WOMAN: SwapSlot = { slot: 1, box: { left: 30, top: 12, right: 70, bottom: 96 }, hint: 'the woman in the white shirt' };
const template = (over: Partial<Template> = {}): Template => ({
  id: 'sw-1', title: 'Walk to the camera', category: 'Person swap', format: 'no-talking', seconds: 12, referenceViews: '', image: '/samples/x.jpg', video: null,
  products: 0, shots: [], status: 'waiting', ownerId: null, timesGenerated: 0, editedAt: '2026-10-01T10:00:00Z', source: 'link', description: '', tags: [],
  preparation: null, preparationNote: null, sample: 'none',
  swap: { people: 1, persons: [WOMAN], parts: [{ n: 1, from: 0, to: 6 }, { n: 2, from: 6, to: 12 }], sound: true }, ...over,
});
const sentPersons = (call = 0) => JSON.parse((saveSwapPeople.mock.calls[call]![1] as FormData).get('persons') as string) as SwapSlot[];
const person = (n: number) => screen.getByRole('group', { name: `Person ${n}` });

afterEach(cleanup);
beforeEach(() => {
  saveSwapPeople.mockReset();
  saveSwapPeople.mockResolvedValue({ status: 'saved', pending: false });
  publishSwapVideo.mockReset();
  withdrawSwapVideo.mockReset();
  publishSwapVideo.mockResolvedValue({ status: 'done' });
  withdrawSwapVideo.mockResolvedValue({ status: 'done' });
});

describe('SwapEditView: the page of a person-swap video', () => {
  it('names the video, says it is a person-swap video and where it stands, and leads back to the list', () => {
    renderWithI18n(<SwapEditView template={template()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Walk to the camera' })).toBeInTheDocument();
    expect(screen.getByText('Person swap')).toBeInTheDocument();
    expect(screen.getByText('Waiting to publish')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/admin/templates');
  });

  it('shows the picture of the video with the box of each person on it, and the box and words of each in fields', () => {
    renderWithI18n(<SwapEditView template={template()} />);
    const box = screen.getByTestId('box-1');
    expect(box).toHaveStyle({ left: '30%', top: '12%', width: '40%', height: '84%' });
    const first = within(person(1));
    expect(first.getByLabelText('Left')).toHaveValue(30);
    expect(first.getByLabelText('Top')).toHaveValue(12);
    expect(first.getByLabelText('Right')).toHaveValue(70);
    expect(first.getByLabelText('Bottom')).toHaveValue(96);
    expect(first.getByLabelText('Words the model finds this person by')).toHaveValue('the woman in the white shirt');
    expect(screen.queryByRole('group', { name: 'Person 2' })).toBeNull();
  });

  it('a box that is moved in its fields moves on the picture', async () => {
    renderWithI18n(<SwapEditView template={template()} />);
    const left = within(person(1)).getByLabelText('Left');
    await userEvent.clear(left);
    await userEvent.type(left, '10');
    expect(screen.getByTestId('box-1')).toHaveStyle({ left: '10%', width: '60%' });
  });

  it('saves what the fields hold, as numbers, one entry for each person in order, and says it is saved', async () => {
    renderWithI18n(<SwapEditView template={template()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a second person' }));
    const second = within(person(2));
    await userEvent.type(second.getByLabelText('Words the model finds this person by'), 'the man on the right');
    await userEvent.click(screen.getByRole('button', { name: 'Save people' }));
    await waitFor(() => expect(saveSwapPeople).toHaveBeenCalledTimes(1));
    const [first, other] = sentPersons();
    expect(first).toEqual(WOMAN);
    expect(other).toMatchObject({ slot: 2, hint: 'the man on the right' });
    expect(typeof other!.box.left).toBe('number');
    expect((saveSwapPeople.mock.calls[0]![1] as FormData).get('id')).toBe('sw-1');
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('a second person can be taken away again', async () => {
    renderWithI18n(<SwapEditView template={template({ swap: { people: 2, persons: [WOMAN, { ...WOMAN, slot: 2 }], parts: [], sound: true } })} />);
    expect(person(2)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove person 2' }));
    expect(screen.queryByRole('group', { name: 'Person 2' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a second person' })).toBeInTheDocument();
  });

  it('says that the worker is still writing them when the data layer says so, and what it says is the one of the data layer', async () => {
    saveSwapPeople.mockResolvedValue({ status: 'saved', pending: true });
    renderWithI18n(<SwapEditView template={template()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save people' }));
    expect(await screen.findByText(/The worker is writing the people into the video/)).toBeInTheDocument();
  });

  it.each([
    ['people', 'A video has one or two people.'],
    ['slot', 'The people must be numbered 1, then 2.'],
    ['box', 'Each box must lie inside the picture (0 to 100), with left before right and top above bottom.'],
    ['hint', 'Write the words in one line, up to 200 characters.'],
    ['notReady', 'The video is still being prepared. Set its people when it is ready.'],
    ['gone', 'This video is not there any more.'],
    ['failed', 'The people were not saved. Try again.'],
  ])('says `%s` in its own words, and does not say saved', async (error, text) => {
    saveSwapPeople.mockResolvedValue({ status: 'error', error });
    renderWithI18n(<SwapEditView template={template()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save people' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('a field left empty goes to the action as no number, never as 0', async () => {
    renderWithI18n(<SwapEditView template={template()} />);
    await userEvent.clear(within(person(1)).getByLabelText('Top'));
    await userEvent.click(screen.getByRole('button', { name: 'Save people' }));
    await waitFor(() => expect(saveSwapPeople).toHaveBeenCalled());
    expect(sentPersons()[0]!.box.top).toBeNull();
  });
});

describe('SwapEditView: a video the preparation suggested no people for', () => {
  const unset = () => template({ swapPeople: 'unset', swap: { people: 1, persons: [{ slot: 1, box: { left: 0, top: 0, right: 100, bottom: 100 }, hint: 'the person in the video' }], parts: [], sound: true } });

  it('says there is no suggestion, and leaves the words empty (the placeholder of the preparation is not a suggestion)', () => {
    renderWithI18n(<SwapEditView template={unset()} />);
    expect(screen.getByText(/The preparation found no one to suggest/)).toBeInTheDocument();
    expect(within(person(1)).getByLabelText('Words the model finds this person by')).toHaveValue('');
  });

  it('a suggestion that is there is shown as the values, with no such line', () => {
    renderWithI18n(<SwapEditView template={template()} />);
    expect(screen.queryByText(/The preparation found no one to suggest/)).toBeNull();
  });
});

describe('SwapEditView: a video the worker has not written the people of yet', () => {
  it('says so on the page, with what is on the page being the people before', () => {
    renderWithI18n(<SwapEditView template={template({ swapPeople: 'pending' })} />);
    expect(screen.getByText(/The worker is writing the people into the video/)).toBeInTheDocument();
  });
});

describe('SwapEditView: a video that has no people to set yet', () => {
  it('still being prepared: the status and no form', () => {
    renderWithI18n(<SwapEditView template={template({ preparation: 'preparing', swap: { people: 1, persons: [], parts: [], sound: true } })} />);
    expect(screen.getByText('Being prepared')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save people' })).toBeNull();
  });

  it('not prepared: says why, with the words of the note, and no form', () => {
    renderWithI18n(<SwapEditView template={template({ preparation: 'failed', preparationNote: 'source-unavailable' })} />);
    expect(screen.getByText('The video could not be fetched from its source.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save people' })).toBeNull();
  });

  it('an edit the worker did not take: says so, and the form is still there', () => {
    renderWithI18n(<SwapEditView template={template({ preparationNote: 'check-failed' })} />);
    expect(screen.getByText(/did not pass the system check/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save people' })).toBeInTheDocument();
  });
});

describe('SwapEditView: drawing on the picture', () => {
  const rect = { left: 100, top: 50, width: 200, height: 400, right: 300, bottom: 450, x: 100, y: 50, toJSON: () => ({}) };

  it('a drag sets the box of the person, in percent of the picture, and the fields follow', () => {
    renderWithI18n(<SwapEditView template={template()} />);
    const frame = screen.getByTestId('frame');
    frame.getBoundingClientRect = () => rect as DOMRect;
    fireEvent.pointerDown(frame, { clientX: 120, clientY: 90, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 260, clientY: 410, pointerId: 1 });
    fireEvent.pointerUp(frame, { clientX: 260, clientY: 410, pointerId: 1 });
    const first = within(person(1));
    expect(first.getByLabelText('Left')).toHaveValue(10);
    expect(first.getByLabelText('Top')).toHaveValue(10);
    expect(first.getByLabelText('Right')).toHaveValue(80);
    expect(first.getByLabelText('Bottom')).toHaveValue(90);
  });

  it('a drag from the lower right to the upper left makes the same box, and one that leaves the picture stops at its edge', () => {
    renderWithI18n(<SwapEditView template={template()} />);
    const frame = screen.getByTestId('frame');
    frame.getBoundingClientRect = () => rect as DOMRect;
    fireEvent.pointerDown(frame, { clientX: 260, clientY: 410, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(frame, { clientX: 20, clientY: 10, pointerId: 1 });
    const first = within(person(1));
    expect(first.getByLabelText('Left')).toHaveValue(0);
    expect(first.getByLabelText('Top')).toHaveValue(0);
    expect(first.getByLabelText('Right')).toHaveValue(80);
    expect(first.getByLabelText('Bottom')).toHaveValue(90);
  });

  it('a click with no drag changes nothing', () => {
    renderWithI18n(<SwapEditView template={template()} />);
    const frame = screen.getByTestId('frame');
    frame.getBoundingClientRect = () => rect as DOMRect;
    fireEvent.pointerDown(frame, { clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(frame, { clientX: 150, clientY: 100, pointerId: 1 });
    expect(within(person(1)).getByLabelText('Left')).toHaveValue(30);
  });

  it('draws for the person that is chosen when there are two', async () => {
    renderWithI18n(<SwapEditView template={template({ swap: { people: 2, persons: [WOMAN, { ...WOMAN, slot: 2, hint: 'the man' }], parts: [], sound: true } })} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Person 2' }));
    const frame = screen.getByTestId('frame');
    frame.getBoundingClientRect = () => rect as DOMRect;
    fireEvent.pointerDown(frame, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(frame, { clientX: 200, clientY: 250, pointerId: 1 });
    expect(within(person(2)).getByLabelText('Right')).toHaveValue(50);
    expect(within(person(1)).getByLabelText('Right')).toHaveValue(70);
  });
});

describe('SwapEditView: publish and withdraw', () => {
  const idOf = (mock: typeof publishSwapVideo) => (mock.mock.calls[0]![1] as FormData).get('id');

  it('publishes a video whose people are set with one click, and says where it shows', async () => {
    renderWithI18n(<SwapEditView template={template()} />);
    const button = screen.getByRole('button', { name: 'Publish' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(publishSwapVideo).toHaveBeenCalledTimes(1));
    expect(idOf(publishSwapVideo)).toBe('sw-1');
    expect(await screen.findByText(/Published\. It shows on the person-swap page/)).toBeInTheDocument();
  });

  it('a hidden video can be published again', () => {
    renderWithI18n(<SwapEditView template={template({ status: 'hidden' })} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });

  it('is closed for a video the preparation suggested no people for, and says what to do', () => {
    renderWithI18n(<SwapEditView template={template({ swapPeople: 'unset' })} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText('Publishing needs the people of the video: set them above and save.')).toBeInTheDocument();
  });

  it('is closed while the worker has not written the people, and says to reload', () => {
    renderWithI18n(<SwapEditView template={template({ swapPeople: 'pending' })} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText(/still being written into the video by the worker/)).toBeInTheDocument();
  });

  it('is closed while the fields hold what is not saved, and open again once it is saved', async () => {
    renderWithI18n(<SwapEditView template={template()} />);
    await userEvent.type(within(person(1)).getByLabelText('Words the model finds this person by'), ' on the left');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText(/Save the people first/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save people' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled());
    expect(screen.queryByText(/Save the people first/)).toBeNull();
  });

  it('says the data layer\'s own reason when it refuses', async () => {
    publishSwapVideo.mockResolvedValue({ status: 'error', error: 'peopleUnset' });
    renderWithI18n(<SwapEditView template={template()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The people of this video are not set (or not written yet), so it cannot be published.');
  });

  it('has no Publish while the video is being prepared', () => {
    renderWithI18n(<SwapEditView template={template({ preparation: 'preparing' })} />);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('a published video offers Withdraw, not Publish; nothing is sent until the dialog is confirmed', async () => {
    renderWithI18n(<SwapEditView template={template({ status: 'published' })} />);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    let dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('It leaves the person-swap page');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(withdrawSwapVideo).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(withdrawSwapVideo).toHaveBeenCalledTimes(1));
    expect(idOf(withdrawSwapVideo)).toBe('sw-1');
    expect(await screen.findByText(/Withdrawn\. It is gone from the person-swap page/)).toBeInTheDocument();
  });

  it('a published video can still be edited: the people are saved the same way', async () => {
    renderWithI18n(<SwapEditView template={template({ status: 'published' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save people' }));
    await waitFor(() => expect(saveSwapPeople).toHaveBeenCalledTimes(1));
  });
});
