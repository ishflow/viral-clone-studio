// Every HTTP call in this file goes to a scripted fetch, except the block "Node's own fetch", which talks to a
// server of its own on 127.0.0.1. Nothing leaves this machine; the key is made up.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { GeneratorError } from '../ports.ts';
import type { ClipRequest, Generator, ImageRequest, PaidRequest } from '../ports.ts';
import { MAX_DOWNLOAD_BYTES, createMagnific, createMagnificFromEnv } from './magnific.ts';

const started = vi.hoisted(() => ({ processes: [] as string[] }));
vi.mock('node:child_process', () => {
  const refuse = (name: string) => (): never => { started.processes.push(name); throw new Error(`${name}: this client starts no process`); };
  const all = { spawn: refuse('spawn'), spawnSync: refuse('spawnSync'), exec: refuse('exec'), execSync: refuse('execSync'),
    execFile: refuse('execFile'), execFileSync: refuse('execFileSync'), fork: refuse('fork') };
  return { ...all, default: all };
});

// A guard for this file: if any path used the real fetch, it fails here instead of reaching the network.
const realFetch = globalThis.fetch;
const guard = (): never => { throw new Error('the real fetch must not be used in a test'); };
vi.stubGlobal('fetch', guard);

const API = 'https://api.magnific.com';
const KEY = 'test-key-0123456789-made-up';
const RESULT_URL = 'https://cdn.example/out/task-1.bin?token=RESULT-TOKEN';
const RESULT = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 9, 9]);

interface Call { method: string; url: string; headers: Record<string, string>; body: unknown; redirect: string | undefined; bytes: number | null }
type Reply = Error | ((call: Call, signal: AbortSignal | null) => Response | Promise<Response>);
interface Script {
  slot?: Reply;       // the answer to the request for an upload address
  put?: Reply;        // the answer to the PUT of a reference file
  submit?: Reply;     // the answer to the paid POST
  polls?: Reply[];    // the answers to the task GETs, in order; after them the task stays IN_PROGRESS
  result?: Reply | Reply[];   // the answer to the download; a list is used in order, then the file arrives
  ready?: Reply;      // the answer to the free listing
}

const json = (body: unknown, status = 200): Reply => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body: string, status = 200): Reply => () => new Response(body, { status });
const task = (status: string, more: Record<string, unknown> = {}): unknown =>
  ({ data: { task_id: 'task-1', status, generated: [], error: null, ...more } });
const completed = (): Reply => json(task('COMPLETED', { generated: [RESULT_URL] }));
/** Never answers; gives up only when the request's own time limit fires. */
const hangs: Reply = (_call, signal) => new Promise<Response>((_, reject) => {
  if (signal === null) throw new Error('the request has no time limit');
  signal.addEventListener('abort', () => reject(signal.reason));
});

function give(reply: Reply, call: Call, signal: AbortSignal | null): Promise<Response> {
  if (reply instanceof Error) return Promise.reject(reply);
  return Promise.resolve(reply(call, signal));
}

function stage(script: Script = {}) {
  const calls: Call[] = [];
  const events: string[] = [];
  const polls = [...(script.polls ?? [])];
  const results = Array.isArray(script.result) ? [...script.result] : null;
  let slots = 0;
  const fetcher = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    // a JSON body arrives as a stream that can be read once: read it here, as a server would
    const sent = init.body instanceof ReadableStream ? await new Response(init.body).text() : init.body ?? null;
    const body = typeof sent === 'string' ? JSON.parse(sent) as unknown : sent;
    const call = { method, url, headers, body, redirect: init.redirect, bytes: typeof sent === 'string' ? Buffer.byteLength(sent) : null };
    calls.push(call);
    events.push(`${method} ${url.startsWith(API) ? url.slice(API.length) : url}`);
    const signal = init.signal ?? null;
    if (url === `${API}/v1/ai/uploads/request-url` && method === 'POST') {
      const n = slots++;
      const type = (body as { files: { content_type: string }[] }).files[0]!.content_type;
      return give(script.slot ?? json({ files: [{
        upload_url: `https://storage.example/put/${n}?sig=SIGNED-PUT-${n}`,
        asset_url: `https://assets.example/ref/${n}?token=ASSET-TOKEN-${n}`,
        headers: { 'Content-Type': type, 'x-goog-content-length-range': '0,1073741824' },
      }] }), call, signal);
    }
    if (url.startsWith('https://storage.example/') && method === 'PUT') return give(script.put ?? text('', 200), call, signal);
    if (url.startsWith('https://cdn.example/') && method === 'GET') {
      const file: Reply = () => new Response(RESULT);
      return give(results === null ? (script.result as Reply | undefined) ?? file : results.shift() ?? file, call, signal);
    }
    if (url === `${API}/v1/ai/uploads` && method === 'GET') return give(script.ready ?? json({ files: [] }), call, signal);
    if (url.startsWith(`${API}/`) && method === 'POST') return give(script.submit ?? json(task('CREATED')), call, signal);
    if (url.startsWith(`${API}/`) && method === 'GET') return give(polls.shift() ?? json(task('IN_PROGRESS')), call, signal);
    throw new Error(`the test did not expect ${method} ${url}`);
  };
  return { fetch: fetcher as typeof fetch, calls, events };
}

/** The client on a scripted provider: polls every 1000 ms without really waiting, gives a task 5000 ms. */
function client(script: Script = {}, options: { requestTimeoutMs?: number; pollMs?: number; taskTimeoutMs?: number; pollRefusedMs?: number; maxDownloadBytes?: number } = {}) {
  const { fetch, calls, events } = stage(script);
  const slept: number[] = [];
  const generator = createMagnific({
    apiKey: KEY, fetch, pollMs: 1000, taskTimeoutMs: 5000, requestTimeoutMs: 1000, ...options,
    sleep: async (ms) => { slept.push(ms); },
  });
  const tickets: string[] = [];
  const onSubmitted = (ticket: string): void => { tickets.push(ticket); events.push(`submitted ${ticket}`); };
  return { generator, calls, events, slept, tickets, onSubmitted };
}

async function caught(promise: Promise<unknown>): Promise<GeneratorError> {
  let result: unknown;
  try { result = await promise; } catch (error) {
    if (!(error instanceof GeneratorError)) throw error;
    return error;
  }
  throw new Error(`expected a GeneratorError, got ${JSON.stringify(result)}`);
}

const dir = mkdtempSync(join(tmpdir(), 'vc-magnific-'));
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const product = join(dir, 'product.png');
const photo = join(dir, 'photo.jpg');
const voiceSample = join(dir, 'voice.mp3');
writeFileSync(product, PNG);
writeFileSync(photo, new Uint8Array([255, 216, 255, 7]));
writeFileSync(voiceSample, new Uint8Array([73, 68, 51, 8]));
let outputs = 0;
const out = (name = 'out.bin'): string => join(dir, `o${outputs++}`, name);

