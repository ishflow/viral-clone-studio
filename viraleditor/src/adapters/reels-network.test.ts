import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const script = vi.hoisted(() => ({ addresses: ['8.8.8.8'], chunks: [Buffer.from('ok')], pinned: '' }));
vi.mock('node:dns/promises', () => ({ resolve4: vi.fn(async () => script.addresses.map(address => ({ address, ttl: 1 }))) }));
vi.mock('node:https', () => ({ get: vi.fn((_url, options, ready) => {
  const client = new EventEmitter() as EventEmitter & { destroy: (error?: Error) => void };
  client.destroy = error => { if (error) client.emit('error', error); client.emit('close'); };
  options.lookup('hostname', {}, (_error: unknown, address: string) => { script.pinned = address; });
  queueMicrotask(() => {
    const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
    ready(response);
    for (const chunk of script.chunks) if (!response.destroyed) response.write(chunk);
    response.end(); client.emit('close');
  });
  return client;
}) }));
import { get } from 'node:https';
import { requestReel } from './reels.ts';
beforeEach(() => { vi.clearAllMocks(); script.addresses = ['8.8.8.8']; script.chunks = [Buffer.from('ok')]; script.pinned = ''; });
describe('bounded Reel transport with recorded offline streams', () => {
  it('pins the validated DNS address into the HTTPS connection', async () => {
    expect((await requestReel(new URL('https://www.instagram.com/reel/x/'), 8)).body.toString()).toBe('ok');
    expect(script.pinned).toBe('8.8.8.8');
  });
  it('refuses mixed public/private DNS answers before opening a connection', async () => {
    script.addresses = ['8.8.8.8', '127.0.0.1'];
    await expect(requestReel(new URL('https://www.instagram.com/reel/x/'), 8)).rejects.toThrow('reel-forbidden-address');
    expect(get).not.toHaveBeenCalled();
  });
  it('stops a streamed response over its cap without a content-length header', async () => {
    script.chunks = [Buffer.alloc(8), Buffer.alloc(1)];
    await expect(requestReel(new URL('https://www.instagram.com/reel/x/'), 8)).rejects.toThrow('reel-response-too-large');
  });
});
