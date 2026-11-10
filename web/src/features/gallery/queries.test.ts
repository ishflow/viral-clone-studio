// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { data } from '@/data';
import { getStore, resetStore } from '@/data/mock/store';
import { loadGallery, loadTemplate, loadYourTemplates } from './queries';

beforeEach(resetStore);

describe('loadTemplate', () => {
  it('returns a catalog template to anyone and a private one only to its owner', async () => {
    expect((await loadTemplate('tpl-layering'))?.id).toBe('tpl-layering');
    expect((await loadTemplate('tpl-own-ready', 'usr-demo'))?.id).toBe('tpl-own-ready');
    expect(await loadTemplate('tpl-own-ready')).toBeNull();
    expect(await loadTemplate('tpl-own-ready', 'usr-admin')).toBeNull();
    expect(await loadTemplate('nope')).toBeNull();
  });
});

describe('loadGallery', () => {
  it('lists only published templates, newest first by default, and filters by query', async () => {
    const all = await loadGallery({}, null, true);
    expect(all.templates.map((t) => t.id)).not.toContain('tpl-own-ready');
    expect(all.templates).toHaveLength(6);
    const dates = all.templates.map((t) => t.editedAt);
    expect(dates).toEqual([...dates].sort().reverse());
    const hair = await loadGallery({ category: 'Hair', format: 'no-talking' }, null, true);
    expect(hair.templates.every((t) => t.category === 'Hair')).toBe(true);
    const none = await loadGallery({ q: 'pet food' }, null, true);
    expect(none.templates).toHaveLength(0);
    expect(none.others).toHaveLength(6);
  });
});

describe('loadGallery who asks', () => {
  it('knows a visitor from a signed-in viewer', async () => {
    expect((await loadGallery({}, null, true)).visitor).toBe(true);
    expect((await loadGallery({}, { id: 'usr-demo' }, true)).visitor).toBe(false);
  });
});

describe('loadYourTemplates', () => {
  it('returns the private templates of the viewer with their state', async () => {
    const mine = await loadYourTemplates('usr-demo');
    expect(mine.map((t) => t.id).sort()).toEqual(['tpl-own-failed', 'tpl-own-ready']);
    expect(await loadYourTemplates('usr-new')).toEqual([]);
  });
});

describe('loadGallery: the viewer\'s own templates', () => {
  it('counts the ready private templates of the signed-in viewer (a failed or preparing one is not counted), and is 0 for a visitor or a viewer with none', async () => {
    expect((await loadGallery({}, { id: 'usr-demo' }, true)).own).toBe(1);
    expect((await loadGallery({}, { id: 'usr-new' }, true)).own).toBe(0);
    expect((await loadGallery({}, {}, true)).own).toBe(0);
    expect((await loadGallery({}, null, true)).own).toBe(0);
  });
  it('never lists a private template among the published ones, and counts them whatever the search is', async () => {
    const found = await loadGallery({ q: 'pet food' }, { id: 'usr-demo' }, true);
    expect(found.own).toBe(1);
    expect(found.templates).toHaveLength(0);
  });
});

describe('the viewer\'s own talking templates while the admin hides talking templates from the gallery', () => {
  async function ownTalkingWhileHidden(): Promise<void> {
    const own = getStore().templates.find((t) => t.id === 'tpl-own-ready');
    if (own) own.format = 'talking';
    await data.admin.saveLimits('usr-admin', { showTalkingTemplates: false });
  }
  it('still lists them in the viewer\'s own list (the setting is about the gallery), and counts them', async () => {
    await ownTalkingWhileHidden();
    expect((await loadYourTemplates('usr-demo')).map((t) => t.id)).toContain('tpl-own-ready');
    expect((await loadGallery({}, { id: 'usr-demo' }, true)).own).toBe(1);
  });
  it('keeps the published talking templates out of the gallery, and out of another viewer\'s list', async () => {
    await ownTalkingWhileHidden();
    expect((await loadGallery({}, null, true)).templates.every((t) => t.format === 'no-talking')).toBe(true);
    expect(await loadYourTemplates('usr-new')).toEqual([]);
  });
});

describe('loadGallery: Free and Talking', () => {
  it('says Free only where the page may promise the free video (`freeOffer()` in core), whoever the viewer is', async () => {
    expect((await loadGallery({}, null, true)).free).toBe(true);
    expect((await loadGallery({}, null, false)).free).toBe(false);
  });
  it('B1: names the cards that do not say Free now: every card without talking while the free videos of the day are used up', async () => {
    expect((await loadGallery({}, {}, true)).freeNotNow).toEqual([]);
    getStore().limits.freeVideosPerDay = 0;
    const usedUp = await loadGallery({}, {}, true);
    const withoutTalking = usedUp.templates.filter((template) => template.format === 'no-talking').map((template) => template.id);
    expect(withoutTalking.length).toBeGreaterThan(0);
    expect(usedUp).toMatchObject({ free: true, freeNotNow: withoutTalking });
    expect((await loadGallery({}, null, true)).freeNotNow).toEqual(withoutTalking); // a visitor is not promised a free video that would not start
    expect((await loadGallery({}, {}, false)).freeNotNow).toEqual([]); // nothing to say: no card says Free
  });
  it('offers the Talking choice while the admin lists talking templates, and not after', async () => {
    expect((await loadGallery({}, null, true)).showTalking).toBe(true); // the fixtures show them (D0 Ruling 11)
    await data.admin.saveLimits('usr-admin', { showTalkingTemplates: false });
    const hidden = await loadGallery({}, null, true);
    expect(hidden.showTalking).toBe(false);
    expect(hidden.templates.every((t) => t.format === 'no-talking')).toBe(true);
  });
});