const image: ImageRequest = { prompt: 'The tube on a bathroom shelf', references: [product], aspect: '9:16' };
const clip: ClipRequest = { mode: 'first-frame', firstFrame: product, prompt: 'slow push in', seconds: 4, tier: { model: 'seedance-2-mini', resolution: '720p' } };
const speaker: ClipRequest = { mode: 'speaker', presenter: product, voice: voiceSample, prompt: 'She says: hello', seconds: 8, tier: { model: 'seedance-2.5-pro', resolution: '1080p' }, aspect: '9:16' };
const music = { prompt: 'warm lo-fi bed' };
const MUSIC = '/v1/ai/music-generation/lyria-3';
const paidPosts = (calls: Call[]): Call[] => calls.filter((call) => call.method === 'POST' && !call.url.endsWith('/v1/ai/uploads/request-url'));
const gets = (calls: Call[]): Call[] => calls.filter((call) => call.method === 'GET');
const downloads = (calls: Call[]): Call[] => calls.filter((call) => call.url.startsWith('https://cdn.example/'));
const times = (count: number, reply: Reply): Reply[] => Array.from({ length: count }, () => reply);

afterEach(() => { vi.restoreAllMocks(); });

describe('money: a request that may have reached the provider is never sent twice', () => {
  it.each<[string, Reply]>([
    ['a network error', new TypeError('fetch failed')],
    ['an answer that is not JSON', text('<html>Bad gateway</html>')],
    ['an empty answer', text('')],
    ['JSON that is not an object', text('[]')],
    ['JSON null', text('null')],
    ['an answer without a task id', json({ data: { status: 'CREATED' } })],
    ['an answer without data', json({ message: 'ok' })],
    ['an empty task id', json({ data: { task_id: '', status: 'CREATED' } })],
    ['HTTP 500', json({ message: 'Internal error' }, 500)],
    ['HTTP 502 with a gateway page', text('<html>502</html>', 502)],
    ['HTTP 503', json({ message: 'Service Unavailable' }, 503)],
    ['HTTP 408', json({ message: 'Request Timeout' }, 408)],
    ['HTTP 302', text('', 302)],
  ])('%s on the submit → submission-unknown, one POST, nothing asked, no ticket', async (_what, reply) => {
    const { generator, calls, tickets, onSubmitted, slept } = client({ submit: reply });
    const error = await caught(generator.music(music, out(), onSubmitted));
    expect(error.code).toBe('submission-unknown');
    expect(error.ticket).toBeNull();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`POST ${API}${MUSIC}`]);
    expect(tickets).toEqual([]);
    expect(slept).toEqual([]);
  });

  it('a submit that gets no answer in time → submission-unknown, one POST', async () => {
    const { generator, calls, tickets, onSubmitted } = client({ submit: hangs }, { requestTimeoutMs: 30 });
    const error = await caught(generator.music(music, out(), onSubmitted));
    expect(error.code).toBe('submission-unknown');
    expect(calls.map((call) => call.method)).toEqual(['POST']);
    expect(tickets).toEqual([]);
  });

  it('with references: the uploads are made once and the paid POST once, also when its outcome is unknown', async () => {
    const { generator, calls, onSubmitted } = client({ submit: new TypeError('socket hang up') });
    const error = await caught(generator.image(image, out('a.png'), onSubmitted));
    expect(error.code).toBe('submission-unknown');
    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'POST']);
    expect(paidPosts(calls)).toHaveLength(1);
  });

  it.each([400, 401, 402, 403, 404, 422, 429])('HTTP %i on the submit → rejected: nothing was started, one POST', async (status) => {
    const { generator, calls, tickets, onSubmitted } = client({
      submit: json({ message: 'Validation error', invalid_params: [{ field: 'duration', reason: 'must be <= 15' }] }, status),
    });
    const error = await caught(generator.music(music, out(), onSubmitted));
    expect(error.code).toBe('rejected');
    expect(error.ticket).toBeNull();
    expect(error.message).toContain('Validation error');
    expect(error.message).toContain('must be <= 15');
    expect(calls).toHaveLength(1);
    expect(tickets).toEqual([]);
  });

  it('429, a network error, 500 and a broken answer while polling → polling goes on, no new POST', async () => {
    const { generator, calls, onSubmitted } = client({
      polls: [json({ message: 'Too many requests' }, 429), new TypeError('fetch failed'), json({ message: 'boom' }, 500), text('<html>'),
        json(task('IN_PROGRESS')), completed()],
    }, { taskTimeoutMs: 60_000 });
    const to = out('bed.mp3');
    await expect(generator.music(music, to, onSubmitted)).resolves.toEqual({ taskId: 'task-1', file: to });
    expect(paidPosts(calls)).toHaveLength(1);
    expect(calls.filter((call) => call.url === `${API}${MUSIC}/task-1`)).toHaveLength(6);
  });

  it('resume(ticket, to) sends only GETs and gives the file', async () => {
    const { generator, calls } = client({ polls: [json(task('IN_PROGRESS')), completed()] });
    const to = out('s1.mp4');
    await expect(generator.resume('/v1/ai/video/seedance-2-mini/task-9', to)).resolves.toEqual({ taskId: 'task-9', file: to });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${API}/v1/ai/video/seedance-2-mini/task-9`, `GET ${API}/v1/ai/video/seedance-2-mini/task-9`, `GET ${RESULT_URL}`,
    ]);
    expect(new Uint8Array(readFileSync(to))).toEqual(RESULT);
  });

  it('concurrent resumed downloads of one ticket have separate temporary files', async () => {
    const { generator } = client({ polls: [completed(), completed()] });
    const to = out('overlap.mp4');
    await expect(Promise.all([generator.resume(`${MUSIC}/task-1`, to), generator.resume(`${MUSIC}/task-1`, to)])).resolves.toHaveLength(2);
    expect(new Uint8Array(readFileSync(to))).toEqual(RESULT);
  });

  it('resume of a failed task and of a task that never finishes sends only GETs', async () => {
    const failed = client({ polls: [json(task('FAILED', { error: 'Content rejected' }))] });
    expect((await caught(failed.generator.resume(`${MUSIC}/task-1`, out()))).code).toBe('task-failed');
    expect(failed.calls.map((call) => call.method)).toEqual(['GET']);

    const endless = client();
    const error = await caught(endless.generator.resume(`${MUSIC}/task-1`, out()));
    expect(error.code).toBe('timeout');
    expect(error.ticket).toBe(`${MUSIC}/task-1`);
    expect(endless.calls.length).toBeGreaterThan(1);
    expect(endless.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('a request the provider cannot take is refused before anything is sent', async () => {
    const { generator, calls, onSubmitted } = client();
    const bad: ClipRequest[] = [
      { ...clip, tier: { model: 'veo-3', resolution: '720p' } },
      { ...clip, seconds: 3 },
      { ...clip, seconds: 4.5 },
      { ...speaker, tier: { model: 'kling-v3-pro', resolution: '1080p' } },
    ];
    for (const request of bad) expect((await caught(generator.clip(request, out(), onSubmitted))).code).toBe('rejected');
    const many = { ...image, references: Array.from({ length: 15 }, () => product) };
    expect((await caught(generator.image(many, out(), onSubmitted))).code).toBe('rejected');
    expect(calls).toEqual([]);
  });
});

describe('money: the key goes only to the API host, in the x-magnific-api-key header', () => {
  it('upload address, submit and poll carry it; the upload PUT and the download do not', async () => {
    const { generator, calls, onSubmitted } = client({ polls: [completed()] });
    await generator.image(image, out('a.png'), onSubmitted);
    expect(calls.map((call) => `${call.method} ${new URL(call.url).host}`)).toEqual([
      'POST api.magnific.com', 'PUT storage.example', 'POST api.magnific.com', 'GET api.magnific.com', 'GET cdn.example',
    ]);
    for (const call of calls) {
      const { 'x-magnific-api-key': header, ...others } = call.headers;
      const elsewhere = JSON.stringify([call.url, others, typeof call.body === 'string' || call.body instanceof Uint8Array ? null : call.body]);
      expect(elsewhere).not.toContain(KEY);
      expect(header).toBe(new URL(call.url).host === 'api.magnific.com' ? KEY : undefined);
      expect(others.authorization).toBeUndefined();
    }
  });

  it('an API answer that redirects is not followed: the key never reaches another host', async () => {
    const seen: string[] = [];
    // What a real fetch does with a 302 unless told otherwise: it repeats the request, headers included, at the new place.
    const fetcher = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const url = String(input);
      seen.push(url);
      if (!url.startsWith(API)) return new Response('{}');
      if (init.redirect === undefined || init.redirect === 'follow') return fetcher('https://elsewhere.example/steal', init);
      if (init.redirect === 'error') throw new TypeError('redirect refused');
      return new Response('', { status: 302, headers: { location: 'https://elsewhere.example/steal' } });
    };
    const generator = createMagnific({ apiKey: KEY, fetch: fetcher as typeof fetch, pollMs: 1, taskTimeoutMs: 3, sleep: async () => {} });
    expect((await caught(generator.music(music, out(), () => {}))).code).toBe('submission-unknown');
    expect((await caught(generator.resume(`${MUSIC}/task-1`, out()))).code).toBe('timeout');
    expect((await generator.ready()).ready).toBe(false);
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.filter((url) => !url.startsWith(API))).toEqual([]);
  });

  it.each([
    '//evil.example/v1/ai/x/1', '@evil.example/v1/ai/x/1', '.evil.example/v1/ai/x/1', 'https://evil.example/v1/ai/x/1',
    '/v1/ai/../../admin', '/v1/ai/%2e%2e/%2e%2e/admin', '/v1/ai/%2E%2E/%2E%2E/admin', '/v1/ai/x/./1', '/v1/ai/x/..', '/v1/ai/x/a.b',
    '/v1/ai/x/%2e', '/v1/ai/x/%ZZ', '/v1/ai/x/a%2', '/v1/ai/a.b/1', '/v1/ai/x', '/v1/ai/x/', '/v2/other/1', '/v1/ai/x/1?to=https://evil.example', '', 'task-1',
  ])('resume refuses the ticket %j before any request', async (ticket) => {
    const { generator, calls } = client();
    expect((await caught(generator.resume(ticket, out()))).code).toBe('submission-unknown');
    expect(calls).toEqual([]);
  });

  it('a base URL that is not HTTPS is refused when the client is made, unless it is this machine', () => {
    for (const baseUrl of ['http://api.magnific.com', 'http://127.0.0.1.evil.example', 'http://localhost.evil.example:8080', 'ftp://127.0.0.1']) {
      expect(() => createMagnific({ apiKey: KEY, baseUrl, fetch: stage().fetch })).toThrow();
    }
    for (const baseUrl of ['http://127.0.0.1:9', 'http://localhost:9', 'http://[::1]:9', 'https://api.magnific.com']) {
      expect(() => createMagnific({ apiKey: KEY, baseUrl, fetch: stage().fetch })).not.toThrow();
    }
  });

  it('no error text, and no ready() note, contains the key or a signed URL', async () => {
    const leak = `key ${KEY} at https://assets.example/ref/0?token=ASSET-TOKEN-0 and https://storage.example/put/0?sig=SIGNED-PUT-0`
      + ` and, as JSON writes it, https:\\/\\/assets.example\\/ref\\/1?token=ASSET-TOKEN-1`
      + ` and pieces of the key: ${KEY.slice(0, 12)} … ${KEY.slice(-9)} … ${KEY.slice(5, 13)}`;
    expect(leak).toContain('https:\\/\\/assets.example');
    const errors: unknown[] = [
      await caught(client({ submit: json({ message: leak }, 400) }).generator.music(music, out(), () => {})),
      await caught(client({ submit: text(leak, 400) }).generator.music(music, out(), () => {})),
      await caught(client({ submit: new TypeError(leak) }).generator.music(music, out(), () => {})),
      await caught(client({ submit: text(leak, 500) }).generator.music(music, out(), () => {})),
      await caught(client({ polls: [json(task('FAILED', { error: leak }))] }).generator.music(music, out(), () => {})),
      await caught(client({ polls: [json(task('FAILED', { error: { code: 'refused', message: leak } }))] }).generator.music(music, out(), () => {})),
      await caught(client({ polls: times(4, json(task('COMPLETED'))) }).generator.music(music, out(), () => {})),
      await caught(client({ polls: [completed()], result: text(leak, 403) }).generator.music(music, out(), () => {})),
      await caught(client({ polls: [completed()], result: new TypeError(leak) }).generator.music(music, out(), () => {})),
      await caught(client({ polls: [json({ message: leak }, 500)] }).generator.music(music, out(), () => {})),
      await caught(client({ slot: json({ message: leak }, 401) }).generator.image(image, out(), () => {})),
      await caught(client({ put: text(leak, 403) }).generator.image(image, out(), () => {})),
      await caught(client({ put: new TypeError(leak) }).generator.image(image, out(), () => {})),
      await client({ ready: json({ message: leak }, 401) }).generator.ready(),
      await client({ ready: new TypeError(leak) }).generator.ready(),
    ];
    expect(errors).toHaveLength(15);
    for (const error of errors) {
      const shown = `${inspect(error, { depth: 8 })}\n${JSON.stringify(error)}\n${error instanceof Error ? `${error.message}\n${error.stack}` : ''}`;
      expect(shown).not.toContain(KEY);
      expect(shown).not.toContain('TOKEN');
      expect(shown).not.toContain('SIGNED');
      expect(shown).not.toContain('https:');
      expect(shown).not.toContain('assets.example');
      for (let at = 0; at + 8 <= KEY.length; at++) expect(shown).not.toContain(KEY.slice(at, at + 8));   // no run of 8 key characters
    }
  });

  it('nothing is written to the console or to stdout / stderr', async () => {
    const spies = [
      ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {})),
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true),
    ];
    await client({ polls: [completed()] }).generator.image(image, out('a.png'), () => {});
    await caught(client({ submit: json({ message: 'no' }, 400) }).generator.music(music, out(), () => {}));
    await caught(client({ submit: new TypeError('fetch failed') }).generator.music(music, out(), () => {}));
    await caught(client({ polls: [json(task('FAILED', { error: 'no' }))] }).generator.music(music, out(), () => {}));
    await client({ ready: json({ message: 'no' }, 401) }).generator.ready();
    const written = spies.map((spy) => spy.mock.calls.length);
    vi.restoreAllMocks();
    expect(written).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('no child process is started and the key is not put into the environment', async () => {
    await client({ polls: [completed()] }).generator.image(image, out('a.png'), () => {});
    await client({ polls: [completed()] }).generator.clip(speaker, out('c.mp4'), () => {});
    await client().generator.ready();
    expect(started.processes).toEqual([]);
    expect(Object.values(process.env)).not.toContain(KEY);
    expect(JSON.stringify(process.env)).not.toContain(KEY);
  });
});

