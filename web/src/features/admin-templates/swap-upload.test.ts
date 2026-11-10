import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { swapVideoRefusal, uploadSwapVideo } from './swap-upload';

class FakeRequest {
  static last: FakeRequest;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = '';
  opened: [string, string] | null = null;
  body: FormData | null = null;
  constructor() { FakeRequest.last = this; }
  open(method: string, url: string) { this.opened = [method, url]; }
  send(body: FormData) { this.body = body; }
  answer(status: number, body: unknown) { this.status = status; this.responseText = typeof body === 'string' ? body : JSON.stringify(body); this.onload?.(); }
}

beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeRequest));
afterEach(() => vi.unstubAllGlobals());

const mp4 = new File(['x'], 'walk.mp4', { type: 'video/mp4' });

describe('swapVideoRefusal', () => {
  it.each([
    ['an mp4 by its name', new File(['x'], 'a.mp4'), null],
    ['a mov by its type', new File(['x'], 'a', { type: 'video/quicktime' }), null],
    ['a text file', new File(['x'], 'a.txt', { type: 'text/plain' }), 'type'],
  ])('looks at %s before a byte is sent', (_name, file, expected) => {
    expect(swapVideoRefusal(file)).toBe(expected);
  });
  it('refuses a file over 100 MB without reading it', () => {
    const big = new File(['x'], 'a.mp4');
    Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 + 1 });
    expect(swapVideoRefusal(big)).toBe('size');
  });
});

describe('uploadSwapVideo', () => {
  it('sends the file as `file` to the upload route and hands back the id it kept, with the progress on the way', async () => {
    const seen: number[] = [];
    const done = uploadSwapVideo(mp4, (percent) => seen.push(percent));
    const request = FakeRequest.last;
    expect(request.opened).toEqual(['POST', '/api/uploads/video']);
    expect(request.body!.get('file')).toBe(mp4);
    request.upload.onprogress!({ lengthComputable: true, loaded: 50, total: 200 });
    request.answer(200, { uploadId: 'abc', name: 'walk.mp4' });
    expect(await done).toEqual({ ok: true, uploadId: 'abc' });
    expect(seen).toEqual([25]);
  });

  it.each([
    [415, 'type', 'type'], [413, 'size', 'size'], [429, 'quota', 'uploadQuota'], [422, 'length', 'length'], [422, 'ratio', 'ratio'], [408, 'timeout', 'uploadTimeout'],
  ])('says the route\'s refusal %i %s as %s', async (status, error, code) => {
    const done = uploadSwapVideo(mp4, () => {});
    FakeRequest.last.answer(status, { error });
    expect(await done).toEqual({ ok: false, code });
  });

  it.each([
    ['an answer that is not JSON', 502, 'bad gateway'],
    ['a refusal it does not know', 400, { error: 'weird' }],
    ['a signed-out admin', 401, { error: 'signed-out' }],
  ])('says it as a failed upload for %s', async (_name, status, body) => {
    const done = uploadSwapVideo(mp4, () => {});
    FakeRequest.last.answer(status, body);
    expect(await done).toEqual({ ok: false, code: 'uploadFailed' });
  });

  it('says a broken connection as a failed upload', async () => {
    const done = uploadSwapVideo(mp4, () => {});
    FakeRequest.last.onerror!();
    expect(await done).toEqual({ ok: false, code: 'uploadFailed' });
  });
});
