// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (jar.has('vc_session') ? data.auth.getUser(jar.get('vc_session')!) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { data } from '@/data';
import { getStore, resetStore } from '@/data/mock/store';
import { MAX_VIDEO_BODY_BYTES } from '@/core/upload-limits';
import { POST } from './route';

const UUID = '3f2b8c1e-5a47-4d0e-9b7c-1a2b3c4d5e6f';
const url = 'http://localhost:3000/api/uploads/video';
/** A real server gives every request its length; a bare Request does not, so the form is encoded first and its length set. */
const upload = async (init: { file?: File; headers?: Record<string, string> } = {}) => {
  const form = new FormData();
  form.set('file', init.file ?? new File([new Uint8Array(1000)], 'clip.mp4', { type: 'video/mp4' }));
  const encoded = new Response(form);
  const body = await encoded.arrayBuffer();
  return { body, headers: { host: 'localhost:3000', 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.byteLength), ...init.headers } };
};
const send = async (init: { file?: File; headers?: Record<string, string> } = {}) => POST(new Request(url, { method: 'POST', ...(await upload(init)) }));
/** A request whose body the test feeds by hand: `push` a part, `end` it, or leave it waiting. */
const slow = (headers: Record<string, string>) => {
  let feed!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { feed = controller; }, cancel() { cancelled = true; } });
  const request = new Request(url, { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
  return { request, push: (part: Uint8Array) => feed.enqueue(part), end: () => feed.close(), cancelled: () => cancelled };
};
const STALLED = { host: 'localhost:3000', 'content-type': 'multipart/form-data; boundary=x', 'content-length': '1000' };

beforeEach(() => {
  resetStore();
  jar.clear();
  jar.set('vc_session', 'usr-demo');
  vi.restoreAllMocks();
});

describe('POST /api/uploads/video', () => {
  it('keeps the file for the signed-in user and answers the opaque id with the advisory file facts', async () => {
    const save = vi.spyOn(data.uploads, 'saveVideo').mockResolvedValue(UUID);
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uploadId: UUID, name: 'clip.mp4', type: 'video/mp4', bytes: 1000 });
    expect(save).toHaveBeenCalledWith('usr-demo', expect.any(File));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a visitor without calling the store', async () => {
    jar.clear();
    const save = vi.spyOn(data.uploads, 'saveVideo');
    expect((await send()).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses an unverified email and a blocked user', async () => {
    const save = vi.spyOn(data.uploads, 'saveVideo');
    const user = getStore().users.find((u) => u.id === 'usr-demo');
    user!.emailVerified = false;
    expect((await send()).status).toBe(403);
    user!.emailVerified = true;
    user!.blocked = true;
    expect((await send()).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a body with no declared length or one over the cap before reading it', async () => {
    const save = vi.spyOn(data.uploads, 'saveVideo');
    const over = await POST(new Request(url, { method: 'POST', body: 'x', headers: { host: 'localhost:3000', 'content-length': String(MAX_VIDEO_BODY_BYTES + 1), 'content-type': 'multipart/form-data; boundary=x' } }));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: 'size' });
    const none = await POST(new Request(url, { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4)); c.close(); } }), headers: { host: 'localhost:3000', 'content-type': 'multipart/form-data; boundary=x' }, duplex: 'half' } as RequestInit));
    expect(none.status).toBe(411);
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a request that comes from another origin', async () => {
    const save = vi.spyOn(data.uploads, 'saveVideo');
    expect((await send({ headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a form with one file', async () => {
    const save = vi.spyOn(data.uploads, 'saveVideo');
    const response = await POST(new Request(url, { method: 'POST', body: JSON.stringify({ a: 1 }), headers: { host: 'localhost:3000', 'content-type': 'application/json', 'content-length': '7' } }));
    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['upload-type', 415, 'type'], ['upload-size', 413, 'size'], ['upload-quota', 429, 'quota'], ['upload-length', 422, 'length'], ['upload-ratio', 422, 'ratio'],
  ])('maps the refusal %s to %i and the code %s', async (message, status, code) => {
    vi.spyOn(data.uploads, 'saveVideo').mockRejectedValue(new Error(message));
    const response = await send();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });

  it('answers any other failure as a generic 500 without the message', async () => {
    vi.spyOn(data.uploads, 'saveVideo').mockRejectedValue(new Error('EACCES /secret/path'));
    const response = await send();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).toBe('{"error":"failed"}');
  });

  describe('before the body is read', () => {
    it('a user whose video quota is used up gets 429 without the body being read', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vc-route-'));
      vi.stubEnv('VC_DATA_DIR', dir);
      try {
        for (let i = 0; i < 10; i++) {
          mkdirSync(join(dir, 'uploads', `00000000-0000-4000-8000-00000000000${i}`), { recursive: true });
          writeFileSync(join(dir, 'uploads', `00000000-0000-4000-8000-00000000000${i}`, 'video-reservation'), 'usr-demo');
        }
        const save = vi.spyOn(data.uploads, 'saveVideo');
        const request = new Request(url, { method: 'POST', ...(await upload()) });
        const response = await POST(request);
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ error: 'quota' });
        expect(request.bodyUsed).toBe(false);
        expect(save).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('a second upload of the same user while one is running gets 429 busy, and the next one passes once it is done', async () => {
      let finish!: (id: string) => void;
      vi.spyOn(data.uploads, 'saveVideo').mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
      const first = send();
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      const second = await send();
      expect(second.status).toBe(429);
      expect(await second.json()).toEqual({ error: 'busy' });
      finish(UUID);
      expect((await first).status).toBe(200);
      vi.spyOn(data.uploads, 'saveVideo').mockResolvedValue(UUID);
      expect((await send()).status).toBe(200);
    });

    it('the slot is given back when the store refuses the file', async () => {
      vi.spyOn(data.uploads, 'saveVideo').mockRejectedValueOnce(new Error('upload-type')).mockResolvedValue(UUID);
      expect((await send()).status).toBe(415);
      expect((await send()).status).toBe(200);
    });

    it('only a few uploads run at once across users', async () => {
      const finishers: ((id: string) => void)[] = [];
      vi.spyOn(data.uploads, 'saveVideo').mockImplementation(() => new Promise<string>((resolve) => { finishers.push(resolve); }));
      const pending: Promise<Response>[] = [];
      for (const [i, id] of ['usr-demo', 'usr-paying', 'usr-admin', 'usr-free', 'usr-new'].entries()) {
        getStore().users.find((u) => u.id === id)!.emailVerified = true;
        jar.set('vc_session', id);
        pending.push(send());
        if (i < 4) await vi.waitFor(() => expect(finishers.length).toBe(i + 1));
      }
      const last = await pending[4]!;
      expect(last.status).toBe(429);
      for (const finish of finishers) finish(UUID);
      expect((await Promise.all(pending.slice(0, 4))).map((r) => r.status)).toEqual([200, 200, 200, 200]);
    });
  });

  describe('a body that does not arrive, or is no upload (F3)', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'vc-route-'));
      vi.stubEnv('VC_DATA_DIR', dir);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    });
    /** Opens an upload that sends nothing and waits until it holds the user's place. */
    const stall = async () => {
      const stalled = slow(STALLED);
      let status: number | undefined;
      void POST(stalled.request).then((response) => { status = response.status; });
      await vi.waitFor(async () => expect(await (await send()).json()).toEqual({ error: 'busy' }));
      return { ...stalled, status: () => status };
    };

    it('an upload that sends no body is cut off after five minutes: the read is cancelled and the place is free again', async () => {
      const save = vi.spyOn(data.uploads, 'saveVideo').mockResolvedValue(UUID);
      const stalled = await stall();
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 59_000);
      expect(stalled.status()).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(stalled.status()).toBe(408));
      expect(stalled.cancelled()).toBe(true);
      expect((await send()).status).toBe(200);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('an upload cut off for its missing body uses one of the day: the tenth closes the day', async () => {
      for (let i = 0; i < 10; i++) {
        const stalled = await stall();
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        await vi.waitFor(() => expect(stalled.status()).toBe(408));
      }
      const response = await send();
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: 'quota' });
    });

    it('a body that is no form with a file uses one of the day too', async () => {
      vi.spyOn(data.uploads, 'saveVideo').mockResolvedValue(UUID);
      for (let i = 0; i < 10; i++) {
        const junk = await POST(new Request(url, { method: 'POST', body: JSON.stringify({ a: 1 }), headers: { host: 'localhost:3000', 'content-type': 'application/json', 'content-length': '7' } }));
        expect(junk.status).toBe(400);
      }
      expect(await (await send()).json()).toEqual({ error: 'quota' });
    });

    it('a slow upload that arrives inside the five minutes is kept whole and is not counted as a failed try', async () => {
      const save = vi.spyOn(data.uploads, 'saveVideo').mockResolvedValue(UUID);
      const { body, headers } = await upload({ file: new File([new Uint8Array(5000).fill(7)], 'slow.mp4', { type: 'video/mp4' }) });
      const bytes = new Uint8Array(body);
      const request = slow(headers);
      const answer = POST(request.request);
      request.push(bytes.slice(0, 2000));
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 50_000);
      request.push(bytes.slice(2000));
      request.end();
      const response = await answer;
      expect(await response.json()).toEqual({ uploadId: UUID, name: 'slow.mp4', type: 'video/mp4', bytes: 5000 });
      const kept = save.mock.calls[0]![1];
      expect(new Uint8Array(await kept.arrayBuffer())).toEqual(new Uint8Array(5000).fill(7));
      expect(existsSync(join(dir, 'uploads'))).toBe(false);
    });
  });
});
