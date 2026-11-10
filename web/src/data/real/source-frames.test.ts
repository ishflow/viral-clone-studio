// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '..';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { mediaFile } from './media';
import { closeSqliteEngines } from './sqlite-engine';
import type { TemplateState } from './rows';
import { card, makeDataDir, putTemplate } from './testing';

// The frames taken from a source video (a shot's frame, the poster of a customer's own template) and the source video itself (`reference.mp4`,
// with its first picture `reference.jpg`) are somebody's face and footage:
// only the template's owner and the admins see them, in the page's data and at `/media`, whatever the template's state. The sample the
// site made of a catalog template (its poster, its video) is the public part and stays open.

let world: ReturnType<typeof makeDataDir>;
const viewer = (id: string | null) => (id ? getStore().users.find((u) => u.id === id) ?? null : null);

const shot = (id: string) => ({ n: 1, from: 0, to: 2, action: 'Hands enter', text: 'hook', product: 1, image: `templates/${id}/shots/1.jpg` });
/** [template, state, owner]: a published catalog template, a hidden one, a customer's own (ready), and a customer's own that the row calls published. */
const TEMPLATES: [string, TemplateState, string | null][] = [['catalog', 'published', null], ['hidden', 'hidden', null], ['mine', 'ready', 'usr-demo'], ['mine-published', 'published', 'usr-demo']];
const FILES = ['poster.jpg', 'sample.mp4', 'shots/1.jpg', 'reference.jpg', 'reference.mp4'];

beforeEach(() => {
  world = makeDataDir();
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', world.dir);
  resetStore(); addDemoCustomers(); closeSqliteEngines();
  for (const [id, state, owner] of TEMPLATES) {
    mkdirSync(join(world.dir, 'templates', id, 'shots'), { recursive: true });
    for (const name of FILES) writeFileSync(join(world.dir, 'templates', id, name), 'picture');
    putTemplate(world.db, { id, state, owner, card: card({ image: `templates/${id}/poster.jpg`, video: `templates/${id}/sample.mp4`, referenceImage: `templates/${id}/reference.jpg`, referenceVideo: `templates/${id}/reference.mp4`, shots: [shot(id)] }) });
  }
});
afterEach(() => { closeSqliteEngines(); world.db.close(); vi.unstubAllEnvs(); resetStore(); });

const served = (id: string, name: string, who: string | null) => mediaFile(['templates', id, ...name.split('/')], viewer(who)) !== null;

describe('/media: the frames of a source video', () => {
  // viewer → may it open the frame of a shot, for each template
  const SEE: Record<string, Record<string, boolean>> = {
    anonymous: { catalog: false, hidden: false, mine: false, 'mine-published': false },
    'another customer': { catalog: false, hidden: false, mine: false, 'mine-published': false },
    'the owner': { catalog: false, hidden: false, mine: true, 'mine-published': true },
    'an admin': { catalog: true, hidden: true, mine: true, 'mine-published': true },
  };
  const WHO: Record<string, string | null> = { anonymous: null, 'another customer': 'usr-new', 'the owner': 'usr-demo', 'an admin': 'usr-admin' };

  for (const [who, rows] of Object.entries(SEE)) for (const [id, may] of Object.entries(rows)) {
    it(`${who} ${may ? 'opens' : 'does not open'} the shot frame of ${id}`, () => {
      expect(served(id, 'shots/1.jpg', WHO[who]!)).toBe(may);
    });
  }

  for (const [who, rows] of Object.entries(SEE)) for (const id of ['mine', 'mine-published']) {
    it(`${who} ${rows[id] ? 'opens' : 'does not open'} the poster of the customer's template ${id}`, () => {
      expect(served(id, 'poster.jpg', WHO[who]!)).toBe(rows[id]);
    });
  }

  // the source video itself and its first picture: for each template, the same table as the shot frames
  for (const name of ['reference.jpg', 'reference.mp4']) for (const [who, rows] of Object.entries(SEE)) for (const id of Object.keys(rows)) {
    it(`${who} ${rows[id] ? 'opens' : 'does not open'} ${name} of ${id}`, () => {
      expect(served(id, name, WHO[who]!)).toBe(rows[id]);
    });
  }

  it('the poster and the video of a published catalog template (the sample) stay open to everyone', () => {
    for (const name of ['poster.jpg', 'sample.mp4']) for (const who of [null, 'usr-new', 'usr-demo', 'usr-admin']) expect(served('catalog', name, who)).toBe(true);
  });

  it('a path that leaves the template (`..`, another template\'s id) is refused for the owner and the admin too', () => {
    for (const who of ['usr-demo', 'usr-admin']) {
      expect(mediaFile(['templates', 'mine', 'shots', '..', '1.jpg'], viewer(who))).toBeNull();
      expect(mediaFile(['templates', 'mine', '..', 'catalog', 'shots', '1.jpg'], viewer(who))).toBeNull();
      expect(mediaFile(['templates', '..', 'mine', 'shots', '1.jpg'], viewer(who))).toBeNull();
    }
  });
});

