import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { streamFrames } from './frames.ts';
import { FFMPEG } from './media.ts';

describe('streamFrames', () => {
  const dir = mkdtempSync(join(tmpdir(), 've-sweep-frames-'));
  const file = join(dir, 'grey.mp4');
  spawnSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=30', '-frames:v', '300', '-pix_fmt', 'yuv420p', file]);

  it('reads every frame', async () => {
    expect(await streamFrames(file, 64, 64, () => {})).toBe(300);
  });

  it('stops ffmpeg and rejects with the error when `each` throws', async () => {
    let calls = 0;
    const t0 = Date.now();
    await expect(streamFrames(file, 64, 64, (n) => { calls++; if (n === 3) throw new Error('stop at 3'); })).rejects.toThrow('stop at 3');
    expect(calls).toBe(4);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});
