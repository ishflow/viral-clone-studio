import { sqliteEngine } from '../real/sqlite-engine';
import { fakeEngine } from './fake';
import type { Engine } from './port';

/** The production system the site talks to: the fake, or the real one with `VC_ENGINE=sqlite`. The env is read on every call. */
export function engine(): Engine {
  return process.env.VC_ENGINE === 'sqlite' ? sqliteEngine() : fakeEngine;
}
