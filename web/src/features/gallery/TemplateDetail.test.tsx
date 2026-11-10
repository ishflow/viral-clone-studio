import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Template } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { makeTemplate } from './fixtures';
import { TemplateDetail } from './TemplateDetail';

vi.mock('next/image', () => ({ default: (p: { alt: string; src?: string }) => <span role="img" aria-label={p.alt} data-src={p.src} /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), unstable_rethrow: () => {} }));
const removeTemplate = vi.fn();
vi.mock('./actions', () => ({ removeTemplate: (id: string) => removeTemplate(id) }));
afterEach(cleanup);

describe('TemplateDetail (catalog)', () => {
  it('adds the like rate to the reference line when the template has one', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ referenceLikes: '10.1%' })} />);
    expect(screen.getByText('1.9M views · 10.1% likes')).toBeInTheDocument();
  });
  it('shows title, tags, numbers, shot list and a Clone it link to the generate page', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ video: '/samples/a.mp4' })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Fragrance layering recipe' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clone it' })).toHaveAttribute('href', '/templates/tpl-a/generate');
    expect(screen.getByRole('link', { name: 'Gallery' })).toHaveAttribute('href', '/gallery');
    expect(screen.getByText('4 products')).toBeInTheDocument();
    expect(screen.getByText('1.9M views')).toBeInTheDocument();
    expect(screen.getAllByText(/^On screen:/)).toHaveLength(2);
    expect(screen.queryByText('Only you')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play the sample' })).toBeInTheDocument();
  });
  it('opens the player from the play button', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ video: '/samples/a.mp4' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play the sample' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('has no play button when the template has no sample video', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate()} />);
    expect(screen.queryByRole('button', { name: 'Play the sample' })).toBeNull();
  });
});

describe('TemplateDetail of a catalog template without a sample, for someone who may not see its source video', () => {
  const bare = (patch: Partial<Template> = {}) => makeTemplate({ image: '', video: null, referenceVideo: null, referenceImage: null, ...patch });
  it('shows an empty box that says there is no sample yet: no player, no picture with an empty address', () => {
    const { container } = renderWithI18n(<TemplateDetail template={bare()} />);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('img', { name: /Frame from the sample video/ })).toBeNull();
    expect(screen.getByText('No sample yet')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Shot list' });
    expect(within(list).queryAllByRole('img').filter((img) => !img.getAttribute('data-src'))).toEqual([]);
    expect(list.querySelectorAll('span[aria-hidden="true"].border-dashed')).toHaveLength(3);
  });
  it('a catalog template with no sample video has no sample caption', () => {
    renderWithI18n(<TemplateDetail template={bare({ image: '/media/templates/tpl-a/poster.jpg' })} />);
    expect(screen.queryByText(/Sample video\./)).toBeNull();
    renderWithI18n(<TemplateDetail template={makeTemplate({ video: '/samples/a.mp4' })} />);
    expect(screen.getByText(/Sample video\./)).toBeInTheDocument();
  });
  it('keeps the sample poster when there is one', () => {
    renderWithI18n(<TemplateDetail template={bare({ image: '/media/templates/tpl-a/poster.jpg' })} />);
    expect(screen.getByRole('img', { name: /Frame from the sample video/ })).toHaveAttribute('data-src', '/media/templates/tpl-a/poster.jpg');
    expect(screen.queryByText('No sample yet')).toBeNull();
  });
});

describe('TemplateDetail in Turkish', () => {
  it('writes the times of the shot list with the Turkish unit, never "sec"', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate()} />, 'tr');
    const list = screen.getByRole('region', { name: 'Çekim listesi' });
    expect(list).toHaveTextContent('0.0–1.3 sn');
    expect(list).not.toHaveTextContent(/\bsec\b/);
  });
});

describe('TemplateDetail description and tags', () => {
  it('shows the description and the tag chips after category, format and length; omits an empty description', () => {
    const { rerender } = renderWithI18n(<TemplateDetail template={makeTemplate({ description: 'First the products side by side.', tags: ['Hands and product'] })} />);
    expect(screen.getByText('First the products side by side.')).toBeInTheDocument();
    const chips = screen.getAllByRole('listitem').slice(0, 4).map((li) => li.textContent);
    expect(chips).toEqual(['Fragrance', 'No talking', '8 sec', 'Hands and product']);
    cleanup();
    renderWithI18n(<TemplateDetail template={makeTemplate({ description: '', tags: [] })} />);
    expect(screen.queryByText('First the products side by side.')).toBeNull();
    void rerender;
  });
});

