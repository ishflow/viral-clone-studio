import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_VIDEO_BYTES, uploadVideo, videoRefusal } from './upload';

class FakeXhr {
  static last: FakeXhr;
  upload = { onprogress: null as ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = '';
  method = ''; target = ''; body: unknown;
  constructor() { FakeXhr.last = this; }
  open(method: string, target: string) { this.method = method; this.target = target; }
  send(body: unknown) { this.body = body; }
  answer(status: number, text: string) { this.status = status; this.responseText = text; this.onload?.(); }
}
afterEach(() => vi.unstubAllGlobals());

const mp4 = (name = 'clip.mp4', type = 'video/mp4', size = 10) => new File([new Uint8Array(size)], name, { type });

describe('videoRefusal (advisory, before any byte is sent)', () => {
  it('lets mp4 and mov through and refuses other types and files over 100 MB', () => {
    expect(videoRefusal(mp4())).toBeNull();
    expect(videoRefusal(mp4('clip.MOV', 'video/quicktime'))).toBeNull();
    expect(videoRefusal(mp4('clip.mp4', ''))).toBeNull();
    expect(videoRefusal(mp4('clip.avi', 'video/x-msvideo'))).toBe('type');
    expect(videoRefusal(mp4('clip.png', 'image/png'))).toBe('type');
    const big = mp4();
    Object.defineProperty(big, 'size', { value: MAX_VIDEO_BYTES + 1 });
    expect(videoRefusal(big)).toBe('size');
  });
});

describe('uploadVideo', () => {
  it('posts the file as a form to the upload route, reports progress, and answers the kept file', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const progress = vi.fn();
    const result = uploadVideo(mp4(), progress);
    const xhr = FakeXhr.last;
    expect([xhr.method, xhr.target]).toEqual(['POST', '/api/uploads/video']);
    expect((xhr.body as FormData).get('file')).toBeInstanceOf(File);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.answer(200, JSON.stringify({ uploadId: 'u1', name: 'clip.mp4', type: 'video/mp4', bytes: 10 }));
    expect(await result).toEqual({ ok: true, file: { uploadId: 'u1', name: 'clip.mp4', type: 'video/mp4', bytes: 10 } });
    expect(progress).toHaveBeenCalledWith(25);
  });

  it.each([
    [415, 'type', 'type'], [413, 'size', 'size'], [429, 'quota', 'uploadQuota'], [422, 'length', 'length'], [422, 'ratio', 'ratio'], [500, 'failed', 'uploadServer'], [503, 'busy', 'uploadServer'], [400, 'odd', 'uploadFailed'], [408, 'timeout', 'uploadTimeout'],
  ])('maps the answer %i %s to the form code %s', async (status, error, code) => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const result = uploadVideo(mp4(), () => undefined);
    FakeXhr.last.answer(status, JSON.stringify({ error }));
    expect(await result).toEqual({ ok: false, code });
  });

  it('says a signed-out answer, and treats a network error or an unreadable answer as a failed upload', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const out = uploadVideo(mp4(), () => undefined);
    FakeXhr.last.answer(401, '{"error":"signed-out"}');
    expect(await out).toEqual({ ok: false, code: 'uploadFailed', signedOut: true });
    const down = uploadVideo(mp4(), () => undefined);
    FakeXhr.last.onerror?.();
    expect(await down).toEqual({ ok: false, code: 'uploadFailed' });
    const junk = uploadVideo(mp4(), () => undefined);
    FakeXhr.last.answer(200, '<html>');
    expect(await junk).toEqual({ ok: false, code: 'uploadFailed' });
  });

  it('a server failure whose answer is not even readable (a gateway page) is a failure on our side, not on the customer\'s connection', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const gateway = uploadVideo(mp4(), () => undefined);
    FakeXhr.last.answer(502, '<html>Bad gateway</html>');
    expect(await gateway).toEqual({ ok: false, code: 'uploadServer' });
  });
});
