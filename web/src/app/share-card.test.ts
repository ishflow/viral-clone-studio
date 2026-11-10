// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

let host: string | undefined = 'viral.example';
let proto: string | undefined = 'https';
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: (name: string) => (name === 'host' ? host : name === 'x-forwarded-proto' ? proto : null) }),
}));

vi.mock('next/font/google', () => ({ Bricolage_Grotesque: () => ({ variable: 'display' }), Onest: () => ({ variable: 'body' }) }));

import { generateMetadata } from './layout';
import appleIcon, { contentType as appleType, size as appleSize } from './apple-icon';
import openGraph, { alt, contentType, size } from './opengraph-image';

const pngOf = async (response: Response) => Buffer.from(await response.arrayBuffer());

describe('the share card and the icons of the site', () => {
  it('opengraph-image is a 1200x630 png with an alt text, and renders', async () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
    expect(alt).toMatch(/Viral Clone/);
    const png = await pngOf(await openGraph());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it('apple-icon is a 180x180 png and renders', async () => {
    expect(appleSize).toEqual({ width: 180, height: 180 });
    expect(appleType).toBe('image/png');
    const png = await pngOf(await appleIcon());
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
  });

  it('icon.svg is there and carries the lime of the site', () => {
    const file = join(__dirname, 'icon.svg');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('#C8F03C');
  });

  it('the root metadata gives the card its address from the host the visitor used (https behind the proxy), and keeps the title', async () => {
    const meta = await generateMetadata();
    expect(String(meta.metadataBase)).toBe('https://viral.example/');
    expect(meta.title).toEqual({ default: 'Viral Clone', template: '%s · Viral Clone' });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image' });
  });

  it('with no host the metadata has no base (the relative card address is then left to Next)', async () => {
    host = undefined;
    expect((await generateMetadata()).metadataBase).toBeUndefined();
    host = 'viral.example';
  });
});
