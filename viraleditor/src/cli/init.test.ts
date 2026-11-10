// `init` and the examples it writes, with fake tools: what is asked of the tools, what lands in the folder, and that every
// example is a document `check` passes. The real run (media made by ffmpeg, a render of each) is examples.render.test.ts.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorError } from '../ports.ts';
import type { StreamFacts } from '../ports.ts';
import { EXAMPLES, EXAMPLE_NAMES, exampleFile, mediaNeeds, readExample } from './examples.ts';
import { STREAMS, ask, fakeContext } from './testing.ts';

vi.setConfig({ testTimeout: 60_000 });
const fresh = (): string => join(mkdtempSync(join(tmpdir(), 've-cli-init-')), 'project');

/** The facts the stand-in media of an example would have, by file name: what the fake measure answers in place of ffprobe. */
function streamsOf(name: (typeof EXAMPLE_NAMES)[number]): Record<string, StreamFacts> {
  const { edit } = readExample(name);
  return Object.fromEntries(mediaNeeds(edit).map((need) => {
    if (need.kind === 'image') return [need.file, STREAMS['still.png']!];
    if (need.kind === 'music') return [need.file, { ...STREAMS['tone.mp3']!, seconds: need.seconds }];
    const frames = need.seconds * edit.canvas.fps;
    return [need.file, { ...STREAMS['clip.mp4']!, frames, seconds: need.seconds, audio: need.sound, sound: need.sound ? { codec: 'aac', sampleRate: 48000, channels: 1 } : null,
      keyframes: Array.from({ length: need.seconds }, (_, i) => i * edit.canvas.fps) }];
  }));
}

