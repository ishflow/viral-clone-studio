import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttonClass } from '@/shared/ui';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { OVERLAY, LIVE } from './GalleryCard';
import { GalleryLoading } from './GalleryLoading';
import { GalleryView } from './GalleryView';
import { makeTemplate } from './fixtures';
import type { GalleryQuery } from './query';

vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
afterEach(cleanup);

const base: GalleryQuery = { q: '', category: '', format: '', sort: 'newest' };
const cats = ['Lashes', 'Hair'];
const templates = [makeTemplate(), makeTemplate({ id: 'tpl-b', title: 'Dupe comparison', video: '/samples/b.mp4', format: 'talking' })];

describe('GalleryView filters', () => {
  it('builds category and format links from the query and marks the current ones', () => {
    renderWithI18n(<GalleryView data={{ query: { ...base, q: 'pet', category: 'Hair', format: 'talking' }, categories: cats, templates, others: [], free: false, showTalking: true }} />);
    const pills = within(screen.getByRole('group', { name: 'Category' }));
    expect(pills.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/gallery?q=pet&format=talking');
    expect(pills.getByRole('link', { name: 'Lashes' })).toHaveAttribute('href', '/gallery?q=pet&category=Lashes&format=talking');
    expect(pills.getByRole('link', { name: 'Hair' })).toHaveAttribute('aria-current', 'page');
    expect(pills.getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current');
    const format = within(screen.getByRole('group', { name: 'Format' }));
    expect(format.getByRole('link', { name: 'Talking' })).toHaveAttribute('aria-current', 'page');
    expect(format.getByRole('link', { name: 'No talking' })).toHaveAttribute('href', '/gallery?q=pet&category=Hair&format=no-talking');
  });
  it('has a GET search form that keeps the other filters', () => {
    renderWithI18n(<GalleryView data={{ query: { ...base, q: 'pet', category: 'Hair', sort: 'used' }, categories: cats, templates, others: [], free: false, showTalking: true }} />);
    const search = screen.getByRole('searchbox', { name: 'Search templates' });
    expect(search).toHaveValue('pet');
    const form = search.closest('form')!;
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/gallery');
    expect(form.querySelector('input[name="category"]')).toHaveValue('Hair');
    expect(form.querySelector('input[name="sort"]')).toHaveValue('used');
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('used');
  });
});

describe('GalleryView cards', () => {
  it('shows the add card first, then a card per template linking to its page', () => {
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates, others: [], free: false, showTalking: true }} />);
    expect(screen.getByRole('link', { name: /Add your own video/ })).toHaveAttribute('href', '/templates/new');
    expect(screen.getByRole('link', { name: 'Fragrance layering recipe' })).toHaveAttribute('href', '/templates/tpl-a');
    expect(screen.getAllByText('Fragrance · reference 1.9M views')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Clone it' })[0]).toHaveAttribute('href', '/templates/tpl-a/generate');
  });
  it('a template without a category shows the reference views alone, with no dangling separator', () => {
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates: [makeTemplate({ category: '', referenceViews: '5.0M' })], others: [], free: false, showTalking: true }} />);
    expect(screen.getByText('reference 5.0M views')).toBeInTheDocument();
    expect(screen.queryByText(/^\s*·/)).toBeNull();
  });
  it('offers the player only on cards that have a sample video', () => {
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates, others: [], free: false, showTalking: true }} />);
    expect(screen.queryByRole('button', { name: 'Play the sample of Fragrance layering recipe' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Play the sample of Dupe comparison' })).toBeInTheDocument();
  });
});

describe('GalleryLoading', () => {
  it('fills two rows of five with the add card and nine skeleton cards; the phone shows five (boards A-Galeri-Yukleniyor, -M)', () => {
    const { container } = renderWithI18n(<GalleryLoading categories={cats} />);
    expect(screen.getByRole('link', { name: /Add your own video/ })).toBeInTheDocument();
    const cards = Array.from(container.querySelectorAll('[aria-busy="true"] .animate-pulse')).map((el) => el.parentElement!);
    expect(cards).toHaveLength(9);
    expect(cards.map((card) => card.className.split(' ').includes('max-nav:hidden'))).toEqual([false, false, false, false, false, true, true, true, true]);
    expect(screen.getByRole('status')).toHaveTextContent('Loading templates');
  });
});

