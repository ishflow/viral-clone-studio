/**
 * The client for paid generation at Magnific (images, clips, music, voice), written on `fetch`.
 * The wire shapes are in `routes.ts`; the facts and their sources in docs/reference/magnific-notes.md.
 *
 * Money: the paid POST is sent once. Any outcome other than a parsed acceptance or an HTTP 4xx refusal
 * is `submission-unknown`: the request may exist and is not sent again. After the acceptance, and in
 * `resume`, only GETs are sent.
 * Key: it travels in the `x-magnific-api-key` header to the API host only. A redirect of an API call is
 * not followed. Upload and download addresses get no key. No message that leaves this file carries the
 * key or an address. Only structured spend metadata is logged; no process is started.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { relative, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { GeneratorError } from '../ports.ts';
import type { Generated, Generator, GeneratorErrorCode, OnSubmitted, PaidRequest } from '../ports.ts';
import { READY_PATH, UPLOAD_PATH, mimeOf, refusalOf, routeOf } from './routes.ts';
import type { Route, Uploaded } from './routes.ts';

export interface MagnificOptions {
  spendDir?: string;
  beforePaid?: (runId: string, units: number) => Date | void;   // answers the instant it charged, so a refusal after midnight gives back the day that was charged; throwing `provider-cap-required` (no caps are set) refuses the request with `not-configured`
  afterRefused?: (runId: string, units: number, chargedAt?: Date) => void;   // the provider refused the POST for good (HTTP 4xx, nothing started), or a reference failed to upload and the POST was never sent: the units `beforePaid` took go back
  apiKey?: string;                         // missing or blank: every paid method rejects with `not-configured`
  fetch?: typeof fetch;
  baseUrl?: string;                        // https://api.magnific.com (plain http only for this machine)
  pollMs?: number;                         // between two questions about a task: 5 s
  requestTimeoutMs?: number;               // one API call: 2 min
  taskTimeoutMs?: number;                  // one task, from its submit or from `resume`: 30 min
  pollRefusedMs?: number;                  // the question refused (4xx other than 408, 429) for this long in a row ends the wait: 2 min
  maxDownloadBytes?: number;               // one result file: MAX_DOWNLOAD_BYTES
  sleep?: (ms: number) => Promise<void>;
}

const TRANSFER_MS = 10 * 60_000;           // one upload or one download
/**
 * One result file, at most (SEC2 Minor 7). The longest thing asked for is a 1080p clip of 15 s (tens of MB); music and voice are a few
 * MB. 256 MB is far above that and far below a disk, so an address that serves something endless cannot fill it or the memory.
 */
export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const DOWNLOAD_TRIES = 3;
const DOWNLOAD_WAIT_MS = 1000;             // before the second try; twice that before the third
const EMPTY_ASKS = 3;                      // a COMPLETED task without an address is asked for this many more times
/** A ticket is the path a task is asked for at: `/v1/ai/<route>/<task id>`, the id written by `segmentOf`. */
const TICKET = /^\/v1\/ai(\/[A-Za-z0-9-]+)+\/(?:[A-Za-z0-9_-]|%[0-9A-F]{2})+$/;
const NO_KEY = 'MAGNIFIC_API_KEY is not set';
const NO_CAPS = 'VC_PROVIDER_DAILY_CAP and VC_PROVIDER_JOB_CAP are not set: no paid request is sent without a spending cap';

interface Answer { status: number; text: string }                                      // an HTTP answer that arrived
interface Task { id: string | null; status: string; generated: unknown; error: unknown }
/** One question about a task. spent: ms a lost question took · refused: answered by a 4xx that waiting does not cure. */
interface Asked { task: Task | null; note: string; spent: number; refused: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isHttps = (value: unknown): value is string => typeof value === 'string' && value.startsWith('https://');
const ok = (answer: Answer): boolean => answer.status >= 200 && answer.status <= 299;
const texts = (parts: unknown[]): string[] => parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '');

function objectOf(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch { return null; }
}

