// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';

const photo = () => new File(['pixels'], 'bottle.png', { type: 'image/png' });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('uploads', () => {
  it('the fake keeps nothing and returns the name of the file, as the form did', async () => {
    expect(await data.uploads.save('usr-demo', photo())).toBe('bottle.png');
  });

  it('with VC_ENGINE=sqlite the files go to disk (real/uploads.ts, which refuses this file for its bytes); the choice is made on every call', async () => {
    vi.stubEnv('VC_ENGINE', 'sqlite');
    await expect(data.uploads.save('usr-demo', photo())).rejects.toThrow('upload-type');
    vi.stubEnv('VC_ENGINE', '');
    expect(await data.uploads.save('usr-demo', photo())).toBe('bottle.png');
  });
});