describe('GalleryView no results', () => {
  it('quotes the query, offers Clear search and Add, and lists other templates below', () => {
    renderWithI18n(<GalleryView data={{ query: { ...base, q: 'pet food', format: 'talking' }, categories: cats, templates: [], others: templates, free: false, showTalking: true }} />);
    expect(screen.getByRole('heading', { name: 'No templates for “pet food” yet.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear search' })).toHaveAttribute('href', '/gallery?format=talking');
    expect(screen.getByRole('link', { name: 'Add your own video' })).toHaveAttribute('href', '/templates/new');
    expect(screen.getByRole('heading', { name: 'Other templates' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dupe comparison' })).toBeInTheDocument();
  });

  it('prints no "Other templates" heading when there are no other templates either', () => {
    renderWithI18n(<GalleryView data={{ query: { ...base, q: 'zzz' }, categories: cats, templates: [], others: [], free: false, showTalking: true }} />);
    expect(screen.getByRole('heading', { name: 'No templates for “zzz” yet.' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Other templates' })).toBeNull();
  });
});

describe('GalleryView an empty gallery (no search, no filter)', () => {
  it('says there are no ready templates yet, not that filters hide them, and leads to adding a video with the primary button', () => {
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates: [], others: [], free: false, showTalking: true }} />);
    expect(screen.getByRole('heading', { name: 'No ready templates yet.' })).toBeInTheDocument();
    expect(screen.getByText('Give us a video you like: in 2–5 minutes it becomes a template only you can see.')).toBeInTheDocument();
    expect(screen.queryByText(/filters/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Clear search' })).toBeNull();
    const add = screen.getByRole('link', { name: 'Add your own video' });
    expect(add).toHaveAttribute('href', '/templates/new');
    expect(add.className).toBe(buttonClass('primary'));
  });
  it('tells a visitor, who cannot add a video, that the first ready templates are being prepared, and offers no add button', () => {
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates: [], others: [], free: false, showTalking: true, visitor: true }} />);
    expect(screen.getByRole('heading', { name: 'No ready templates yet.' })).toBeInTheDocument();
    expect(screen.getByText('We are preparing the first ready templates. They will appear here.')).toBeInTheDocument();
    expect(screen.queryByText(/Give us a video you like/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add your own video' })).toBeNull();
  });
  it('with templates of the viewer\'s own, says nothing is public yet and where their own are', () => {
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates: [], others: [], free: false, showTalking: true, own: 2 }} />);
    expect(screen.getByRole('heading', { name: 'No public templates yet.' })).toBeInTheDocument();
    expect(screen.getByText('The videos you added are under “Your templates”. Add another any time.')).toBeInTheDocument();
    expect(screen.queryByText(/No ready templates/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Your templates (2)' })).toBeInTheDocument();
  });
  it('keeps the filter wording while a category or format filter is on', () => {
    renderWithI18n(<GalleryView data={{ query: { ...base, category: 'Hair' }, categories: cats, templates: [], others: [], free: false, showTalking: true }} />);
    expect(screen.getByRole('heading', { name: 'No templates match these filters yet.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your own video' }).className).toBe(buttonClass('secondary'));
  });
});

describe('GalleryView the viewer\'s own templates', () => {
  it('links to the own templates with their count above the list, and says nothing when there are none', () => {
    const { unmount } = renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates, others: [], free: false, showTalking: true, own: 2 }} />);
    expect(screen.getByRole('link', { name: 'Your templates (2)' })).toHaveAttribute('href', '/templates/new#yours');
    unmount();
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates, others: [], free: false, showTalking: true, own: 0 }} />);
    expect(screen.queryByRole('link', { name: /Your templates/ })).toBeNull();
  });
  it('is there on an empty result too, so the way to an own template never depends on a search', () => {
    renderWithI18n(<GalleryView data={{ query: { ...base, q: 'zzz' }, categories: cats, templates: [], others: [], free: false, showTalking: true, own: 1 }} />);
    expect(screen.getByRole('link', { name: 'Your templates (1)' })).toHaveAttribute('href', '/templates/new#yours');
  });
});

describe('GalleryView on the phone (boards Main-M, A-Galeri-Sonuc-Yok-M)', () => {
  it('uses the 24 px rhythm of the phone boards and stacks the empty-state buttons full width', () => {
    const { container } = renderWithI18n(<GalleryView data={{ query: { ...base, q: 'zzz' }, categories: cats, templates: [], others: templates, free: false, showTalking: true }} />);
    const root = container.firstElementChild!.className.split(' ');
    expect(root).toEqual(expect.arrayContaining(['gap-6', 'nav:gap-12', 'max-nav:-mt-2', 'nav:pt-4']));
    const box = screen.getByRole('status').className.split(' ');
    expect(box).toEqual(expect.arrayContaining(['p-6', 'nav:p-8']));
    const buttons = screen.getByRole('link', { name: 'Clear search' }).parentElement!.className.split(' ');
    expect(buttons).toEqual(expect.arrayContaining(['flex-[1_1_100%]', 'flex-col', 'nav:flex-none', 'nav:flex-row']));
  });
});