/** The task in an answer: HTTP 2xx and `{ data: { task_id, status, generated, error } }`. */
function taskOf(answer: Answer): Task | null {
  const data = ok(answer) ? objectOf(answer.text)?.data : undefined;
  if (!isRecord(data)) return null;
  return {
    id: typeof data.task_id === 'string' && data.task_id !== '' ? data.task_id : null,
    status: typeof data.status === 'string' ? data.status : '',
    generated: data.generated,
    error: data.error,
  };
}

/** What the provider says in an error answer: `message` and `invalid_params: [{ field, reason }]`, else the text itself. */
function reasonOf(text: string): string {
  const body = objectOf(text);
  const params = Array.isArray(body?.invalid_params) ? body.invalid_params : [];
  const said = texts([body?.message, ...params.map((param: unknown) => isRecord(param) ? texts([param.field, param.reason]).join(': ') : null)]);
  return said.join('; ') || text.trim();
}

/** Why a task failed: `error` is a text, or an object with `code` and `message` or `reason`. */
function failureOf(error: unknown): string {
  if (!isRecord(error)) return texts([error]).join('');
  return texts([error.code, error.message ?? error.reason]).join(': ');
}

/**
 * A task id as one path segment: every byte outside A–Z a–z 0–9 _ - is written %XX, dots too, so no id can
 * change the path and every ticket handed out is one `resume` accepts.
 */
function segmentOf(id: string): string {
  let segment = '';
  for (const byte of Buffer.from(id, 'utf8')) {
    const letter = String.fromCharCode(byte);
    segment += /[A-Za-z0-9_-]/.test(letter) ? letter : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return segment;
}

function idOf(ticket: string): string {
  const last = ticket.slice(ticket.lastIndexOf('/') + 1);
  try { return decodeURIComponent(last); } catch { return last; }
}

/** The text without the key, and without any 8 characters of the key in a row. */
function withoutKey(text: string, key: string): string {
  if (key.length < 8) return key === '' ? text : text.replaceAll(key, '[key]');
  const hidden = new Array<boolean>(text.length).fill(false);
  for (let at = 0; at + 8 <= key.length; at++) {
    const piece = key.slice(at, at + 8);
    for (let found = text.indexOf(piece); found >= 0; found = text.indexOf(piece, found + 1)) hidden.fill(true, found, found + 8);
  }
  let shown = '';
  for (let i = 0; i < text.length; i++) shown += !hidden[i] ? text[i] : hidden[i - 1] ? '' : '[key]';
  return shown;
}

/** The body of `response`, or null as soon as it is longer than `limit` (the rest is not read). */
async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { all.set(part, at); at += part.length; }
  return all;
}

