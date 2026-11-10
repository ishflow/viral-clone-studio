import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeSqliteEngines, sqliteEngine } from './sqlite-engine';
import { card, makeDataDir, putTemplate } from './testing';

// The frames of the reference video the worker keeps in the card of a template: a picture for each shot of its list.

let dir: string;
let db: DatabaseSync;
const engine = () => sqliteEngine(dir);
const withFrames = () => card({
  shots: [
    { n: 1, from: 0, to: 2, action: 'Hands enter', text: 'hook', product: 1, image: 'templates/t1/shots/1.jpg' },
    { n: 2, from: 2, to: 4, action: 'Box opens', text: 'two', product: 1, image: 'templates/t1/shots/2.jpg' },
  ],
});
/** What the admin's form sends: the shots without their pictures. */
const asEdited = (shots: ReturnType<typeof withFrames>['shots']) => shots.map(({ n, from, to, action, text, product }) => ({ n, from, to, action, text, product }));

beforeEach(() => { ({ dir, db } = makeDataDir()); });
afterEach(() => { closeSqliteEngines(); db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('the pictures of the shots', () => {
  it('a shot with a frame is given to the site as a /media link; a shot without one has none', () => {
    putTemplate(db, { id: 't1', card: card({ shots: [{ ...withFrames().shots[0]! }, { n: 2, from: 2, to: 4, action: 'Box', text: '', product: 1 }] }) });
    const shots = engine().template('t1')!.shots;
    expect(shots[0]!.image).toBe('/media/templates/t1/shots/1.jpg');
    expect(shots[1]!.image ?? null).toBeNull();
  });

  it('saving the shots as the admin\'s form sends them (no pictures) is no change of the shots: the sample stays current', () => {
    putTemplate(db, { id: 't1', card: withFrames() });
    engine().updateTemplate('t1', { shots: asEdited(withFrames().shots) });
    expect(engine().template('t1')!.sample).toBe('current');
  });

  it('a saved shot keeps its picture while it is where it was, and loses it when it was moved', () => {
    putTemplate(db, { id: 't1', card: withFrames() });
    const edited = asEdited(withFrames().shots);
    edited[0] = { ...edited[0]!, action: 'Hands come in', text: 'new hook' };
    edited[1] = { ...edited[1]!, to: 5 };
    engine().updateTemplate('t1', { shots: edited });
    const stored = (JSON.parse((db.prepare('SELECT card FROM templates WHERE id = ?').get('t1') as { card: string }).card) as { shots: { image?: string }[] }).shots;
    expect(stored.map((shot) => shot.image ?? null)).toEqual(['templates/t1/shots/1.jpg', null]);
  });
});