describe('init', () => {
  it('writes the example and its media into the folder and says what to run next', async () => {
    const dir = fresh();
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['init', dir]);
    expect(ran.exit, JSON.stringify(ran.json.issues)).toBe(0);
    expect(Object.keys(ran.json)).toEqual(['ok', 'command', 'issues', 'warnings', 'result']);
    expect(ran.json.result).toMatchObject({ project: dir, example: 'product-beats', document: join(dir, 'edit.json'), canvas: '720x1280', frames: 270, seconds: 9 });
    expect(ran.json.result.next).toContain(`viraleditor check ${join(dir, 'edit.json')}`);
    expect(readFileSync(join(dir, 'edit.json'), 'utf8')).toBe(readFileSync(exampleFile('product-beats'), 'utf8'));     // byte for byte the example of the repo
    expect(readdirSync(join(dir, 'assets')).sort()).toEqual(['apply.mp4', 'glow.mp4', 'music.mp3', 'pour.mp4', 'product.png', 'shelf.mp4']);
    expect(ran.json.result.media).toEqual(['assets/pour.mp4', 'assets/apply.mp4', 'assets/glow.mp4', 'assets/shelf.mp4', 'assets/product.png', 'assets/music.mp3']);

    // the stand-ins are made in the work folder, the clips go into assets/ as normalised copies, and the work files are gone afterwards
    const made = calls.find((call) => call.tool === 'placeholders.make')!;
    expect(made.args[1]).toBe(join(dir, '.viraleditor', 'init'));
    expect(made.args[0]).toContainEqual({ kind: 'clip', file: 'pour.mp4', seconds: 4, sound: false });
    expect(made.args[0]).toContainEqual({ kind: 'image', file: 'product.png', label: 'product' });
    const copies = calls.filter((call) => call.tool === 'media.normalize');
    expect(copies.map((call) => call.args[1])).toEqual(['pour.mp4', 'apply.mp4', 'glow.mp4', 'shelf.mp4'].map((file) => join(dir, 'assets', file)));
    expect(copies[0]!.args[2]).toEqual({ width: 720, height: 1280, fps: 30, audio: false });
    expect(existsSync(join(dir, '.viraleditor', 'init'))).toBe(false);
  });

  it('--list names the examples and writes nothing', async () => {
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['init', '--list']);
    expect(ran.exit).toBe(0);
    expect(ran.json.result.examples).toEqual(Object.entries(EXAMPLES).map(([name, about]) => ({ name, about })));
    expect(ran.json.result.examples.map((example: { name: string }) => example.name)).toEqual(['product-beats', 'talking-captions', 'before-after', 'minimal']);
    expect(calls).toEqual([]);
  });

  it('never overwrites: a folder that holds a project, and a file, are refused with nothing changed', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'edit.json'), '{ "mine": true }');
    const { context, calls } = fakeContext();
    const taken = await ask(context, ['init', dir, '--example', 'minimal']);
    expect(taken.exit).toBe(2);
    expect(taken.json.issues[0]).toMatchObject({ code: 'folder-in-use', target: dir });
    expect(taken.json.issues[0].fix).toContain(`viraleditor init ${dir}-2 --example minimal`);
    expect(readFileSync(join(dir, 'edit.json'), 'utf8')).toBe('{ "mine": true }');
    expect(readdirSync(dir)).toEqual(['edit.json']);
    const file = await ask(context, ['init', join(dir, 'edit.json')]);
    expect(file.exit).toBe(2);
    expect(file.json.issues[0]).toMatchObject({ code: 'argument-value', target: '<dir>' });
    expect(calls).toEqual([]);
  });

  it('leaves nothing behind when the media cannot be made, and says which kind of fault it was', async () => {
    const failing = (error: Error) => {
      const made = fakeContext();
      made.context.tools.placeholders = { make: async (_needs, raw) => { mkdirSync(raw, { recursive: true }); throw error; } };
      return made.context;
    };
    const dir = fresh();
    const tool = await ask(failing(new GeneratorError('download-failed', 'the fake generator could not make pour.mp4: ffmpeg: not found')), ['init', dir]);
    expect(tool.exit).toBe(3);
    expect(tool.json.issues[0]).toMatchObject({ code: 'tool-failed', target: 'ffmpeg' });
    expect(tool.json.issues[0].fix).toContain('viraleditor doctor');
    expect(existsSync(dir)).toBe(false);                                                  // the same command can be run again

    const kept = fresh();
    mkdirSync(kept, { recursive: true });
    writeFileSync(join(kept, 'notes.txt'), 'mine');
    const bug = await ask(failing(new TypeError('boom')), ['init', kept]);
    expect(bug.exit).toBe(3);
    expect(bug.json.issues[0].code).toBe('internal');                                     // an exception nobody knows is a fault of the editor
    expect(readdirSync(kept)).toEqual(['.viraleditor', 'notes.txt']);                     // a folder that was there keeps what it held; assets/ is gone
    expect(readdirSync(join(kept, '.viraleditor'))).toEqual([]);
  });

  it('reads its arguments: the folder is needed, and a mistyped example gets the one that was meant', async () => {
    const { context } = fakeContext();
    const none = await ask(context, ['init']);
    expect(none.exit).toBe(2);
    expect(none.json.issues[0]).toMatchObject({ code: 'argument-missing', target: '<dir>' });
    expect(none.json.issues[0].fix).toContain('viraleditor init --list');
    const wrong = await ask(context, ['init', fresh(), '--example', 'minimul']);
    expect(wrong.exit).toBe(2);
    expect(wrong.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--example' });
    expect(wrong.json.issues[0].fix).toContain('Did you mean "minimal"?');
    const flag = await ask(context, ['init', fresh(), '--exampl', 'minimal']);
    expect(flag.exit).toBe(2);
    expect(flag.json.issues[0].fix).toContain('Did you mean --example?');
  });
});

