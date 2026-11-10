import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GeneratorError, LlmInvalid, RenderError } from '../ports.ts';
import type { ClipRequest, MediaFacts } from '../ports.ts';
import { FakeClock, FakeDownloader, FakeGenerator, FakeLlm, FakeMedia, FakeRenderer, FakeShorts, FakeTopAds, FakeTranscriber, UnscriptedCall } from './fakes.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 've-fakes-'));
const clip: ClipRequest = { mode: 'first-frame', firstFrame: '/a.jpg', prompt: 'p', seconds: 4, tier: { model: 'm', resolution: '720p' } };
const facts: MediaFacts = { width: 720, height: 1280, fps: 30, frames: 90, seconds: 3, audio: true };

describe('FakeGenerator', () => {
  it('answers per kind, writes the file, calls onSubmitted with the ticket, records calls', async () => {
    const d = tmp();
    const g = new FakeGenerator({ answers: { image: { content: 'IMG' }, clip: {} } });
    const tickets: string[] = [];
    const r = await g.image({ prompt: 'x', references: [], aspect: '9:16' }, join(d, 'a/i.png'), (t) => tickets.push(t));
    expect(r).toEqual({ taskId: 'fake-task-image-1', file: join(d, 'a/i.png') });
    expect(readFileSync(r.file, 'utf8')).toBe('IMG');
    await g.clip(clip, join(d, 'c.mp4'), (t) => tickets.push(t));
    expect(tickets).toEqual(['fake-ticket-image-1', 'fake-ticket-clip-1']);
    expect(g.calls.map((c) => [c.kind, c.n])).toEqual([['image', 1], ['clip', 1]]);
    expect(g.calls[1]!.request).toBe(clip);
  });
  it('an unscripted kind is an error, and the call is still recorded', async () => {
    const g = new FakeGenerator({ answers: { image: {} } });
    await expect(g.music({ prompt: 'm' }, join(tmp(), 'm.mp3'), () => {})).rejects.toBeInstanceOf(UnscriptedCall);
    await expect(g.ready()).rejects.toBeInstanceOf(UnscriptedCall);
    expect(g.calls.map((c) => c.kind)).toEqual(['music', 'ready']);
  });
  it('fails the Nth call of a kind; post-submit errors carry the ticket and call onSubmitted, pre-submit ones do not', async () => {
    const g = new FakeGenerator({ answers: { clip: {} }, errors: { clip: { 2: 'task-failed', 3: 'rejected' } } });
    const d = tmp();
    const sent: string[] = [];
    await g.clip(clip, join(d, '1.mp4'), (t) => sent.push(t));
    const e2 = await g.clip(clip, join(d, '2.mp4'), (t) => sent.push(t)).catch((e) => e);
    expect(e2).toBeInstanceOf(GeneratorError);
    expect(e2).toMatchObject({ code: 'task-failed', ticket: 'fake-ticket-clip-2' });
    const e3 = await g.clip(clip, join(d, '3.mp4'), (t) => sent.push(t)).catch((e) => e);
    expect(e3).toMatchObject({ code: 'rejected', ticket: null });
    expect(sent).toEqual(['fake-ticket-clip-1', 'fake-ticket-clip-2']);
    expect(existsSync(join(d, '2.mp4'))).toBe(false);
  });
  it('the hook runs at the moment of the call, before onSubmitted and before the file exists', async () => {
    const d = tmp();
    const seen: string[] = [];
    const g = new FakeGenerator({
      answers: { voice: {} },
      onCall: (c) => { seen.push(`hook:${c.kind}:${existsSync(c.to)}`); },
    });
    await g.voice({ text: 't', voiceId: 'v' }, join(d, 'v.mp3'), () => seen.push('submitted'));
    expect(seen).toEqual(['hook:voice:false', 'submitted']);
  });
  it('resume answers by ticket only; an unknown ticket is an error; errors by code', async () => {
    const d = tmp();
    const g = new FakeGenerator({ resumes: { T1: { taskId: 'task-1', content: 'X' }, T2: 'timeout' } });
    const r = await g.resume('T1', join(d, 'r.mp4'));
    expect(r.taskId).toBe('task-1');
    expect(readFileSync(r.file, 'utf8')).toBe('X');
    await expect(g.resume('T2', join(d, 'r2.mp4'))).rejects.toMatchObject({ code: 'timeout', ticket: 'T2' });
    await expect(g.resume('T3', join(d, 'r3.mp4'))).rejects.toBeInstanceOf(UnscriptedCall);
    expect(g.calls.map((c) => c.ticket)).toEqual(['T1', 'T2', 'T3']);
  });
  it('writeFiles:false writes nothing', async () => {
    const d = tmp();
    const g = new FakeGenerator({ answers: { image: {} }, writeFiles: false });
    await g.image({ prompt: 'x', references: [], aspect: '9:16' }, join(d, 'i.png'), () => {});
    expect(existsSync(join(d, 'i.png'))).toBe(false);
  });
  it('ready is scripted', async () => {
    expect(await new FakeGenerator({ ready: { ready: false, note: 'no key' } }).ready()).toEqual({ ready: false, note: 'no key' });
  });
  it('refusal answers null when nothing is scripted (no UnscriptedCall), and the call is recorded with its request', () => {
    const seen: string[] = [];
    const g = new FakeGenerator({ onCall: (c) => { seen.push(`hook:${c.kind}:${c.n}`); } });
    const paid = { kind: 'clip' as const, request: clip };
    expect(g.refusal(paid)).toBeNull();
    expect(g.refusal({ kind: 'music', request: { prompt: 'm' } })).toBeNull();
    expect(g.calls).toEqual([
      { kind: 'refusal', n: 1, request: paid, ticket: null, to: '' },
      { kind: 'refusal', n: 2, request: { kind: 'music', request: { prompt: 'm' } }, ticket: null, to: '' },
    ]);
    expect(g.calls[0]!.request).toBe(paid);
    expect(seen).toEqual(['hook:refusal:1', 'hook:refusal:2']);
  });
  it('refusal answers the scripted reason for the Nth question about a kind; every other question gets null', () => {
    const g = new FakeGenerator({ refusals: { clip: { 2: 'seedance-2-mini takes 4 to 15 whole seconds, not 3' } } });
    const paid = { kind: 'clip' as const, request: clip };
    expect(g.refusal(paid)).toBeNull();
    expect(g.refusal({ kind: 'image', request: { prompt: 'x', references: [], aspect: '9:16' } })).toBeNull();
    expect(g.refusal(paid)).toBe('seedance-2-mini takes 4 to 15 whole seconds, not 3');
    expect(g.refusal(paid)).toBeNull();
    expect(g.calls.map((c) => [c.kind, c.n])).toEqual([['refusal', 1], ['refusal', 2], ['refusal', 3], ['refusal', 4]]);
  });
  it('asking for a refusal does not count as a call of the kind: the first clip is still clip 1', async () => {
    const g = new FakeGenerator({ answers: { clip: {} }, errors: { clip: { 1: 'rejected' } } });
    expect(g.refusal({ kind: 'clip', request: clip })).toBeNull();
    await expect(g.clip(clip, join(tmp(), 'c.mp4'), () => {})).rejects.toMatchObject({ code: 'rejected' });
    expect(g.calls.map((c) => [c.kind, c.n])).toEqual([['refusal', 1], ['clip', 1]]);
  });
});

