// What the produce handler is built from, and the one call that joins its two halves (the money side and the picture side).
import type { DatabaseSync } from 'node:sqlite';
import type { RunRow } from '../db/runs.ts';
import type { Aligner, Clock, Generator, Llm, Measure, Media, Renderer, Transcriber } from '../ports.ts';
import type { TemplateJson } from '../template/schema.ts';
import type { Assembled, VariantMedia } from './types.ts';

export interface ProduceDeps {
  db: DatabaseSync;
  generator: Generator;
  renderer: Renderer;
  transcriber: Transcriber;
  media: Media;
  measure: Measure;
  llm: Llm;
  clock: Clock;
  aligner?: Aligner;                      // forced alignment, when the machine has it: handed to the picture side
  assemble?: Assemble;                    // the picture side; without it, ./assemble.ts
  sample?: Sample;                        // what a sample run does with its first variant; without it, ./sample.ts
  paidGate?: PaidGate;                    // the gate all runs of the worker share; without it, a run's own pool of 3 is the only limit
}

/** What `assemble` is given: the handler's parts, and `onRender` to call once, when the edit is checked and the render begins. */
export interface AssembleDeps extends Omit<ProduceDeps, 'assemble' | 'sample' | 'paidGate'> { onRender?: () => void }

/** At most so many paid requests in flight over all runs of the worker: a request waits here for its place, the rest in the order they came. */
export type PaidGate = <T>(call: () => Promise<T>) => Promise<T>;

/** The first variant of a sample run (paths under data/) becomes the template's own video and poster. */
export type Sample = (deps: { db: DatabaseSync; clock: Clock }, run: RunRow, variant: { video: string; image: string }) => void;

/** One variant with all its media → its video and poster. Called for one variant at a time. */
export type Assemble = (deps: AssembleDeps, run: RunRow, template: TemplateJson, media: VariantMedia) => Promise<Assembled>;