describe('the examples', () => {
  it('are the folders of viraleditor/examples, each with one edit.json', () => {
    const dir = fileURLToPath(new URL('../../examples/', import.meta.url));
    expect(readdirSync(dir).filter((name) => !name.startsWith('.')).sort()).toEqual([...EXAMPLE_NAMES].sort());
    for (const name of EXAMPLE_NAMES) expect(readdirSync(join(dir, name)), name).toEqual(['edit.json']);
  });

  it.each(EXAMPLE_NAMES)('%s: init writes it, and check passes it without an issue or a warning', async (name) => {
    const dir = fresh();
    const { context } = fakeContext({ streams: streamsOf(name) });
    expect((await ask(context, ['init', dir, '--example', name])).exit).toBe(0);
    const ran = await ask(context, ['check', dir]);
    expect(ran.json.issues, JSON.stringify(ran.json.issues)).toEqual([]);
    expect(ran.json.warnings).toEqual([]);
    expect(ran.exit).toBe(0);
    expect(ran.json.result.stills.length).toBeGreaterThan(0);
  });

  it('show what their names say', () => {
    const beats = readExample('product-beats').edit;
    expect(beats.frames / beats.canvas.fps).toBeGreaterThanOrEqual(8);
    expect(beats.frames / beats.canvas.fps).toBeLessThanOrEqual(10);
    expect(new Set(beats.shots.map((shot) => shot.in?.kind ?? 'cut')).size).toBeGreaterThanOrEqual(3);
    expect(beats.shots.every((shot) => shot.motion !== undefined && shot.sound === undefined)).toBe(true);
    expect(beats.texts!.map((text) => text.style)).toEqual(expect.arrayContaining(['hook', 'label']));
    expect(beats.cards).toHaveLength(1);
    expect(beats.audio?.music).toBeDefined();

    const talking = readExample('talking-captions').edit;
    expect(talking.shots.every((shot) => shot.sound !== undefined)).toBe(true);
    expect(talking.captions!.words.length).toBeGreaterThan(8);
    expect(talking.audio!.music!.duck).toMatchObject({ under: 'captions' });
    const [card] = talking.cards!;
    const spoken = talking.captions!.words.filter((word) => word.at >= card!.at && word.at < card!.at + card!.for).map((word) => word.text);
    expect(spoken).toEqual(['this', 'serum.']);                                           // the card is on screen while its words are spoken

    const [window] = readExample('before-after').edit.shots[0]!.windows!;
    expect(window).toMatchObject({ behind: 'before', swaps: [{ behind: 'after' }] });

    const minimal = readExample('minimal').edit;
    expect(Object.keys(minimal)).toEqual(['version', 'language', 'canvas', 'frames', 'media', 'shots']);                // only what a document must have
    expect(minimal.shots).toHaveLength(1);
  });

  it('get media that is long enough: the frames the next transition holds a clip count, and a clip has sound when a shot plays it', () => {
    const needs = mediaNeeds({
      canvas: { width: 720, height: 1280, fps: 30 }, frames: 300,
      media: { a: { file: 'assets/a.mp4', kind: 'video' }, b: { file: 'assets/b.mp4', kind: 'video' }, back: { file: 'assets/back.mp4', kind: 'video' }, tone: { file: 'assets/tone.mp3', kind: 'audio' } },
      shots: [
        { id: 'one', at: 0, for: 140, media: 'a', from: 5 },                                                            // 145 frames and 8 for the crossfade: 153, so 6 s
        { id: 'two', at: 140, for: 160, media: 'b', in: { kind: 'crossfade' }, sound: { gain: 1 }, windows: [{ at: 150, for: 140, corner: 'top-left', behind: 'back' }] },
      ],
    } as never);
    expect(needs).toEqual([
      { kind: 'clip', file: 'a.mp4', seconds: 6, sound: false },
      { kind: 'clip', file: 'b.mp4', seconds: 6, sound: true },
      { kind: 'clip', file: 'back.mp4', seconds: 5, sound: false },
      { kind: 'music', file: 'tone.mp3', seconds: 10 },
    ]);
  });
});