export function createMagnific(options: MagnificOptions): Generator {
  const apiKey = (options.apiKey ?? '').trim();
  const send = options.fetch ?? fetch;
  const base = new URL(options.baseUrl ?? 'https://api.magnific.com');
  const thisMachine = base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !thisMachine) throw new Error('the Magnific base URL must be HTTPS');
  const root = base.href.replace(/\/+$/, '');
  const pollMs = options.pollMs ?? 5000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  const taskTimeoutMs = options.taskTimeoutMs ?? 30 * 60_000;
  const refusalLimit = Math.max(1, Math.ceil((options.pollRefusedMs ?? 120_000) / pollMs));   // questions refused in a row
  const maxDownloadBytes = options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));

  /** Every message passes here: the key, and addresses (also as JSON writes them, `https:\/\/…`), are taken out. */
  const clean = (text: string): string =>
    withoutKey(text, apiKey).replace(/[a-z][a-z0-9+.-]*:(?:\\?\/){2}\S+/gi, '[address]').slice(0, 400);
  const fail = (code: GeneratorErrorCode, message: string, ticket: string | null = null, status: number | null = null): GeneratorError =>
    new GeneratorError(code, clean(message), ticket, status);
  const why = (error: unknown): string => error instanceof Error ? error.message : 'no answer';

  /** One API call, with the key. Throws when no answer arrives. */
  async function api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Answer> {
    const json = body === undefined ? null : JSON.stringify(body);
    const response = await send(root + path, {
      method,
      headers: {
        accept: 'application/json', 'x-magnific-api-key': apiKey,
        ...(json === null ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(json)) }),
      },
      // The body is a stream that can be read once: Node's fetch sends a POST again when the answer is
      // HTTP 421 and it still has the body. A body it cannot read twice is sent once.
      ...(json === null ? {} : { body: new Blob([json]).stream(), duplex: 'half' as const }),
      redirect: 'manual',                  // a followed redirect would carry the key to another host
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return { status: response.status, text: await response.text() };
  }

  /** Asks for an upload address, PUTs the bytes there with its signed headers and without the key. */
  async function upload(name: string, mime: string, bytes: Uint8Array): Promise<string> {
    let answer: Answer;
    try { answer = await api('POST', UPLOAD_PATH, { files: [{ content_type: mime }] }); } catch (error) {
      throw fail('upload-failed', `the upload address for ${name} got no answer (${why(error)})`);
    }
    if (!ok(answer)) throw fail('upload-failed', `the upload address for ${name} was refused: HTTP ${answer.status}: ${reasonOf(answer.text)}`);
    const body = objectOf(answer.text);
    const files = body?.files ?? (isRecord(body?.data) ? body.data.files : undefined);
    const slot: unknown = Array.isArray(files) ? files[0] : undefined;
    if (!isRecord(slot) || !isHttps(slot.upload_url) || !isHttps(slot.asset_url)) {
      throw fail('upload-failed', `the answer has no upload address for ${name}`);
    }
    const signed = Object.entries(isRecord(slot.headers) ? slot.headers : {})
      .filter(([header]) => header.toLowerCase() !== 'content-type')
      .map(([header, value]) => [header, String(value)]);
    let put: Response;
    try {
      put = await send(slot.upload_url, {
        method: 'PUT', headers: { ...Object.fromEntries(signed), 'content-type': mime }, body: bytes, signal: AbortSignal.timeout(TRANSFER_MS),
      });
    } catch (error) { throw fail('upload-failed', `the upload of ${name} got no answer (${why(error)})`); }
    if (!put.ok) throw fail('upload-failed', `the upload of ${name} was refused: HTTP ${put.status}`);
    return slot.asset_url;
  }

  /** Checks and reads every reference before the first request; each file is uploaded once. */
  async function uploadAll(route: Route): Promise<Uploaded[]> {
    const files = new Map<string, { mime: string; bytes: Uint8Array }>();
    for (const { file, kind } of route.references) {
      const mime = mimeOf(file);
      if (mime === null || !mime.startsWith(`${kind}/`)) {
        throw fail('upload-failed', `${basename(file)} is not ${kind === 'image' ? 'a PNG, JPEG or WebP image' : 'an MP3 or WAV sound'}`);
      }
      if (files.has(file)) continue;
      let bytes: Uint8Array;
      try { bytes = await readFile(file); } catch { throw fail('upload-failed', `${basename(file)} cannot be read`); }
      files.set(file, { mime, bytes });
    }
    const uploaded = new Map<string, Uploaded>();
    for (const [file, { mime, bytes }] of files) uploaded.set(file, { url: await upload(basename(file), mime, bytes), mime });
    return route.references.map(({ file }) => uploaded.get(file)!);
  }

  /** One question about a task. An answer that is not a task (4xx, 5xx, a broken body, none) is told, not thrown. */
  async function ask(ticket: string): Promise<Asked> {
    let answer: Answer;
    try { answer = await api('GET', ticket); } catch (error) {
      const late = error instanceof Error && error.name === 'TimeoutError';
      return { task: null, note: `no answer (${why(error)})`, spent: late ? requestTimeoutMs : 0, refused: false };
    }
    const task = taskOf(answer);
    if (task !== null) return { task, note: `status ${task.status}`, spent: 0, refused: false };
    const refused = answer.status >= 400 && answer.status <= 499 && answer.status !== 408 && answer.status !== 429;
    return { task, note: refused ? `HTTP ${answer.status}: ${reasonOf(answer.text)}` : `HTTP ${answer.status}`, spent: 0, refused };
  }

  /**
   * The result address is signed and short-lived: fetched at once, without the key, in up to three tries.
   * An HTML or JSON answer is an error page, not the file.
   */
  async function download(address: string, to: string, ticket: string): Promise<void> {
    const failed = (what: string): GeneratorError =>
      fail('download-failed', `the file of task ${idOf(ticket)} ${what}; the ticket stays valid`, ticket);
    let bytes: Uint8Array | null = null;
    let problem = '';
    let tooBig = false;
    for (let attempt = 1; attempt <= DOWNLOAD_TRIES && bytes === null && !tooBig; attempt++) {
      if (attempt > 1) await sleep(DOWNLOAD_WAIT_MS * (attempt - 1));
      try {
        const response = await send(address, { signal: AbortSignal.timeout(TRANSFER_MS) });
        const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
        if (response.ok && type !== 'text/html' && type !== 'application/json') {
          const declared = Number(response.headers.get('content-length') ?? 0);
          const arrived = declared > maxDownloadBytes ? null : await readCapped(response, maxDownloadBytes);
          if (arrived === null) {
            tooBig = true;
            problem = `is larger than the size limit of ${maxDownloadBytes} bytes`;
            await response.body?.cancel().catch(() => {});
          } else if (arrived.length > 0) bytes = arrived;
          else problem = 'arrived empty';
        } else {
          problem = response.ok ? `came as ${type}, a page instead of the file` : `was refused: HTTP ${response.status}`;
          await response.body?.cancel();
        }
      } catch (error) { problem = `did not arrive (${why(error)})`; }
    }
    if (bytes === null) throw failed(tooBig ? problem : `${problem}, in ${DOWNLOAD_TRIES} tries`);
    try {
      await mkdir(dirname(to), { recursive: true });
      const temporary = `${to}.${process.pid}.${randomUUID()}.part`;
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, to);
    } catch (error) { throw failed(`could not be written (${why(error)})`); }
  }

  /** Asks until the task ends, then fetches its file. Sends GETs only. Time is the waits plus the questions that got no answer in time. */
  async function follow(ticket: string, to: string, first: Task | null): Promise<Generated> {
    const taskId = idOf(ticket);
    let asked: Asked = first === null ? await ask(ticket) : { task: first, note: `status ${first.status}`, spent: 0, refused: false };
    let waited = asked.spent;
    let refusals = asked.refused ? 1 : 0;   // in a row
    let empties = 0;                         // COMPLETED answers without an address
    for (;;) {
      const { task } = asked;
      if (task?.status === 'COMPLETED') {
        const address: unknown = Array.isArray(task.generated) ? task.generated[0] : undefined;
        if (isHttps(address)) {
          await download(address, to, ticket);
          return { taskId, file: to };
        }
        empties += 1;
        if (empties > EMPTY_ASKS) throw fail('empty-result', `task ${taskId} finished without a file (asked ${empties} times)`, ticket);
      }
      if (task?.status === 'FAILED' || task?.status === 'ERROR') {
        throw fail('task-failed', `task ${taskId} failed: ${failureOf(task.error) || 'no reason given'}`, ticket);
      }
      if (refusals >= refusalLimit) {
        throw fail('timeout', `task ${taskId}: the provider refused the question ${refusals} times in a row (${asked.note}); the ticket stays valid`, ticket);
      }
      if (waited >= taskTimeoutMs) {
        throw fail('timeout', `task ${taskId} was not finished after ${Math.round(waited / 1000)} s (last: ${asked.note}); the ticket stays valid`, ticket);
      }
      await sleep(pollMs);
      asked = await ask(ticket);
      waited += pollMs + asked.spent;
      refusals = asked.refused ? refusals + 1 : 0;
    }
  }

  async function run(paid: PaidRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated> {
    if (apiKey === '') throw new GeneratorError('not-configured', NO_KEY);
    const reason = refusalOf(paid);
    if (reason !== null) throw fail('rejected', `not sent: ${reason}`);
    const plan = routeOf(paid);
    const runPath = options.spendDir ? relative(resolve(options.spendDir), resolve(to)).split(/[\\/]/) : [];
    const runId = runPath[0] === 'jobs' && runPath[1] ? runPath[1] : 'direct-' + randomUUID();
    const units = paid.kind === 'clip' ? paid.request.seconds : 1;
    // Local cap/log failures prevent any provider or upload request.
    let chargedAt: Date | undefined;
    try { chargedAt = options.beforePaid?.(runId, units) ?? undefined; } catch (error) {
      if (error instanceof Error && error.message === 'provider-cap-required') throw new GeneratorError('not-configured', NO_CAPS);
      throw fail('rejected', error instanceof Error && error.message === 'provider-cap' ? 'provider-cap' : 'provider-budget-unavailable');
    }
    const record = (event: string, ticket: string | null = null) => {
      if (!options.spendDir) return;
      mkdirSync(options.spendDir, { recursive: true, mode: 0o700 });
      appendFileSync(join(options.spendDir, 'provider-spend.jsonl'), JSON.stringify({ at: new Date().toISOString(), runId,
        kind: paid.kind, event, ticket: ticket === null ? null : clean(ticket), reservationUnits: units,
        providerCredits: 'unverified', fee: 'unverified', balanceBefore: 'unverified', balanceAfter: 'unverified' }) + '\n', { mode: 0o600 });
    };
    try { record('intent'); } catch { throw fail('not-configured', 'provider-spend-log-unavailable'); }
    let uploaded: Uploaded[];
    try { uploaded = await uploadAll(plan); } catch (error) {
      // a reference could not be read or uploaded: the paid POST below was never sent, so the units go back like those of a refused one (once: this is the only way out before the POST)
      if (error instanceof GeneratorError && error.code === 'upload-failed') {
        try { options.afterRefused?.(runId, units, chargedAt); } catch { /* the units stay counted: safe side */ }
      }
      throw error;
    }
    const body = plan.body(uploaded);
    let answer: Answer;
    try { answer = await api('POST', plan.submit, body); } catch (error) {
      record('submission-unknown');
      throw fail('submission-unknown', `POST ${plan.submit} got no answer (${why(error)}): the request may exist, do not send it again`);
    }
    if (answer.status >= 400 && answer.status <= 499 && answer.status !== 408) {
      record('rejected');
      try { options.afterRefused?.(runId, units, chargedAt); } catch { /* the units stay counted: safe side */ }
      throw fail('rejected', `POST ${plan.submit} was refused: HTTP ${answer.status}: ${reasonOf(answer.text)}`, null, answer.status);
    }
    const task = taskOf(answer);
    if (task === null || task.id === null) {
      record('submission-unknown');
      throw fail('submission-unknown', `POST ${plan.submit} answered HTTP ${answer.status} without a task: the request may exist, do not send it again`);
    }
    const ticket = `${plan.poll}/${segmentOf(task.id)}`;
    try { record('accepted', ticket); onSubmitted(ticket); } catch (error) {
      throw fail('submission-unknown', `the provider accepted the request, but its ticket could not be recorded (${why(error)}): do not send it again`, ticket);
    }
    try { const result = await follow(ticket, to, task); record('completed', ticket); return result; }
    catch (error) { record('unfinished', ticket); throw error; }
  }

  return {
    refusal: (paid) => refusalOf(paid),
    image: (request, to, onSubmitted) => run({ kind: 'image', request }, to, onSubmitted),
    clip: (request, to, onSubmitted) => run({ kind: 'clip', request }, to, onSubmitted),
    music: (request, to, onSubmitted) => run({ kind: 'music', request }, to, onSubmitted),
    voice: (request, to, onSubmitted) => run({ kind: 'voice', request }, to, onSubmitted),
    async resume(ticket, to) {
      if (apiKey === '') throw new GeneratorError('not-configured', NO_KEY);
      if (!TICKET.test(ticket)) {
        throw fail('submission-unknown', 'the ticket is not a task address of the provider: the task cannot be asked for, and must not be sent again');
      }
      return follow(ticket, to, null);
    },
    async ready() {
      if (apiKey === '') return { ready: false, note: NO_KEY };
      let answer: Answer;
      try { answer = await api('GET', READY_PATH); } catch (error) {
        return { ready: false, note: clean(`Magnific gave no answer (${why(error)})`) };
      }
      if (ok(answer)) return { ready: true, note: null };
      return { ready: false, note: clean(`Magnific did not accept the key: HTTP ${answer.status}: ${reasonOf(answer.text)}`) };
    },
  };
}

/** The only place that reads the key from the environment. */
export function createMagnificFromEnv(
  options: Omit<MagnificOptions, 'apiKey'> = {},
  env: Record<string, string | undefined> = process.env,
): Generator {
  return createMagnific({ ...options, apiKey: env.MAGNIFIC_API_KEY });
}
