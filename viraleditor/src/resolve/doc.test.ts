// docs/reference/template-format.md is what the model that writes templates and fills reads. Its examples must be true.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEdit } from '../edit/schema.ts';
import { validate } from '../edit/validate.ts';
import { paidFor } from '../template/estimate.ts';
import { Fill, Template } from '../template/schema.ts';
import { checkFill, resolve } from './index.ts';
import { placeholderMedia } from './placeholder.ts';

const doc = readFileSync(new URL('../../../docs/reference/template-format.md', import.meta.url), 'utf8');
const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]!) as unknown);

describe('the examples of docs/reference/template-format.md', () => {
  it('are a beats template with its fill and a speech template with its fill', () => {
    expect(blocks).toHaveLength(4);
    expect(blocks.map((block) => (block as { mode?: string }).mode)).toEqual(['beats', undefined, 'speech', undefined]);
  });
  it.each([['beats', 0], ['speech', 2]] as const)('%s: both pass their schema, and resolve to a document the editor accepts', (mode, at) => {
    const template = Template.safeParse(blocks[at]), fill = Fill.safeParse(blocks[at + 1]);
    expect(template.error?.issues ?? []).toEqual([]);
    expect(fill.error?.issues ?? []).toEqual([]);
    const media = placeholderMedia(template.data!, fill.data!);
    const edit = resolve(template.data!, fill.data!, media);
    const parsed = parseEdit(JSON.parse(JSON.stringify(edit)));
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
    const facts = Object.fromEntries(Object.entries(edit.media).map(([key, { file, kind }]) => {
      const clip = Object.values(media.clips).find((candidate) => candidate.file === file);
      return [key, kind === 'video' ? { frames: clip!.frames, audio: mode === 'speech' } : kind === 'audio' ? { frames: edit.frames, audio: true } : { frames: 0, audio: false, width: 800, height: 1200 }];
    }));
    expect(validate(edit, facts)).toEqual([]);
    expect(JSON.stringify(edit)).not.toMatch(/Rivalbrand|\{[a-z_0-9]+\}/);
    expect(checkFill(template.data!, fill.data!)).toEqual({ errors: [], notes: [] });
  });
  it('the before and the after of the speech example become one window whose picture changes', () => {
    const template = Template.parse(blocks[2]), fill = Fill.parse(blocks[3]);
    const windows = resolve(template, fill, placeholderMedia(template, fill)).shots[0]!.windows!;
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ behind: 'still-skin-before', swaps: [{ behind: 'still-skin-after' }] });
  });
  it('the table of what a run pays for matches paidFor', () => {
    expect(paidFor(Template.parse(blocks[0]), 1)).toEqual({ images: 3, clips: 2, clipSeconds: 8, music: 1, voice: 0 });    // two shots that own a clip (s2 continues s1) and the still they are made from
    expect(paidFor(Template.parse(blocks[2]), 1)).toEqual({ images: 3, clips: 2, clipSeconds: 13, music: 1, voice: 1 });
  });
});