describe('the data: what a page is given of a template', () => {
  const frames = (t: { shots: { image?: string | null }[] } | null | undefined) => t?.shots.map((s) => s.image ?? null);

  it('a visitor and another customer get a published catalog template without its shot frames, with its sample poster', async () => {
    for (const who of [undefined, 'usr-new']) {
      const one = await data.catalog.get('catalog', who);
      expect(frames(one)).toEqual([null]);
      expect(one?.image).toBe('/media/templates/catalog/poster.jpg');
      expect(one?.video).toBe('/media/templates/catalog/sample.mp4');
      const listed = (await data.catalog.list({ viewerId: who })).find((t) => t.id === 'catalog');
      expect(frames(listed)).toEqual([null]);
    }
  });

  it('a visitor and another customer get a published catalog template without its source video and its first picture; the owner and an admin keep them', async () => {
    for (const who of [undefined, 'usr-new']) {
      const one = await data.catalog.get('catalog', who);
      expect(one?.referenceVideo ?? null).toBeNull();
      expect(one?.referenceImage ?? null).toBeNull();
      const listed = (await data.catalog.list({ viewerId: who })).find((t) => t.id === 'catalog');
      expect([listed?.referenceVideo ?? null, listed?.referenceImage ?? null]).toEqual([null, null]);
    }
    const admin = await data.catalog.get('catalog', 'usr-admin');
    expect([admin?.referenceVideo, admin?.referenceImage]).toEqual(['/media/templates/catalog/reference.mp4', '/media/templates/catalog/reference.jpg']);
    const own = await data.catalog.get('mine', 'usr-demo');
    expect([own?.referenceVideo, own?.referenceImage]).toEqual(['/media/templates/mine/reference.mp4', '/media/templates/mine/reference.jpg']);
  });

  it('an admin gets the frames of a catalog template too', async () => {
    expect(frames(await data.catalog.get('catalog', 'usr-admin'))).toEqual(['/media/templates/catalog/shots/1.jpg']);
    expect(frames((await data.catalog.list({ viewerId: 'usr-admin' })).find((t) => t.id === 'catalog'))).toEqual(['/media/templates/catalog/shots/1.jpg']);
  });

  it('the owner gets the frames and the poster of their own template; nobody else gets the template at all', async () => {
    for (const id of ['mine', 'mine-published']) {
      const own = await data.catalog.get(id, 'usr-demo');
      expect(frames(own)).toEqual([`/media/templates/${id}/shots/1.jpg`]);
      expect(own?.image).toBe(`/media/templates/${id}/poster.jpg`);
      expect(await data.catalog.get(id, 'usr-new')).toBeNull();
      expect(await data.catalog.get(id)).toBeNull();
    }
  });

  it('the admin\'s own view of every template keeps the frames', async () => {
    for (const [id] of TEMPLATES) expect(frames(await data.admin.template(id))).toEqual([`/media/templates/${id}/shots/1.jpg`]);
  });
});