describe('FakeRenderer', () => {
  it('reports the frames it was asked to render and writes nothing unless told to', async () => {
    const d = tmp();
    const r = new FakeRenderer({ renders: [{ facts }, { facts, content: 'mp4' }] });
    const seen: { frame: number; frames: number }[] = [];
    expect(await r.render('/c', join(d, 'a.mp4'), (p) => seen.push(p))).toBe(facts);
    expect(seen).toEqual([{ frame: 90, frames: 90 }]);
    expect(existsSync(join(d, 'a.mp4'))).toBe(false);
    await r.render('/c', join(d, 'b.mp4'), () => {});
    expect(readFileSync(join(d, 'b.mp4'), 'utf8')).toBe('mp4');
    expect(r.calls.map((c) => c.kind)).toEqual(['render', 'render']);
  });
  it('scripted check results and errors; unscripted calls throw', async () => {
    const r = new FakeRenderer({ checks: { by: { '/bad': { ok: false, issues: [{ code: 'x', message: 'm', target: null, second: 1 }] } }, queue: [{ ok: true, issues: [] }] }, renders: [new RenderError('boom')] });
    expect((await r.check('/bad')).ok).toBe(false);
    expect((await r.check('/other')).ok).toBe(true);
    await expect(r.check('/third')).rejects.toBeInstanceOf(UnscriptedCall);
    await expect(r.render('/c', '/x.mp4', () => {})).rejects.toBeInstanceOf(RenderError);
    await expect(r.ready()).rejects.toBeInstanceOf(UnscriptedCall);
    expect(r.calls).toHaveLength(5);
  });
});

