import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { z } from 'zod';
import { GeneratorError, LlmInvalid, invalidCode } from '../ports.ts';
import type {
  CheckIssue, ClipRequest, Clock, ContactSheet, Cuts, Downloader, Generated, Generator, GeneratorErrorCode, ImageRequest, Llm, Media, MediaFacts,
  MusicRequest, OnSubmitted, PaidRequest, RenderCall, Renderer, Shorts, ShortsWant, TopAds, Transcriber, VoiceRequest, Word,
} from '../ports.ts';

// Rules for every fake here: it records each call in `calls` (before it answers), is scripted by plain data
// (answers and errors in order, or by key), has no timers, and an unscripted call throws UnscriptedCall.

export class UnscriptedCall extends Error {
  constructor(message: string) { super(message); this.name = 'UnscriptedCall'; }
}

/** An answer, or an Error that is thrown instead. */
export type Step<T> = T | Error;
/** Answers in order (`queue`, each used once) and/or by key (`by`, reusable; looked up first). A bare array is a queue. */
export type Scripted<T> = Step<T>[] | { by?: Record<string, Step<T>>; queue?: Step<T>[] };

class Script<T> {
  private by: Record<string, Step<T>>;
  private queue: Step<T>[];
  private name: string;
  constructor(name: string, init: Scripted<T> = []) {
    this.name = name;
    const o = Array.isArray(init) ? { queue: init } : init;
    this.by = o.by ?? {};
    this.queue = [...(o.queue ?? [])];
  }
  next(key?: string): T {
    let step: Step<T>;
    if (key !== undefined && Object.hasOwn(this.by, key)) step = this.by[key]!;
    else if (this.queue.length > 0) step = this.queue.shift()!;
    else throw new UnscriptedCall(`${this.name}: no scripted answer${key !== undefined ? ` for ${JSON.stringify(key)}` : ''}`);
    if (step instanceof Error) throw step;
    return step;
  }
}

