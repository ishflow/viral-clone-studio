import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compose } from '../compose/index.ts';
import { Fill, Template } from '../template/schema.ts';
import { ResolveError, resolve } from './index.ts';
import { placeholderFacts, placeholderMedia } from './placeholder.ts';

const read = (id: string, file: string): unknown => JSON.parse(readFileSync(new URL(`./golden/${id}/${file}.json`, import.meta.url), 'utf8'));

describe.each(['layering-01', 'lashly-01'])('placeholderFacts, golden %s', (id) => {
  const template = Template.parse(read(id, 'template')), fill = Fill.parse(read(id, 'fill'));
  const media = placeholderMedia(template, fill);
  const edit = resolve(template, fill, media);
  const facts = placeholderFacts(edit, media);
  it('has a fact for every media key; images are one frame, silent and sized; clips carry their own sound as the document uses it', () => {
    expect(Object.keys(facts).sort()).toEqual(Object.keys(edit.media).sort());
    for (const [key, { kind, file }] of Object.entries(edit.media)) {
      if (kind === 'image') expect(facts[key]).toEqual({ frames: 1, audio: false, width: 1024, height: 1024 });
      if (kind === 'audio') expect(facts[key]).toEqual({ frames: media.music!.frames, audio: true });
      if (kind === 'video') {
        const clip = Object.values(media.clips).find((c) => c.file === file)!;
        expect(facts[key]).toEqual({ frames: clip.frames, audio: edit.shots.some((s) => s.media === key && s.sound !== undefined) });
      }
    }
  });
  it('compose accepts them', () => {
    expect(() => compose(edit, facts)).not.toThrow();
  });
});

describe('placeholderFacts, unknown file', () => {
  it('throws media-unknown-file', () => {
    const template = Template.parse(read('layering-01', 'template')), fill = Fill.parse(read('layering-01', 'fill'));
    const media = placeholderMedia(template, fill);
    const edit = resolve(template, fill, media);
    const gone = { ...media, clips: {} };
    try { placeholderFacts(edit, gone); expect.unreachable(); } catch (error) {
      expect(error).toBeInstanceOf(ResolveError);
      expect((error as ResolveError).code).toBe('media-unknown-file');
    }
  });
});