describe('GalleryCard hover overlay (touch and keyboard reach it)', () => {
  it('with hover: invisible and inert until the card is hovered or focused (Tab shows it)', () => {
    expect(OVERLAY).toMatch(/(^| )hidden( |$)/);
    expect(OVERLAY).toContain('[@media(hover:hover)]:flex');
    expect(OVERLAY).toContain('pointer-events-none');
    expect(OVERLAY).toContain('group-focus-within:opacity-100');
    expect(LIVE).not.toMatch(/(^| )pointer-events-auto/);
    expect(LIVE).toContain('group-hover:pointer-events-auto');
    expect(LIVE).toContain('group-focus-within:pointer-events-auto');
  });
  it('without hover (touch): always shown and live, so Clone it and Play can be tapped', () => {
    expect(OVERLAY).toContain('[@media(hover:none)]:flex');
    expect(OVERLAY).toContain('[@media(hover:none)]:opacity-100');
    expect(LIVE).toContain('[@media(hover:none)]:pointer-events-auto');
  });
  it('uses the long placeholder on desktop and a short one on the phone', () => {
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates, others: [], free: false, showTalking: true }} />);
    expect(screen.getByText('Search templates', { selector: 'span.nav\\:hidden' })).toBeInTheDocument();
    expect(screen.getByText('Search templates: category, format, product type')).toBeInTheDocument();
  });
});

describe('GalleryView Free label (board Main)', () => {
  const view = (patch: Partial<Parameters<typeof GalleryView>[0]['data']> = {}) =>
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates, others: [], free: true, showTalking: true, ...patch }} />);
  it('sits on the card without talking when the free video is there, and never on a talking card', () => {
    view();
    const free = screen.getAllByText('Free');
    expect(free).toHaveLength(1);
    expect(free[0]!.closest('article')).toHaveTextContent('Fragrance layering recipe');
    expect(free[0]!.className).toContain('text-accent');
    expect(free[0]!.className).not.toContain('text-on-scrim');
    expect(screen.getByRole('link', { name: 'Dupe comparison' }).closest('article')).not.toHaveTextContent('Free');
  });
  it('B1: is not on a card whose free video would not start now', () => {
    view({ freeNotNow: templates.filter((template) => template.format === 'no-talking').map((template) => template.id) });
    expect(screen.queryByText('Free')).toBeNull();
  });
  it('is not shown anywhere once the free video is used', () => {
    view({ free: false });
    expect(screen.queryByText('Free')).toBeNull();
  });
  it('is on the other templates of an empty result too', () => {
    view({ query: { ...base, q: 'zzz' }, templates: [], others: templates });
    expect(screen.getAllByText('Free')).toHaveLength(1);
  });
  it('is written in Turkish', () => {
    renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates, others: [], free: true, showTalking: true }} />, 'tr');
    expect(screen.getAllByText('Ücretsiz')).toHaveLength(1);
  });
});

describe('GalleryView talking templates and the 320 px rules (R7)', () => {
  it('offers the Talking choice only while talking templates are listed, unless it is the current choice', () => {
    const { unmount } = renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates, others: [], free: false, showTalking: false }} />);
    expect(within(screen.getByRole('group', { name: 'Format' })).queryByRole('link', { name: 'Talking' })).toBeNull();
    unmount();
    renderWithI18n(<GalleryView data={{ query: { ...base, format: 'talking' }, categories: cats, templates, others: [], free: false, showTalking: false }} />);
    expect(within(screen.getByRole('group', { name: 'Format' })).getByRole('link', { name: 'Talking' })).toBeInTheDocument();
  });
  it('splits the format and sort row under 360 px and moves the length label to the corner of the card', () => {
    const { container } = renderWithI18n(<GalleryView data={{ query: base, categories: cats, templates, others: [], free: true, showTalking: true }} />);
    const format = screen.getByRole('group', { name: 'Format' }).parentElement!;
    expect(format.className).toContain('flex-[1_1_100%]');
    expect(format.className).toContain('min-[360px]:flex-[1_1_0]');
    expect(format.parentElement!.className).toContain('flex-wrap');
    const tag = Array.from(container.querySelectorAll('article span')).find((el) => el.textContent === '8 sec')!;
    expect(tag.className).toContain('max-[359px]:bottom-2.5');
  });
});