describe('FakeTranscriber / FakeMedia / FakeLlm / FakeDownloader / lists', () => {
  it('transcriber: by media, then queue; records language', async () => {
    const t = new FakeTranscriber({ by: { '/a.mp4': [{ text: 'hi', start: 0, end: 1 }] }, queue: [new Error('whisper broke')] });
    expect(await t.words('/a.mp4', 'en')).toEqual([{ text: 'hi', start: 0, end: 1 }]);
    await expect(t.words('/b.mp4', 'ru')).rejects.toThrow('whisper broke');
    await expect(t.words('/c.mp4', 'ru')).rejects.toBeInstanceOf(UnscriptedCall);
    expect(t.calls.map((c) => c.language)).toEqual(['en', 'ru', 'ru']);
  });
  it('media: scripted per method, writes outputs only when asked', async () => {
    const d = tmp();
    const m = new FakeMedia({ probes: { by: { '/v.mp4': facts } }, normalizes: [facts], stills: [true], sheets: [{ seconds: [1, 2] }], cuts: { by: { '/v.mp4': [1.7, 2.7] } }, writeFiles: true });
    expect(await m.probe('/v.mp4')).toBe(facts);
    await m.normalize('/v.mp4', join(d, 'n.mp4'), { width: 720, height: 1280, fps: 30, audio: true });
    await m.still('/v.mp4', 1, join(d, 'p.jpg'));
    expect(await m.sheet('/v.mp4', join(d, 's.jpg'), { columns: 2, rows: 1, labels: true, at: [1, 2] })).toEqual({ seconds: [1, 2] });
    expect(await m.cuts('/v.mp4')).toEqual({ seconds: [1.7, 2.7], faint: [] });
    expect([existsSync(join(d, 'n.mp4')), existsSync(join(d, 'p.jpg')), existsSync(join(d, 's.jpg'))]).toEqual([true, true, true]);
    expect(m.calls.map((c) => c.kind)).toEqual(['probe', 'normalize', 'still', 'sheet', 'cuts']);
    expect(m.calls.slice(3)).toEqual([{ kind: 'sheet', file: '/v.mp4', to: join(d, 's.jpg'), grid: { columns: 2, rows: 1, labels: true, at: [1, 2] } }, { kind: 'cuts', file: '/v.mp4' }]);
    await expect(m.probe('/other.mp4')).rejects.toBeInstanceOf(UnscriptedCall);
    await expect(m.cuts('/other.mp4')).rejects.toBeInstanceOf(UnscriptedCall);
    const t = new FakeMedia({ trims: [facts], writeFiles: true });
    expect(await t.trim('/v.mp4', 1, 3, join(d, 't.mp4'))).toBe(facts);
    expect(existsSync(join(d, 't.mp4'))).toBe(true);
    expect(t.calls).toEqual([{ kind: 'trim', file: '/v.mp4', from: 1, to: 3, out: join(d, 't.mp4') }]);
    const quiet = new FakeMedia({ stills: [true] });
    await quiet.still('/v.mp4', 1, join(d, 'q.jpg'));
    expect(existsSync(join(d, 'q.jpg'))).toBe(false);
  });
  it('llm: validates the scripted answer with the caller schema; errors are thrown; calls recorded', async () => {
    const schema = z.object({ a: z.number() });
    const l = new FakeLlm([{ a: 1 }, { a: 'x' }, new LlmInvalid('twice')]);
    expect(await l.run({ prompt: 'p1', files: ['/f'], schema })).toEqual({ a: 1 });
    await expect(l.run({ prompt: 'p2', files: [], schema })).rejects.toBeInstanceOf(LlmInvalid);
    await expect(l.run({ prompt: 'p3', files: [], schema })).rejects.toThrow('twice');
    await expect(l.run({ prompt: 'p4', files: [], schema })).rejects.toBeInstanceOf(UnscriptedCall);
    expect(l.calls.map((c) => c.prompt)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(l.calls[0]!.files).toEqual(['/f']);
  });
  it('downloader, top ads, shorts: scripted, recorded, unscripted is an error', async () => {
    const info = { file: '/x.mp4', title: 't', seconds: 5, views: null, likes: null };
    const dl = new FakeDownloader({ by: { 'https://a': info } });
    expect(await dl.video('https://a', '/dir')).toBe(info);
    await expect(dl.video('https://b', '/dir')).rejects.toBeInstanceOf(UnscriptedCall);
    expect(dl.calls).toEqual([{ url: 'https://a', toDir: '/dir' }, { url: 'https://b', toDir: '/dir' }]);
    const ads = new FakeTopAds([[]]);
    expect(await ads.cards(5)).toEqual([]);
    await expect(ads.cards(5)).rejects.toBeInstanceOf(UnscriptedCall);
    const sh = new FakeShorts({ by: { q: [] } });
    expect(await sh.search('q')).toEqual([]);
    expect(sh.calls).toEqual([{ query: 'q', want: undefined }]);
  });
});

describe('FakeClock', () => {
  it('is set and advanced by the test only, and hands out copies', () => {
    const c = new FakeClock('2026-10-04T10:00:00.000Z');
    const a = c.now();
    expect(c.now().toISOString()).toBe('2026-10-04T10:00:00.000Z');
    c.advance(1500);
    expect(c.now().toISOString()).toBe('2026-10-04T10:00:01.500Z');
    c.set(new Date('2027-01-01T00:00:00Z'));
    expect(c.now().getUTCFullYear()).toBe(2027);
    a.setUTCFullYear(1999);
    expect(c.now().getUTCFullYear()).toBe(2027);
    expect(c.calls).toHaveLength(5);
  });
});