function put(file: string, content: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// ── Generator ──
export type GeneratorKind = 'image' | 'clip' | 'music' | 'voice';
export interface GeneratorAnswer { taskId?: string; ticket?: string; content?: string }   // content: what is written to `to`
export interface GeneratorCall {
  kind: GeneratorKind | 'resume' | 'ready' | 'refusal';
  n: number;                                   // 1-based, per kind
  request: ImageRequest | ClipRequest | MusicRequest | VoiceRequest | PaidRequest | null;   // refusal: the PaidRequest it was asked about
  ticket: string | null;                       // resume only
  to: string;
}
export interface FakeGeneratorOptions {
  answers?: Partial<Record<GeneratorKind, GeneratorAnswer>>;                                // every call of the kind succeeds with this
  errors?: Partial<Record<GeneratorKind, Record<number, GeneratorErrorCode | GeneratorError>>>;   // the Nth call (1-based) of the kind fails; wins over `answers`
  resumes?: Record<string, GeneratorAnswer | GeneratorErrorCode | GeneratorError>;          // by ticket
  refusals?: Partial<Record<GeneratorKind, Record<number, string>>>;                         // the Nth refusal question (1-based) about a request of the kind gets this reason; all others get null
  onCall?: (call: GeneratorCall) => void | Promise<void>;                                    // runs at the moment of each call, before it answers
  ready?: { ready: boolean; note: string | null };
  writeFiles?: boolean;                                                                      // default true: `to` gets a small file
}
/** Errors that mean "the provider had accepted the request": the ticket exists and onSubmitted has been called. */
const AFTER_SUBMIT: GeneratorErrorCode[] = ['task-failed', 'empty-result', 'timeout', 'download-failed'];

export class FakeGenerator implements Generator {
  calls: GeneratorCall[] = [];
  private counts: Record<string, number> = {};
  private options: FakeGeneratorOptions;
  constructor(options: FakeGeneratorOptions = {}) { this.options = options; }

  private async enter(kind: GeneratorKind | 'resume' | 'ready', request: GeneratorCall['request'], ticket: string | null, to: string): Promise<GeneratorCall> {
    const n = (this.counts[kind] = (this.counts[kind] ?? 0) + 1);
    const call: GeneratorCall = { kind, n, request, ticket, to };
    this.calls.push(call);
    await this.options.onCall?.(call);
    return call;
  }
  private fail(e: GeneratorErrorCode | GeneratorError, ticket: string): GeneratorError {
    if (e instanceof GeneratorError) return e;
    return new GeneratorError(e, `fake ${e}`, AFTER_SUBMIT.includes(e) ? ticket : null);
  }
  private finish(kind: string, n: number, answer: GeneratorAnswer, to: string): Generated {
    if (this.options.writeFiles !== false) put(to, answer.content ?? `fake ${kind} ${n}`);
    return { taskId: answer.taskId ?? `fake-task-${kind}-${n}`, file: to };
  }
  private async submit(kind: GeneratorKind, request: GeneratorCall['request'], to: string, onSubmitted: OnSubmitted): Promise<Generated> {
    const { n } = await this.enter(kind, request, null, to);
    const ticket = this.options.answers?.[kind]?.ticket ?? `fake-ticket-${kind}-${n}`;
    const scripted = this.options.errors?.[kind]?.[n];
    if (scripted !== undefined) {
      const err = this.fail(scripted, ticket);
      if (err.ticket !== null) onSubmitted(err.ticket);
      throw err;
    }
    const answer = this.options.answers?.[kind];
    if (!answer) throw new UnscriptedCall(`FakeGenerator.${kind}: no answer scripted (call ${n})`);
    onSubmitted(ticket);
    return this.finish(kind, n, answer, to);
  }

  /** Never an UnscriptedCall: unscripted means "would be accepted". It answers at once, so the hook is called but not awaited. */
  refusal(request: PaidRequest): string | null {
    const n = (this.counts.refusal = (this.counts.refusal ?? 0) + 1);
    const call: GeneratorCall = { kind: 'refusal', n, request, ticket: null, to: '' };
    this.calls.push(call);
    void this.options.onCall?.(call);
    const asked = (this.counts[`refusal:${request.kind}`] = (this.counts[`refusal:${request.kind}`] ?? 0) + 1);
    return this.options.refusals?.[request.kind]?.[asked] ?? null;
  }
  image(request: ImageRequest, to: string, onSubmitted: OnSubmitted) { return this.submit('image', request, to, onSubmitted); }
  clip(request: ClipRequest, to: string, onSubmitted: OnSubmitted) { return this.submit('clip', request, to, onSubmitted); }
  music(request: MusicRequest, to: string, onSubmitted: OnSubmitted) { return this.submit('music', request, to, onSubmitted); }
  voice(request: VoiceRequest, to: string, onSubmitted: OnSubmitted) { return this.submit('voice', request, to, onSubmitted); }
  async resume(ticket: string, to: string): Promise<Generated> {
    const { n } = await this.enter('resume', null, ticket, to);
    const scripted = this.options.resumes && Object.hasOwn(this.options.resumes, ticket) ? this.options.resumes[ticket] : undefined;
    if (scripted === undefined) throw new UnscriptedCall(`FakeGenerator.resume: no answer scripted for ticket ${JSON.stringify(ticket)}`);
    if (typeof scripted === 'string' || scripted instanceof GeneratorError) throw this.fail(scripted, ticket);
    return this.finish('resume', n, scripted, to);
  }
  async ready() {
    await this.enter('ready', null, null, '');
    if (!this.options.ready) throw new UnscriptedCall('FakeGenerator.ready: not scripted');
    return this.options.ready;
  }
}

// ── Renderer ──
export interface RenderAnswer { facts: MediaFacts; content?: string }                   // content: written to `to` only when given
export interface FakeRendererOptions {
  checks?: Scripted<{ ok: boolean; issues: CheckIssue[] }>;                             // key: dir
  renders?: Scripted<RenderAnswer>;                                                     // key: dir
  ready?: { ready: boolean; note: string | null };
}
export class FakeRenderer implements Renderer {
  calls: ({ kind: 'check'; dir: string } | { kind: 'render'; dir: string; to: string; progress: { frame: number; frames: number }[] } | { kind: 'ready' })[] = [];
  private checks: Script<{ ok: boolean; issues: CheckIssue[] }>;
  private renders: Script<RenderAnswer>;
  private options: FakeRendererOptions;
  constructor(options: FakeRendererOptions = {}) {
    this.options = options;
    this.checks = new Script('FakeRenderer.check', options.checks);
    this.renders = new Script('FakeRenderer.render', options.renders);
  }
  async check(dir: string) {
    this.calls.push({ kind: 'check', dir });
    return this.checks.next(dir);
  }
  async render(dir: string, to: string, onProgress: (p: { frame: number; frames: number }) => void, _options?: RenderCall): Promise<MediaFacts> {
    const call = { kind: 'render' as const, dir, to, progress: [] as { frame: number; frames: number }[] };
    this.calls.push(call);
    const answer = this.renders.next(dir);
    // it reports the frames it was asked to render
    const p = { frame: answer.facts.frames, frames: answer.facts.frames };
    call.progress.push(p);
    onProgress(p);
    if (answer.content !== undefined) put(to, answer.content);
    return answer.facts;
  }
  async ready() {
    this.calls.push({ kind: 'ready' });
    if (!this.options.ready) throw new UnscriptedCall('FakeRenderer.ready: not scripted');
    return this.options.ready;
  }
}

// ── Transcriber ──
export class FakeTranscriber implements Transcriber {
  calls: { media: string; language: string }[] = [];
  private script: Script<Word[]>;
  constructor(answers?: Scripted<Word[]>) { this.script = new Script('FakeTranscriber.words', answers); }   // key: media
  async words(media: string, language: string) {
    this.calls.push({ media, language });
    return this.script.next(media);
  }
}

// ── Media ──
export interface FakeMediaOptions {
  probes?: Scripted<MediaFacts>;                          // key: file
  normalizes?: Scripted<MediaFacts>;                      // key: file (the source)
  stills?: Scripted<true>;                                // key: file
  sheets?: Scripted<{ seconds: number[] }>;               // key: file
  trims?: Scripted<MediaFacts>;                           // key: file (the source)
  cuts?: Scripted<number[] | Cuts>;                       // key: file; a plain list is the hard cuts of a video without faint ones
  writeFiles?: boolean;                                   // default false: the output file is written only when true
}
export class FakeMedia implements Media {
  calls: (
    | { kind: 'probe'; file: string }
    | { kind: 'normalize'; file: string; to: string; target: { width: number; height: number; fps: number; audio: boolean } }
    | { kind: 'still'; file: string; second: number; to: string }
    | { kind: 'sheet'; file: string; to: string; grid: Parameters<ContactSheet>[2] }
    | { kind: 'trim'; file: string; from: number; to: number; out: string }
    | { kind: 'cuts'; file: string }
  )[] = [];
  private probes: Script<MediaFacts>;
  private normalizes: Script<MediaFacts>;
  private stills: Script<true>;
  private sheets: Script<{ seconds: number[] }>;
  private trims: Script<MediaFacts>;
  private cutLists: Script<number[] | Cuts>;
  private options: FakeMediaOptions;
  constructor(options: FakeMediaOptions = {}) {
    this.options = options;
    this.probes = new Script('FakeMedia.probe', options.probes);
    this.normalizes = new Script('FakeMedia.normalize', options.normalizes);
    this.stills = new Script('FakeMedia.still', options.stills);
    this.sheets = new Script('FakeMedia.sheet', options.sheets);
    this.trims = new Script('FakeMedia.trim', options.trims);
    this.cutLists = new Script('FakeMedia.cuts', options.cuts);
  }
  private out(to: string) { if (this.options.writeFiles) put(to, 'fake media'); }
  async probe(file: string) { this.calls.push({ kind: 'probe', file }); return this.probes.next(file); }
  async normalize(file: string, to: string, target: { width: number; height: number; fps: number; audio: boolean }) {
    this.calls.push({ kind: 'normalize', file, to, target });
    const facts = this.normalizes.next(file);
    this.out(to);
    return facts;
  }
  async still(file: string, second: number, to: string) {
    this.calls.push({ kind: 'still', file, second, to });
    this.stills.next(file);
    this.out(to);
  }
  sheet: ContactSheet = async (media, to, grid) => {
    this.calls.push({ kind: 'sheet', file: media, to, grid });
    const r = this.sheets.next(media);
    this.out(to);
    return r;
  };
  async trim(file: string, from: number, to: number, out: string) {
    this.calls.push({ kind: 'trim', file, from, to, out });
    const facts = this.trims.next(file);
    this.out(out);
    return facts;
  }
  async cuts(file: string) {
    this.calls.push({ kind: 'cuts', file });
    const cuts = this.cutLists.next(file);
    return Array.isArray(cuts) ? { seconds: cuts, faint: [] } : cuts;
  }
}

// ── Llm ──
export class FakeLlm implements Llm {
  calls: { prompt: string; files: string[]; schema: z.ZodType<unknown> }[] = [];
  private script: Script<unknown>;
  constructor(answers?: Scripted<unknown>) { this.script = new Script('FakeLlm.run', answers); }   // key: the prompt
  async run<T>(request: { prompt: string; files: string[]; schema: z.ZodType<T> }): Promise<T> {
    this.calls.push(request);
    const answer = this.script.next(request.prompt);
    const parsed = request.schema.safeParse(answer);      // like the real one: the answer must satisfy the caller's schema
    if (!parsed.success) throw new LlmInvalid(`scripted answer does not match the schema: ${parsed.error.message}`, invalidCode(request.schema, parsed.error));
    return parsed.data;
  }
}

// ── Downloader, TopAds, Shorts ──
export class FakeDownloader implements Downloader {
  calls: { url: string; toDir: string }[] = [];
  private script: Script<Awaited<ReturnType<Downloader['video']>>>;
  constructor(answers?: Scripted<Awaited<ReturnType<Downloader['video']>>>) { this.script = new Script('FakeDownloader.video', answers); }   // key: url
  async video(url: string, toDir: string) {
    this.calls.push({ url, toDir });
    return this.script.next(url);
  }
}
export class FakeTopAds implements TopAds {
  calls: { limit: number }[] = [];
  private script: Script<Awaited<ReturnType<TopAds['cards']>>>;
  constructor(answers?: Scripted<Awaited<ReturnType<TopAds['cards']>>>) { this.script = new Script('FakeTopAds.cards', answers); }
  async cards(limit: number) { this.calls.push({ limit }); return this.script.next(); }
}
export class FakeShorts implements Shorts {
  calls: { query: string; want: ShortsWant | undefined }[] = [];
  private script: Script<Awaited<ReturnType<Shorts['search']>>>;
  constructor(answers?: Scripted<Awaited<ReturnType<Shorts['search']>>>) { this.script = new Script('FakeShorts.search', answers); }   // key: query
  async search(query: string, want?: ShortsWant) { this.calls.push({ query, want }); return this.script.next(query); }
}

// ── Clock ──
export class FakeClock implements Clock {
  calls: Date[] = [];
  private t: number;
  constructor(start: Date | string | number = '2026-01-01T00:00:00.000Z') { this.t = new Date(start).getTime(); }
  set(to: Date | string | number) { this.t = new Date(to).getTime(); }
  advance(ms: number) { this.t += ms; }
  now(): Date { const d = new Date(this.t); this.calls.push(d); return new Date(this.t); }
}