describe('TemplateDetail (own private template)', () => {
  const own = makeTemplate({ id: 'tpl-own', status: 'private', ownerId: 'usr-demo', category: '', referenceViews: '', preparation: 'ready' });
  it('shows the Only you tag, the untested note and Clone it', () => {
    renderWithI18n(<TemplateDetail template={own} />);
    expect(screen.getByText('Only you')).toBeInTheDocument();
    expect(screen.getByText(/We have not tested this template/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clone it' })).toHaveAttribute('href', '/templates/tpl-own/generate');
  });
  it('Delete this template asks first; Cancel deletes nothing', () => {
    renderWithI18n(<TemplateDetail template={own} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete this template' }));
    expect(screen.getByText('Delete this template? It cannot be brought back.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(removeTemplate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete this template' })).toBeInTheDocument();
  });
  it('Delete removes the template through the action; a template in use says why it stays', async () => {
    removeTemplate.mockResolvedValueOnce({ status: 'error', code: 'in-use' });
    renderWithI18n(<TemplateDetail template={own} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete this template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(removeTemplate).toHaveBeenCalledWith('tpl-own');
    expect(await screen.findByRole('alert')).toHaveTextContent('A video is being made from this template. Delete it once the video is ready.');
  });
  it('hides Clone it while the template is still preparing', () => {
    renderWithI18n(<TemplateDetail template={{ ...own, preparation: 'preparing' }} />);
    expect(screen.queryByRole('link', { name: 'Clone it' })).toBeNull();
    expect(screen.getByText(/still reading this video/)).toBeInTheDocument();
  });
});

describe('TemplateDetail: free video, length, promise (boards A-Detay, A-Detay-Ozel)', () => {
  it('says Free with your first video under the button, only when the free video applies', () => {
    const { unmount } = renderWithI18n(<TemplateDetail template={makeTemplate()} free />);
    expect(screen.getByText('Free with your first video')).toBeInTheDocument();
    unmount();
    renderWithI18n(<TemplateDetail template={makeTemplate()} />);
    expect(screen.queryByText('Free with your first video')).toBeNull();
  });
  it('a talking template says what it needs, and never Free', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ format: 'talking' })} talkingCredits={4} />);
    expect(screen.getByText('Needs credits · 4 credits')).toBeInTheDocument();
    expect(screen.queryByText('Free with your first video')).toBeNull();
  });
  it('shows the length of the final video and how many clips it is made from, and the structure promise', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ shots: makeTemplate().shots.concat(makeTemplate().shots.slice(0, 2)) })} />);
    expect(screen.getByText('8 sec final video')).toBeInTheDocument();
    expect(screen.getByText('Made from 5 clips')).toBeInTheDocument();
    expect(screen.getByText('The structure stays the same: shots, order, timing and on-screen text. People, setting and music are made new around your product.')).toBeInTheDocument();
  });
  it('an own template says the rights sentence and Free with your first video; not while it is preparing', () => {
    const own = makeTemplate({ id: 'tpl-own', status: 'private', ownerId: 'usr-demo', category: '', referenceViews: '', preparation: 'ready' });
    const { unmount } = renderWithI18n(<TemplateDetail template={own} free />);
    expect(screen.getByText('You confirm you have the right to use this video as a reference.')).toBeInTheDocument();
    expect(screen.getByText('Free with your first video')).toBeInTheDocument();
    unmount();
    renderWithI18n(<TemplateDetail template={{ ...own, preparation: 'preparing' }} free />);
    expect(screen.queryByText('Free with your first video')).toBeNull();
    expect(screen.queryByText(/You confirm you have the right/)).toBeNull();
  });
  it('is written in Turkish', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate()} free />, 'tr');
    expect(screen.getByText('İlk videonla ücretsiz')).toBeInTheDocument();
    expect(screen.getByText('8 sn son video')).toBeInTheDocument();
    expect(screen.getByText('3 klipten üretilir')).toBeInTheDocument();
  });
});

