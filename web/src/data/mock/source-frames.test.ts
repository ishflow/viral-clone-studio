// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { data } from '../index';
import { getStore, resetStore } from './store';

// The mock engine hands the page the same thing the real one does: the frames of a source video only to the template's owner and the admins.
// (The real engine's table, with `/media`, is in real/source-frames.test.ts.)

const shotImages = (template: { shots: { image?: string | null }[] } | null | undefined) => template?.shots.map((shot) => shot.image ?? null);

beforeEach(() => {
  resetStore();
  for (const template of getStore().templates.filter((item) => ['tpl-layering', 'tpl-own-ready'].includes(item.id))) {
    template.shots = template.shots.map((shot) => ({ ...shot, image: `/media/templates/${template.id}/shots/${shot.n}.jpg` }));
  }
});

describe('the frames of a source video in the mock data', () => {
  it('a visitor and another customer get a published template without its shot frames; its poster stays', async () => {
    for (const who of [undefined, 'usr-new']) {
      const template = await data.catalog.get('tpl-layering', who);
      expect(shotImages(template)).toEqual(Array(5).fill(null));
      expect(template?.image).not.toBe('');
      expect(shotImages((await data.catalog.list({ viewerId: who })).find((item) => item.id === 'tpl-layering'))).toEqual(Array(5).fill(null));
    }
  });

  it('an admin gets the frames of a published template', async () => {
    expect(shotImages(await data.catalog.get('tpl-layering', 'usr-admin'))?.every(Boolean)).toBe(true);
  });

  it('the owner gets the frames of their own template; nobody else gets that template', async () => {
    expect(shotImages(await data.catalog.get('tpl-own-ready', 'usr-demo'))?.every(Boolean)).toBe(true);
    expect(await data.catalog.get('tpl-own-ready', 'usr-new')).toBeNull();
    expect(await data.catalog.get('tpl-own-ready')).toBeNull();
  });
});