describe('the task', () => {
  it('onSubmitted is called once with the ticket, after the acceptance and before the first poll', async () => {
    const { generator, events, tickets, onSubmitted } = client({ polls: [json(task('IN_PROGRESS')), completed()] });
    await generator.music(music, out('bed.mp3'), onSubmitted);
    expect(tickets).toEqual([`${MUSIC}/task-1`]);
    expect(events).toEqual([
      `POST ${MUSIC}`, `submitted ${MUSIC}/task-1`, `GET ${MUSIC}/task-1`, `GET ${MUSIC}/task-1`, `GET ${RESULT_URL}`,
    ]);
  });

  it('CREATED → IN_PROGRESS → COMPLETED: the file is written where asked, in a folder that did not exist', async () => {
    const { generator, slept, onSubmitted } = client({ polls: [json(task('IN_PROGRESS')), completed()] });
    const to = join(dir, 'new', 'deep', 'bed.mp3');
    await expect(generator.music(music, to, onSubmitted)).resolves.toEqual({ taskId: 'task-1', file: to });
    expect(new Uint8Array(readFileSync(to))).toEqual(RESULT);
    expect(slept).toEqual([1000, 1000]);
  });

  it('a task that is already COMPLETED in the submit answer is downloaded without a poll', async () => {
    const { generator, events, onSubmitted } = client({ submit: completed() });
    const to = out('bed.mp3');
    await generator.music(music, to, onSubmitted);
    expect(events).toEqual([`POST ${MUSIC}`, `submitted ${MUSIC}/task-1`, `GET ${RESULT_URL}`]);
    expect(existsSync(to)).toBe(true);
  });

  it('an acceptance needs only the task id: a submit answer without a status still gives the ticket', async () => {
    const { generator, tickets, onSubmitted } = client({ submit: json({ data: { task_id: 'task-1' } }), polls: [completed()] });
    await generator.music(music, out('bed.mp3'), onSubmitted);
    expect(tickets).toEqual([`${MUSIC}/task-1`]);
  });

  it('the task id is escaped inside the ticket', async () => {
    const { generator, tickets, calls, onSubmitted } = client({
      submit: json({ data: { task_id: 'a/b c', status: 'CREATED' } }), polls: [completed()],
    });
    await expect(generator.music(music, out(), onSubmitted)).resolves.toMatchObject({ taskId: 'a/b c' });
    expect(tickets).toEqual([`${MUSIC}/a%2Fb%20c`]);
    expect(gets(calls)[0]!.url).toBe(`${API}${MUSIC}/a%2Fb%20c`);
  });

  it.each<[string, string, string]>([
    ['a dot', '.', '%2E'],
    ['two dots', '..', '%2E%2E'],
    ['punctuation that encodeURIComponent leaves alone', "a!b*c'(d)", 'a%21b%2Ac%27%28d%29'],
    ['a slash and a space', 'a/b c', 'a%2Fb%20c'],
    ['dots and a tilde inside', 'v1.task~7', 'v1%2Etask%7E7'],
    ['letters outside ASCII', 'görev-ü', 'g%C3%B6rev-%C3%BC'],
    ['a percent sign', '100%', '100%25'],
    ['only letters, digits, dash and underscore', 'A-b_9', 'A-b_9'],
  ])('a task id with %s: the ticket of the submit is accepted by resume, which asks at the same address', async (_what, id, segment) => {
    const first = client({ submit: json({ data: { task_id: id, status: 'CREATED' } }), polls: [completed()] });
    await expect(first.generator.music(music, out(), first.onSubmitted)).resolves.toMatchObject({ taskId: id });
    expect(first.tickets).toEqual([`${MUSIC}/${segment}`]);

    const later = client({ polls: [completed()] });
    const to = out();
    await expect(later.generator.resume(first.tickets[0]!, to)).resolves.toEqual({ taskId: id, file: to });
    expect(gets(first.calls)[0]!.url).toBe(`${API}${MUSIC}/${segment}`);
    expect(gets(later.calls)[0]!.url).toBe(`${API}${MUSIC}/${segment}`);
  });

  it('a very long task id makes the same round trip', async () => {
    const id = 'x.'.repeat(3000);
    const first = client({ submit: json({ data: { task_id: id, status: 'CREATED' } }), polls: [completed()] });
    await first.generator.music(music, out(), first.onSubmitted);
    const later = client({ polls: [completed()] });
    await expect(later.generator.resume(first.tickets[0]!, out())).resolves.toMatchObject({ taskId: id });
    expect(gets(later.calls)[0]!.url).toBe(gets(first.calls)[0]!.url);
  });

  it('onSubmitted throws → submission-unknown with the ticket, and the task is not asked for', async () => {
    const { generator, calls } = client({ polls: [completed()] });
    const to = out();
    const error = await caught(generator.music(music, to, () => { throw new Error('database is locked'); }));
    expect(error.code).toBe('submission-unknown');
    expect(error.ticket).toBe(`${MUSIC}/task-1`);
    expect(error.message).toContain('database is locked');
    expect(calls.map((call) => call.method)).toEqual(['POST']);
    expect(existsSync(to)).toBe(false);
  });

  it.each<[string, unknown, string]>([
    ['a text', 'Content rejected by the safety filter', 'Content rejected by the safety filter'],
    ['an object', { code: 'nsfw', message: 'Blocked content' }, 'Blocked content'],
  ])('FAILED with %s as the reason → task-failed with that reason and the ticket', async (_what, reason, shown) => {
    const { generator, onSubmitted, calls } = client({ polls: [json(task('FAILED', { error: reason }))] });
    const to = out();
    const error = await caught(generator.music(music, to, onSubmitted));
    expect(error.code).toBe('task-failed');
    expect(error.message).toContain(shown);
    expect(error.ticket).toBe(`${MUSIC}/task-1`);
    expect(existsSync(to)).toBe(false);
    expect(paidPosts(calls)).toHaveLength(1);
  });

  it('the status ERROR is a failed task too', async () => {
    const { generator, onSubmitted } = client({ polls: [json(task('ERROR', { error: 'broken' }))] });
    expect((await caught(generator.music(music, out(), onSubmitted))).code).toBe('task-failed');
  });

  it.each<[string, Record<string, unknown>]>([
    ['an empty list', { generated: [] }],
    ['no list', { generated: null }],
    ['something that is not an address', { generated: [42] }],
    ['an address that is not HTTPS', { generated: ['ftp://cdn.example/out'] }],
  ])('COMPLETED with %s, four times in a row → empty-result with the ticket, no download', async (_what, more) => {
    const { generator, calls, slept, onSubmitted } = client({ polls: times(4, json(task('COMPLETED', more))) }, { taskTimeoutMs: 60_000 });
    const error = await caught(generator.music(music, out(), onSubmitted));
    expect(error.code).toBe('empty-result');
    expect(error.ticket).toBe(`${MUSIC}/task-1`);
    expect(gets(calls)).toHaveLength(4);                       // the first answer and three more questions
    expect(slept).toEqual([1000, 1000, 1000, 1000]);           // at the normal pace
    expect(calls.filter((call) => !call.url.startsWith(API))).toEqual([]);
  });

  it('COMPLETED without an address three times, then with one → the file is fetched', async () => {
    const { generator, calls, onSubmitted } = client({ polls: [...times(3, json(task('COMPLETED'))), completed()] }, { taskTimeoutMs: 60_000 });
    const to = out('bed.mp3');
    await expect(generator.music(music, to, onSubmitted)).resolves.toEqual({ taskId: 'task-1', file: to });
    expect(gets(calls).filter((call) => call.url.startsWith(API))).toHaveLength(4);
    expect(new Uint8Array(readFileSync(to))).toEqual(RESULT);
  });

  it('not finished within taskTimeoutMs → timeout with the ticket, after waiting that long, no new POST', async () => {
    const { generator, calls, slept, onSubmitted } = client();
    const error = await caught(generator.music(music, out(), onSubmitted));
    expect(error.code).toBe('timeout');
    expect(error.ticket).toBe(`${MUSIC}/task-1`);
    expect(slept).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(gets(calls)).toHaveLength(5);
    expect(paidPosts(calls)).toHaveLength(1);
  });

  it('a poll that gets no answer counts its own time limit towards the timeout', async () => {
    const { generator, calls, onSubmitted } = client({ polls: [hangs, hangs, hangs, hangs, hangs, hangs, hangs, hangs, hangs, hangs] },
      { pollMs: 10, requestTimeoutMs: 40, taskTimeoutMs: 100 });
    const error = await caught(generator.music(music, out(), onSubmitted));
    expect(error.code).toBe('timeout');
    expect(gets(calls)).toHaveLength(2);
  });

  it.each<[string, Reply]>([
    ['HTTP 403', text('expired', 403)],
    ['a network error', new TypeError('fetch failed')],
    ['an empty file', () => new Response(new Uint8Array(0))],
    ['an HTML page with status 200', () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })],
    ['a JSON error with status 200', () => new Response('{"message":"expired"}', { headers: { 'content-type': 'Application/JSON' } })],
  ])('the download answers %s on all three tries → download-failed with the ticket, no file; resume then fetches it', async (_what, reply) => {
    const { generator, calls, slept, onSubmitted } = client({ polls: [completed()], result: reply });
    const to = out('s1.mp4');
    const error = await caught(generator.music(music, to, onSubmitted));
    expect(error.code).toBe('download-failed');
    expect(error.ticket).toBe(`${MUSIC}/task-1`);
    expect(existsSync(to)).toBe(false);
    expect(downloads(calls)).toHaveLength(3);
    expect(slept).toEqual([1000, 1000, 2000]);                 // one poll wait, then a short wait before the second and the third try
    expect(downloads(calls).every((call) => call.headers['x-magnific-api-key'] === undefined)).toBe(true);

    const later = client({ polls: [completed()] });
    await later.generator.resume(error.ticket!, to);
    expect(new Uint8Array(readFileSync(to))).toEqual(RESULT);
    expect(later.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it.each<[string, Reply]>([
    ['a body past the limit', () => new Response(new Uint8Array(40))],
    ['a declared length past the limit', () => new Response(RESULT, { headers: { 'content-length': '999999' } })],
  ])('SEC2 Minor 7: %s is not kept: download-failed with the ticket after one try, no file, no .part', async (_what, reply) => {
    const { generator, calls, onSubmitted } = client({ polls: [completed()], result: reply }, { maxDownloadBytes: 20 });
    const to = out('big.mp4');
    const error = await caught(generator.music(music, to, onSubmitted));
    expect(error.code).toBe('download-failed');
    expect(error.ticket).toBe(`${MUSIC}/task-1`);
    expect(error.message).toContain('size limit');
    expect(downloads(calls)).toHaveLength(1);                  // the same file would be as big again
    expect(existsSync(to)).toBe(false);
    expect(existsSync(`${to}.part`)).toBe(false);
  });
  it('SEC2 Minor 7: a file exactly at the limit arrives; the default limit is a named number', async () => {
    const { generator, onSubmitted } = client({ polls: [completed()] }, { maxDownloadBytes: RESULT.length });
    const to = out('edge.mp4');
    await expect(generator.music(music, to, onSubmitted)).resolves.toEqual({ taskId: 'task-1', file: to });
    expect(MAX_DOWNLOAD_BYTES).toBeGreaterThanOrEqual(100 * 1024 * 1024);
  });

  it('a download that fails twice and then arrives is kept: three tries, one file', async () => {
    const { generator, calls, onSubmitted } = client({ polls: [completed()], result: [text('busy', 503), new TypeError('fetch failed')] });
    const to = out('s1.mp4');
    await expect(generator.music(music, to, onSubmitted)).resolves.toEqual({ taskId: 'task-1', file: to });
    expect(downloads(calls)).toHaveLength(3);
    expect(new Uint8Array(readFileSync(to))).toEqual(RESULT);
  });
});

describe('requests on the wire', () => {
  it('image: the reference is uploaded, then nano-banana-pro gets the asset address and its type', async () => {
    const { generator, calls, tickets, onSubmitted } = client({ polls: [completed()] });
    const to = out('a.png');
    await expect(generator.image({ ...image, references: [product, photo] }, to, onSubmitted)).resolves.toEqual({ taskId: 'task-1', file: to });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${API}/v1/ai/uploads/request-url`, 'PUT https://storage.example/put/0?sig=SIGNED-PUT-0',
      `POST ${API}/v1/ai/uploads/request-url`, 'PUT https://storage.example/put/1?sig=SIGNED-PUT-1',
      `POST ${API}/v1/ai/text-to-image/nano-banana-pro`,
      `GET ${API}/v1/ai/text-to-image/nano-banana-pro/task-1`, `GET ${RESULT_URL}`,
    ]);
    expect(calls[0]!.body).toEqual({ files: [{ content_type: 'image/png' }] });
    expect(calls[2]!.body).toEqual({ files: [{ content_type: 'image/jpeg' }] });
    expect(calls[4]!.body).toEqual({
      prompt: 'The tube on a bathroom shelf', aspect_ratio: '9:16', num_images: 1,
      reference_images: [
        { image: 'https://assets.example/ref/0?token=ASSET-TOKEN-0', mime_type: 'image/png' },
        { image: 'https://assets.example/ref/1?token=ASSET-TOKEN-1', mime_type: 'image/jpeg' },
      ],
    });
    expect(tickets).toEqual(['/v1/ai/text-to-image/nano-banana-pro/task-1']);
  });

  it('every POST states the length of its body, so it is not sent in chunks', async () => {
    const { generator, calls, onSubmitted } = client({ polls: [completed()] });
    await generator.image(image, out('a.png'), onSubmitted);
    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(post.bytes).toBeGreaterThan(10);
      expect(post.headers['content-length']).toBe(String(post.bytes));
    }
  });

  it('a reference named twice in one request is uploaded once', async () => {
    const { generator, calls, onSubmitted } = client({ polls: [completed()] });
    await generator.image({ ...image, references: [product, photo, product] }, out('a.png'), onSubmitted);
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
    const body = paidPosts(calls)[0]!.body as { reference_images: { image: string }[] };
    expect(body.reference_images.map((reference) => reference.image)).toEqual([
      'https://assets.example/ref/0?token=ASSET-TOKEN-0', 'https://assets.example/ref/1?token=ASSET-TOKEN-1', 'https://assets.example/ref/0?token=ASSET-TOKEN-0',
    ]);
  });

  it('the upload PUT sends the file bytes with the signed headers and the file type, nothing else', async () => {
    const { generator, calls, onSubmitted } = client({ polls: [completed()] });
    await generator.image(image, out('a.png'), onSubmitted);
    const put = calls.find((call) => call.method === 'PUT')!;
    expect(put.headers).toEqual({ 'content-type': 'image/png', 'x-goog-content-length-range': '0,1073741824' });
    expect(new Uint8Array(put.body as Uint8Array)).toEqual(PNG);
  });

  it('the upload address is also read from data.files', async () => {
    const { generator, calls, onSubmitted } = client({
      slot: json({ data: { files: [{ upload_url: 'https://storage.example/put/7?sig=SIGNED-PUT-7', asset_url: 'https://assets.example/ref/7?token=ASSET-TOKEN-7' }] } }),
      polls: [completed()],
    });
    await generator.clip(clip, out('s1.mp4'), onSubmitted);
    expect(paidPosts(calls)[0]!.body).toMatchObject({ image: 'https://assets.example/ref/7?token=ASSET-TOKEN-7' });
  });

  it('clip from a first frame: the Seedance route of the tier, asked for without the resolution', async () => {
    const { generator, calls, tickets, onSubmitted } = client({ polls: [completed()] });
    await generator.clip(clip, out('s1.mp4'), onSubmitted);
    const [submit] = paidPosts(calls);
    expect(submit!.url).toBe(`${API}/v1/ai/video/seedance-2-mini-720p`);
    expect(submit!.body).toEqual({
      prompt: 'slow push in', image: 'https://assets.example/ref/0?token=ASSET-TOKEN-0', duration: 4, sound_effects: false,
    });
    expect(tickets).toEqual(['/v1/ai/video/seedance-2-mini/task-1']);
    expect(gets(calls)[0]!.url).toBe(`${API}/v1/ai/video/seedance-2-mini/task-1`);
  });

  it('speaker clip: the presenter and the voice sample are uploaded; Seedance 2.5 is asked for per resolution', async () => {
    const { generator, calls, tickets, onSubmitted } = client({ polls: [completed()] });
    await generator.clip(speaker, out('seg1.mp4'), onSubmitted);
    expect(calls.filter((call) => call.url.endsWith('/request-url')).map((call) => call.body)).toEqual([
      { files: [{ content_type: 'image/png' }] }, { files: [{ content_type: 'audio/mpeg' }] },
    ]);
    const [submit] = paidPosts(calls);
    expect(submit!.url).toBe(`${API}/v1/ai/video/seedance-2-5-pro-1080p`);
    expect(submit!.body).toEqual({
      prompt: 'She says: hello', reference_images: ['https://assets.example/ref/0?token=ASSET-TOKEN-0'],
      reference_audios: ['https://assets.example/ref/1?token=ASSET-TOKEN-1'],
      duration: 8, aspect_ratio: 'social_story_9_16', sound_effects: true, no_music: true,
    });
    expect(tickets).toEqual(['/v1/ai/video/seedance-2-5-pro-1080p/task-1']);
  });

  it('clip on a Kling tier: its own route and body, asked for at kling-v3', async () => {
    const { generator, calls, tickets, onSubmitted } = client({ polls: [completed()] });
    await generator.clip({ ...clip, tier: { model: 'kling-v3-pro', resolution: '1080p' } }, out('s1.mp4'), onSubmitted);
    const [submit] = paidPosts(calls);
    expect(submit!.url).toBe(`${API}/v1/ai/video/kling-v3-pro`);
    expect(submit!.body).toEqual({
      prompt: 'slow push in', start_image_url: 'https://assets.example/ref/0?token=ASSET-TOKEN-0', aspect_ratio: '9:16',
      duration: '4', generate_audio: false, cfg_scale: 0.5,
    });
    expect(tickets).toEqual(['/v1/ai/video/kling-v3/task-1']);
  });

  it('music and voice: their routes and bodies, no upload', async () => {
    const bed = client({ polls: [completed()] });
    await bed.generator.music(music, out('bed.mp3'), bed.onSubmitted);
    expect(bed.calls[0]).toMatchObject({ method: 'POST', url: `${API}${MUSIC}`, body: { prompt: 'warm lo-fi bed', model: 'clip' } });

    const say = client({ polls: [completed()] });
    await say.generator.voice({ text: 'I tried it for a week.', voiceId: 'voice-abc' }, out('voice.mp3'), say.onSubmitted);
    expect(say.calls[0]).toMatchObject({
      method: 'POST', url: `${API}/v1/ai/voiceover/elevenlabs-turbo-v2-5`,
      body: { text: 'I tried it for a week.', voice_id: 'voice-abc' },
    });
    expect(say.tickets).toEqual(['/v1/ai/voiceover/elevenlabs-turbo-v2-5/task-1']);
  });

  it('a paid POST is JSON with the key header; requests go to baseUrl when one is given', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetcher = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      seen.push({ url: String(input), headers: Object.fromEntries(new Headers(init.headers).entries()) });
      return new Response(JSON.stringify(task('CREATED')));
    };
    const other = createMagnific({ apiKey: KEY, fetch: fetcher as typeof fetch, baseUrl: 'https://magnific.internal.example/', pollMs: 1, taskTimeoutMs: 1, sleep: async () => {} });
    expect((await caught(other.music(music, out(), () => {}))).code).toBe('timeout');
    expect(seen.map((call) => call.url)).toEqual([
      'https://magnific.internal.example/v1/ai/music-generation/lyria-3', 'https://magnific.internal.example/v1/ai/music-generation/lyria-3/task-1',
    ]);
    expect(seen[0]!.headers).toMatchObject({ 'content-type': 'application/json', 'x-magnific-api-key': KEY });
  });
});

describe('uploads fail before anything is paid for', () => {
  it.each<[string, Script]>([
    ['the address request is refused', { slot: json({ message: 'Unauthorized' }, 401) }],
    ['the address request gets no answer', { slot: new TypeError('fetch failed') }],
    ['the answer has no address', { slot: json({ files: [] }) }],
    ['the answer has an address that is not HTTPS', { slot: json({ files: [{ upload_url: 'http://storage.example/put/0', asset_url: 'https://assets.example/ref/0' }] }) }],
    ['the PUT is refused', { put: text('SignatureDoesNotMatch', 403) }],
    ['the PUT gets no answer', { put: new TypeError('fetch failed') }],
  ])('%s → upload-failed, no paid POST', async (_what, script) => {
    const { generator, calls, tickets, onSubmitted } = client(script);
    const error = await caught(generator.clip(clip, out('s1.mp4'), onSubmitted));
    expect(error.code).toBe('upload-failed');
    expect(error.ticket).toBeNull();
    expect(paidPosts(calls)).toEqual([]);
    expect(tickets).toEqual([]);
  });

  it.each<[string, ClipRequest]>([
    ['a file that does not exist', { ...clip, firstFrame: join(dir, 'missing.png') }],
    ['a file of a type the provider does not take', { ...clip, firstFrame: join(dir, 'frame.gif') }],
    ['an audio file where an image is needed', { ...clip, firstFrame: voiceSample }],
    ['an image where the voice sample is needed', { ...speaker, voice: product }],
  ])('%s → upload-failed, nothing sent at all', async (_what, request) => {
    const { generator, calls, onSubmitted } = client();
    expect((await caught(generator.clip(request, out('s1.mp4'), onSubmitted))).code).toBe('upload-failed');
    expect(calls).toEqual([]);
  });
});

describe('not configured, ready', () => {
  it('without a key every method rejects with not-configured and nothing is sent', async () => {
    const { fetch, calls } = stage();
    const generator: Generator = createMagnific({ apiKey: '', fetch });
    const attempts = [
      generator.image(image, out(), () => {}), generator.clip(clip, out(), () => {}), generator.music(music, out(), () => {}),
      generator.voice({ text: 'hi', voiceId: 'v' }, out(), () => {}), generator.resume(`${MUSIC}/task-1`, out()),
    ];
    for (const attempt of attempts) expect((await caught(attempt)).code).toBe('not-configured');
    expect(await generator.ready()).toEqual({ ready: false, note: expect.stringContaining('MAGNIFIC_API_KEY') });
    expect(calls).toEqual([]);
  });

  it('a client made with no apiKey at all, or with white space, is not configured either', async () => {
    for (const options of [{}, { apiKey: ' \n' }]) {
      const { fetch, calls } = stage();
      const generator = createMagnific({ ...options, fetch });
      expect((await caught(generator.music(music, out(), () => {}))).code).toBe('not-configured');
      expect((await generator.ready()).ready).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it('ready() asks the free listing once, with a GET', async () => {
    const { generator, calls } = client();
    expect(await generator.ready()).toEqual({ ready: true, note: null });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`GET ${API}/v1/ai/uploads`]);
    expect(calls[0]!.headers['x-magnific-api-key']).toBe(KEY);
  });

  it.each<[string, Reply]>([
    ['the key is refused', json({ message: 'Invalid API key' }, 401)],
    ['there is no answer', new TypeError('fetch failed')],
  ])('ready() says not ready when %s, without throwing', async (_what, reply) => {
    const { generator, calls } = client({ ready: reply });
    const answer = await generator.ready();
    expect(answer.ready).toBe(false);
    expect(typeof answer.note).toBe('string');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('createMagnificFromEnv takes the key from MAGNIFIC_API_KEY of the given environment', async () => {
    const without = stage();
    const none = createMagnificFromEnv({ fetch: without.fetch }, {});
    expect((await caught(none.music(music, out(), () => {}))).code).toBe('not-configured');
    expect(without.calls).toEqual([]);

    const set = stage();
    const some = createMagnificFromEnv({ fetch: set.fetch }, { MAGNIFIC_API_KEY: 'key-from-the-environment' });
    expect(await some.ready()).toEqual({ ready: true, note: null });
    expect(set.calls[0]!.headers['x-magnific-api-key']).toBe('key-from-the-environment');
  });

  it('createMagnificFromEnv drops white space around the key; a key of white space only is no key', async () => {
    const padded = stage();
    await createMagnificFromEnv({ fetch: padded.fetch }, { MAGNIFIC_API_KEY: '  key-from-a-file\n' }).ready();
    expect(padded.calls[0]!.headers['x-magnific-api-key']).toBe('key-from-a-file');

    const blank = stage();
    const none = createMagnificFromEnv({ fetch: blank.fetch }, { MAGNIFIC_API_KEY: ' \n' });
    expect((await caught(none.music(music, out(), () => {}))).code).toBe('not-configured');
    expect(blank.calls).toEqual([]);
  });
});

describe('a poll that is refused for good ends the wait early', () => {
  const notFound = json({ message: 'Task not found' }, 404);
  const long = { pollMs: 5000, taskTimeoutMs: 1_800_000 };

  it('24 refusals in a row at the default pace (2 minutes) → timeout with the ticket, naming the status; no new POST', async () => {
    const { generator, calls, slept, onSubmitted } = client({ polls: times(60, notFound) }, long);
    const error = await caught(generator.music(music, out(), onSubmitted));
    expect(error.code).toBe('timeout');
    expect(error.ticket).toBe(`${MUSIC}/task-1`);
    expect(error.message).toContain('404');
    expect(error.message).toContain('Task not found');
    expect(gets(calls)).toHaveLength(24);
    expect(slept).toHaveLength(24);
    expect(paidPosts(calls)).toHaveLength(1);
  });

  it.each([400, 401, 403, 404, 410])('HTTP %i counts as a refusal', async (status) => {
    const { generator, calls, onSubmitted } = client({ polls: times(60, json({ message: 'no' }, status)) }, long);
    expect((await caught(generator.music(music, out(), onSubmitted))).code).toBe('timeout');
    expect(gets(calls)).toHaveLength(24);
  });

  it('the number of refusals follows pollMs and pollRefusedMs', async () => {
    const quick = client({ polls: times(200, notFound) }, { pollMs: 1000, taskTimeoutMs: 1_800_000 });
    await caught(quick.generator.music(music, out(), quick.onSubmitted));
    expect(gets(quick.calls)).toHaveLength(120);

    const short = client({ polls: times(200, notFound) }, { pollMs: 1000, taskTimeoutMs: 1_800_000, pollRefusedMs: 3000 });
    await caught(short.generator.music(music, out(), short.onSubmitted));
    expect(gets(short.calls)).toHaveLength(3);
  });

  it.each<[string, Reply]>([
    ['a task answer', json(task('IN_PROGRESS'))],
    ['HTTP 500', json({ message: 'boom' }, 500)],
    ['HTTP 429', json({ message: 'slow down' }, 429)],
    ['HTTP 408', json({ message: 'timeout' }, 408)],
    ['a network error', new TypeError('fetch failed')],
  ])('%s between refusals starts the count again', async (_what, between) => {
    const { generator, calls, onSubmitted } = client({ polls: [...times(23, notFound), between, ...times(23, notFound), completed()] }, long);
    const to = out('bed.mp3');
    await expect(generator.music(music, to, onSubmitted)).resolves.toEqual({ taskId: 'task-1', file: to });
    expect(gets(calls).filter((call) => call.url.startsWith(API))).toHaveLength(48);
  });

  it.each<[string, Reply]>([
    ['HTTP 408', json({ message: 'timeout' }, 408)],
    ['HTTP 429', json({ message: 'slow down' }, 429)],
    ['HTTP 500', json({ message: 'boom' }, 500)],
    ['HTTP 503', text('<html>503</html>', 503)],
    ['a network error', new TypeError('fetch failed')],
    ['an answer that is not a task', text('<html>ok</html>')],
  ])('never ends early on %s: 100 of them, then the task completes', async (_what, reply) => {
    const { generator, calls, onSubmitted } = client({ polls: [...times(100, reply), completed()] }, long);
    const to = out('bed.mp3');
    await expect(generator.music(music, to, onSubmitted)).resolves.toEqual({ taskId: 'task-1', file: to });
    expect(gets(calls).filter((call) => call.url.startsWith(API))).toHaveLength(101);
  });

  it('resume ends the same way, with GETs only', async () => {
    const { generator, calls } = client({ polls: times(60, json({ message: 'Invalid API key' }, 401)) }, long);
    const error = await caught(generator.resume(`${MUSIC}/task-1`, out()));
    expect(error.code).toBe('timeout');
    expect(error.ticket).toBe(`${MUSIC}/task-1`);
    expect(error.message).toContain('401');
    expect(calls.map((call) => call.method)).toEqual(Array.from({ length: 24 }, () => 'GET'));
  });
});

describe('refusal: free, local, about the request only', () => {
  const refused: [string, PaidRequest][] = [
    ['an unknown model', { kind: 'clip', request: { ...clip, tier: { model: 'veo-3', resolution: '720p' } } }],
    ['a resolution the model has no route for', { kind: 'clip', request: { ...clip, tier: { model: 'seedance-2-mini', resolution: '1080p' } } }],
    ['seconds below the range', { kind: 'clip', request: { ...clip, seconds: 3 } }],
    ['seconds above the range', { kind: 'clip', request: { ...clip, seconds: 16 } }],
    ['seconds that are not whole', { kind: 'clip', request: { ...clip, seconds: 4.5 } }],
    ['more than 14 references', { kind: 'image', request: { ...image, references: Array.from({ length: 15 }, () => product) } }],
    ['a ratio without a name', { kind: 'clip', request: { ...speaker, aspect: '5:4' } }],
    ['a speaker clip on Kling', { kind: 'clip', request: { ...speaker, tier: { model: 'kling-v3-pro', resolution: '1080p' } } }],
  ];
  const accepted: PaidRequest[] = [
    { kind: 'image', request: { prompt: 'x', references: ['/nowhere/a.png', '/nowhere/b.gif'], aspect: '9:16' } },
    { kind: 'clip', request: { ...clip, firstFrame: '/nowhere/frame.png' } },
    { kind: 'clip', request: speaker },
    { kind: 'music', request: music },
    { kind: 'voice', request: { text: 'hi', voiceId: 'v' } },
  ];

  it.each(refused)('%s → the reason; nothing is sent; the method refuses with rejected and that reason', async (_what, paid) => {
    const { generator, calls, tickets, onSubmitted } = client();
    const reason = generator.refusal(paid);
    expect(typeof reason).toBe('string');
    expect(reason!.length).toBeGreaterThan(10);
    const error = await caught(paid.kind === 'image' ? generator.image(paid.request, out(), onSubmitted)
      : paid.kind === 'clip' ? generator.clip(paid.request, out(), onSubmitted)
        : paid.kind === 'music' ? generator.music(paid.request, out(), onSubmitted) : generator.voice(paid.request, out(), onSubmitted));
    expect(error.code).toBe('rejected');
    expect(error.message).toContain(reason);
    expect(calls).toEqual([]);
    expect(tickets).toEqual([]);
  });

  it('a request that would be sent → null; files are not looked at', () => {
    const { generator, calls } = client();
    for (const paid of accepted) expect(generator.refusal(paid)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('without a key the answers are the same: a refusal is about the request, not the key', () => {
    const { fetch, calls } = stage();
    const keyless = createMagnific({ apiKey: '', fetch });
    for (const paid of accepted) expect(keyless.refusal(paid)).toBeNull();
    for (const [, paid] of refused) expect(keyless.refusal(paid)).toBe(client().generator.refusal(paid));
    expect(calls).toEqual([]);
  });
});

describe("Node's own fetch against a server on 127.0.0.1 (the only real requests in this file; none leaves the machine)", () => {
  interface Seen { method: string; url: string; key: string | undefined; length: string | undefined; encoding: string | undefined; body: string }
  const seen: Seen[] = [];
  const accepted = JSON.stringify({ data: { task_id: 't-1', status: 'CREATED', generated: [] } });
  const failed = JSON.stringify({ data: { task_id: 't-1', status: 'FAILED', generated: [], error: 'Content rejected' } });
  // The first part of the path says how this server behaves; the client is given it as its base URL.
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    request.on('end', () => {
      const url = request.url ?? '';
      const key = request.headers['x-magnific-api-key'];
      seen.push({ method: request.method ?? '', url, key: Array.isArray(key) ? key.join() : key,
        length: request.headers['content-length'], encoding: request.headers['transfer-encoding'], body });
      const answer = (status: number, text: string): void => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(text); };
      if (url.startsWith('/misdirected/')) answer(421, '{"message":"Misdirected Request"}');
      else if (url.startsWith('/reset/')) request.socket.destroy();
      else if (url.startsWith('/hang/')) { /* no answer at all */ }
      else if (request.method === 'POST') answer(200, accepted);
      else answer(200, failed);
    });
  });
  let origin = '';
  beforeAll(async () => {
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubGlobal('fetch', realFetch);
  });
  afterAll(() => {
    vi.stubGlobal('fetch', guard);
    server.closeAllConnections();
    server.close();
  });
  /** No `fetch` option: the client uses the global one, as it does in the worker. */
  const real = (behaviour: string) => createMagnific({ apiKey: KEY, baseUrl: `${origin}/${behaviour}`, requestTimeoutMs: 400, pollMs: 5, taskTimeoutMs: 200 });
  const posts = (behaviour: string): Seen[] => seen.filter((request) => request.method === 'POST' && request.url.startsWith(`/${behaviour}/`));

  it('a submit answered with HTTP 421 reaches the server once', async () => {
    const error = await caught(real('misdirected').music(music, out(), () => {}));
    expect(error.code).toBe('rejected');
    expect((error as { status?: number }).status).toBe(421);                  // the status travels with the refusal (402 = no credits left)
    expect(posts('misdirected')).toHaveLength(1);
  });

  it('a submit whose connection is reset reaches the server once → submission-unknown', async () => {
    const error = await caught(real('reset').music(music, out(), () => {}));
    expect(error.code).toBe('submission-unknown');
    expect(posts('reset')).toHaveLength(1);
  });

  it('a submit that gets no answer is cut by the request timeout, reaches the server once → submission-unknown', async () => {
    const error = await caught(real('hang').music(music, out(), () => {}));
    expect(error.code).toBe('submission-unknown');
    await new Promise((resolve) => { setTimeout(resolve, 150); });   // time for a repeat to arrive, if there were one
    expect(posts('hang')).toHaveLength(1);
  });

  it('the body arrives whole, with its length and the key, and the task is then asked for with a GET', async () => {
    const tickets: string[] = [];
    const error = await caught(real('fine').music(music, out(), (ticket) => { tickets.push(ticket); }));
    expect(error.code).toBe('task-failed');
    expect(error.message).toContain('Content rejected');
    expect(tickets).toEqual([`${MUSIC}/t-1`]);
    const requests = seen.filter((request) => request.url.startsWith('/fine/'));
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([`POST /fine${MUSIC}`, `GET /fine${MUSIC}/t-1`]);
    const [post, get] = requests;
    expect(JSON.parse(post!.body)).toEqual({ prompt: 'warm lo-fi bed', model: 'clip' });
    expect(post!.length).toBe(String(Buffer.byteLength(post!.body)));
    expect(post!.encoding).toBeUndefined();
    expect([post!.key, get!.key]).toEqual([KEY, KEY]);
  });
});

describe('the guard of this file', () => {
  it('the global fetch throws outside the loopback block', () => {
    expect(() => fetch('https://api.magnific.com/')).toThrow('the real fetch must not be used in a test');
  });
});
