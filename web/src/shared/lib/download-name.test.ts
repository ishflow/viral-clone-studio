import { describe, expect, it } from 'vitest';
import { downloadName } from './download-name';

const SAFE = /^viral-clone(-[a-z0-9]+)+\.mp4$/;

describe('downloadName', () => {
  it('names the file after the template and the first 8 characters of the job', () => {
    expect(downloadName('Morning Routine', 'abcdef1234567890')).toBe('viral-clone-morning-routine-abcdef12.mp4');
  });
  it('turns Turkish letters into ASCII', () => {
    expect(downloadName('Işık Şöyle Ğüzel Çöp', 'abcdef12')).toBe('viral-clone-isik-soyle-guzel-cop-abcdef12.mp4');
  });
  it('lets no path through', () => {
    const name = downloadName('../../etc/passwd', 'abcdef12');
    expect(name).toBe('viral-clone-etc-passwd-abcdef12.mp4');
    expect(downloadName('a\\b/c', 'abcdef12')).toBe('viral-clone-a-b-c-abcdef12.mp4');
  });
  it('collapses spaces and trims dashes', () => {
    expect(downloadName('  hello   world  ', 'abcdef12')).toBe('viral-clone-hello-world-abcdef12.mp4');
    expect(downloadName('--x--', 'abcdef12')).toBe('viral-clone-x-abcdef12.mp4');
  });
  it('drops emoji, quotes, dots and control characters', () => {
    expect(downloadName('🔥 Glow "Up".v2\n\t', 'abcdef12')).toBe('viral-clone-glow-up-v2-abcdef12.mp4');
    expect(downloadName('🔥🔥', 'abcdef12')).toBe('viral-clone-abcdef12.mp4');
  });
  it('keeps the short name within 24 characters and the whole within 60', () => {
    const name = downloadName('a'.repeat(100), 'abcdef12');
    expect(name).toBe(`viral-clone-${'a'.repeat(24)}-abcdef12.mp4`);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(downloadName('word '.repeat(20), 'abcdef12')).toMatch(SAFE);
    expect(downloadName('abcdefghij klmnopqrstuvwxyz', 'abcdef12')).not.toMatch(/-$|--/);
  });
  it('falls back without a title', () => {
    expect(downloadName(undefined, 'abcdef12')).toBe('viral-clone-abcdef12.mp4');
    expect(downloadName('', 'abcdef12')).toBe('viral-clone-abcdef12.mp4');
    expect(downloadName('   ', 'abcdef12')).toBe('viral-clone-abcdef12.mp4');
  });
  it('cleans the job id too and accepts a short one', () => {
    expect(downloadName('x', 'AB/../cd')).toBe('viral-clone-x-ab-cd.mp4');
    expect(downloadName('x', 'ab')).toBe('viral-clone-x-ab.mp4');
    expect(downloadName(undefined, '')).toBe('viral-clone.mp4');
  });
});