describe('TemplateDetail small faults (EK1)', () => {
  it('writes no "On screen:" label for a shot that has no text', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ shots: [{ n: 1, from: 0, to: 4, action: 'A hand holds the product', text: '', product: null }, { n: 2, from: 4, to: 8, action: 'Close-up', text: '  ', product: null }] })} />);
    expect(screen.queryByText(/On screen/)).toBeNull();
  });
  it('writes no "On screen:" label for a shot whose text is "none", in any case', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ shots: [{ n: 1, from: 0, to: 4, action: 'A hand holds the product', text: 'none', product: null }, { n: 2, from: 4, to: 8, action: 'Close-up', text: ' None ', product: null }, { n: 3, from: 8, to: 9, action: 'Logo', text: 'Only today', product: null }] })} />);
    expect(screen.getAllByText(/^On screen:/)).toHaveLength(1);
    expect(screen.getByText('On screen: Only today')).toBeInTheDocument();
  });
  it('a template that could not be prepared says nothing it does not know: no "0 sec", no length, no count of products, no look-over line', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ status: 'private', ownerId: 'usr-demo', preparation: 'failed', preparationNote: 'unsupported', shots: [], seconds: 0, products: 1 })} />);
    expect(screen.queryByText(/^0 sec/)).toBeNull();
    expect(screen.queryByText('Length')).toBeNull();
    expect(screen.queryByText('You need')).toBeNull();
    expect(screen.queryByText(/shot list/i)).toBeNull();
    expect(screen.getByText('Only you')).toBeInTheDocument();
  });
  it('a failed own template promises no sample', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ status: 'private', ownerId: 'usr-demo', preparation: 'failed', preparationNote: 'unsupported', shots: [], seconds: 0, products: 1 })} />);
    expect(screen.queryByText(/The sample appears here/)).toBeNull();
    expect(screen.getByText('Only you can see the video you added.')).toBeInTheDocument();
  });
  it('the same in Turkish, and a template still being read keeps the "still reading" note without the look-over line', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ status: 'private', ownerId: 'usr-demo', preparation: 'preparing', shots: [], seconds: 0, products: 1 })} />, 'tr');
    expect(screen.queryByText(/0 sn/)).toBeNull();
    expect(screen.queryByText('1 ürün')).toBeNull();
    expect(screen.queryByText(/çekim listesine/)).toBeNull();
    expect(screen.getByText(/hâlâ okuyoruz/)).toBeInTheDocument();
  });
  it('writes the tags the engine gives as readable names, not as raw labels, and does not repeat the format chip', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ format: 'talking', tags: ['talking', 'warning', 'product-check', 'before-after', 'face', 'new-look'] })} />);
    const chips = screen.getAllByRole('listitem').slice(0, 8).map((li) => li.textContent);
    expect(chips).toEqual(['Fragrance', 'Talking', '8 sec', 'Warning', 'Product check', 'Before and after', 'Face on camera', 'New look']);
  });
  it('writes the tags in Turkish', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ tags: ['no-talking', 'before-after', 'product-check'] })} />, 'tr');
    const chips = screen.getAllByRole('listitem').slice(0, 5).map((li) => li.textContent);
    expect(chips).toEqual(['Fragrance', 'Konuşmasız', '8 sn', 'Önce ve sonra', 'Ürün kontrolü']);
  });
  it('the player opened on the template page has no Open template link to the same page', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ video: '/samples/a.mp4' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play the sample' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open template' })).toBeNull();
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Clone it' })).toBeInTheDocument();
  });
  it('an own template goes back to Your templates, not to the gallery', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ status: 'private', ownerId: 'usr-demo', preparation: 'ready' })} />);
    expect(screen.getByRole('link', { name: 'Your templates' })).toHaveAttribute('href', '/templates/new#yours');
    expect(screen.queryByRole('link', { name: 'Gallery' })).toBeNull();
  });
  it('a template that could not be prepared does not write "Shots 0" or "Made from 0 clips"', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ status: 'private', ownerId: 'usr-demo', preparation: 'failed', preparationNote: 'unsupported', shots: [], seconds: 0 })} />);
    expect(screen.queryByText('Shots')).toBeNull();
    expect(screen.queryByText(/Made from \d+ clip/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Shot list' })).toBeNull();
  });
});

describe('TemplateDetail: the pictures of the shot list', () => {
  const frames = [{ image: '/media/templates/tpl-a/shots/1.jpg' }, { image: '/media/templates/tpl-a/shots/2.jpg' }, {}];
  const withFrames = (patch: Parameters<typeof makeTemplate>[0] = {}) => {
    const base = makeTemplate(patch);
    return { ...base, shots: base.shots.map((shot, i) => ({ ...shot, ...frames[i] })) };
  };
  const list = () => screen.getByRole('region', { name: 'Shot list' });
  const sources = () => within(list()).queryAllByRole('img').map((img) => img.getAttribute('data-src'));

  it('an own template shows the frame of its reference for each shot that has one, an empty frame for the others', () => {
    renderWithI18n(<TemplateDetail template={withFrames({ status: 'private', ownerId: 'usr-demo', preparation: 'ready', category: '' })} />);
    expect(sources()).toEqual(['/media/templates/tpl-a/shots/1.jpg', '/media/templates/tpl-a/shots/2.jpg']);
    expect(list().querySelectorAll('span[aria-hidden="true"].border-dashed')).toHaveLength(1);
  });

  it('an own template with no frames at all keeps the empty frames', () => {
    renderWithI18n(<TemplateDetail template={makeTemplate({ status: 'private', ownerId: 'usr-demo', preparation: 'ready', category: '' })} />);
    expect(sources()).toEqual([]);
    expect(list().querySelectorAll('span[aria-hidden="true"].border-dashed')).toHaveLength(3);
  });

  it('a catalog template shows the frame of each shot, and the picture of the card for a shot without one', () => {
    renderWithI18n(<TemplateDetail template={withFrames()} />);
    expect(sources()).toEqual(['/media/templates/tpl-a/shots/1.jpg', '/media/templates/tpl-a/shots/2.jpg', '/samples/a.jpg']);
  });
});
