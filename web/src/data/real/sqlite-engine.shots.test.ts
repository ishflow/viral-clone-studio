// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord } from '../mock/store';
import { closeSqliteEngines, sqliteEngine } from './sqlite-engine';
import { card, jobRecord, makeDataDir, putTemplate } from './testing';

// What a running job tells of each shot: the first frame once it is made, and whether its clip is. Read from the worker's operations
// (`v<k>:image:s<n>`, `v<k>:clip:s<n>`); the production side is not touched.

let dir: string;
let db: DatabaseSync;
const engine = () => sqliteEngine(dir);
const shotsOfCard = (count: number) => Array.from({ length: count }, (_, index) => ({ n: index + 1, from: index, to: index + 1, action: 'Hands enter', text: 'hook', product: 1 }));

beforeEach(() => { ({ dir, db } = makeDataDir()); });
afterEach(() => { closeSqliteEngines(); db.close(); rmSync(dir, { recursive: true, force: true }); });

/** The template's own file, where the worker keeps the ids of its shots (the card has none): `ids` in the order of the card. */
function putShotIds(ids: string[], extra: Record<string, unknown>[] = []): void {
  mkdirSync(join(dir, 'templates', 't1'), { recursive: true });
  writeFileSync(join(dir, 'templates', 't1', 'template.json'), JSON.stringify({ shots: ids.map((id, index) => ({ id, ...extra[index] })) }));
}

/** A running job of a template with `shots` shots (ids `s1`…, or `ids`); the run says it has `clips` clips to make in all. */
function running(shots: number, clips: number, variants: 1 | 2 | 3 = 1, ids = Array.from({ length: shots }, (_, index) => `s${index + 1}`)): { job: JobRecord; runId: string } {
  putTemplate(db, { id: 't1', state: 'published', card: card({ shots: shotsOfCard(shots) }) });
  putShotIds(ids);
  const job = jobRecord({}, { variants });
  engine().start(job, { images: clips + 1, clips, clipSeconds: clips * 4, music: 1, voice: 0 }, false);
  engine().committed();
  const steps = [{ key: 'images', status: 'running', done: 0, total: clips + 1 }, { key: 'clips', status: 'waiting', done: 0, total: clips }];
  db.prepare("UPDATE runs SET state = 'running', steps = ? WHERE ref = ?").run(JSON.stringify(steps), job.id);
  return { job, runId: (db.prepare('SELECT id FROM runs WHERE ref = ?').get(job.id) as { id: string }).id };
}

function operation(runId: string, key: string, state: 'pending' | 'done' | 'failed' | 'unknown', output: string | null = null): void {
  const kind = key.split(':')[1]!;
  db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'a', 'a')").run(runId, key, kind, state, output);
}
const file = (runId: string, name: string, v = 1) => `jobs/${runId}/paid/v${v}/${name}`;

describe('the shots of a running job', () => {
  it('a shot whose picture is made shows it, one whose clip is made says so, one with nothing made yet is not listed', () => {
    const { job, runId } = running(3, 3);
    operation(runId, 'v1:image:woman', 'done', file(runId, 'image-woman.png'));
    operation(runId, 'v1:image:s1', 'done', file(runId, 'image-s1.png'));
    operation(runId, 'v1:clip:s1', 'done', file(runId, 'clip-s1.mp4'));
    operation(runId, 'v1:image:s2', 'done', file(runId, 'image-s2.png'));
    operation(runId, 'v1:image:s3', 'pending');
    expect(engine().refresh(job).shots).toEqual([
      { variant: 1, n: 1, image: `/media/${file(runId, 'image-s1.png')}`, clip: true, clipUrl: `/media/${file(runId, 'clip-s1.mp4')}` },
      { variant: 1, n: 2, image: `/media/${file(runId, 'image-s2.png')}`, clip: false, clipUrl: null },
    ]);
  });

  it('the shared picture of a template (a still, the presenter) is no shot; a failed request shows nothing; its resend does', () => {
    const { job, runId } = running(3, 3);
    operation(runId, 'v1:image:presenter', 'done', file(runId, 'image-presenter.png'));
    operation(runId, 'v1:image:s1', 'failed');
    expect(engine().refresh(job).shots).toEqual([]);
    operation(runId, 'v1:image:s1#2', 'done', file(runId, 'image-s1.png'));
    expect(engine().refresh(job).shots).toEqual([{ variant: 1, n: 1, image: `/media/${file(runId, 'image-s1.png')}`, clip: false, clipUrl: null }]);
  });

  it('a picture that was kept as a JPEG is the one shown; an output that is not this run\'s frame is not shown, and not linked either', () => {
    const { job, runId } = running(3, 3);
    operation(runId, 'v1:image:s1', 'done', file(runId, 'image-s1.jpg'));
    operation(runId, 'v1:image:s2', 'done', 'uploads/11111111-2222-4333-8444-555555555555/1.png');
    operation(runId, 'v1:image:s3', 'done', `jobs/another-run/paid/v1/image-s3.png`);
    operation(runId, 'v1:clip:s2', 'done', file(runId, 'clip-s2.mp4'));
    expect(engine().refresh(job).shots).toEqual([
      { variant: 1, n: 1, image: `/media/${file(runId, 'image-s1.jpg')}`, clip: false, clipUrl: null },
      { variant: 1, n: 2, image: null, clip: true, clipUrl: `/media/${file(runId, 'clip-s2.mp4')}` },
    ]);
  });

  it('a request whose recorded output is not text (a stored blob) is skipped like any file that is not shown, and the refresh goes on', () => {
    const { job, runId } = running(3, 3);
    db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES (?, 'v1:image:s1', 'image', 'done', ?, 'a', 'a')").run(runId, Buffer.from(file(runId, 'image-s1.png')));
    operation(runId, 'v1:image:s2', 'done', file(runId, 'image-s2.png'));
    expect(engine().refresh(job).shots).toEqual([{ variant: 1, n: 2, image: `/media/${file(runId, 'image-s2.png')}`, clip: false, clipUrl: null }]);
  });

  it('what the job made can never stop the refresh that finishes or refunds it: when it cannot be read, the job refreshes without it', () => {
    const { job, runId } = running(3, 3);
    operation(runId, 'v1:image:s1', 'done', file(runId, 'image-s1.png'));
    db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(runId);
    db.exec('ALTER TABLE operations RENAME COLUMN output TO output_gone');   // the query for what was made fails; nothing else of the refresh reads that column
    const refreshed = engine().refresh(job);
    expect(refreshed.status).toBe('done');
  });

  it('each variant has its own shots', () => {
    const { job, runId } = running(3, 6, 2);
    operation(runId, 'v2:image:s1', 'done', file(runId, 'image-s1.png', 2));
    operation(runId, 'v1:image:s3', 'done', file(runId, 'image-s3.png'));
    expect(engine().refresh(job).shots).toEqual([
      { variant: 1, n: 3, image: `/media/${file(runId, 'image-s3.png')}`, clip: false, clipUrl: null },
      { variant: 2, n: 1, image: `/media/${file(runId, 'image-s1.png', 2)}`, clip: false, clipUrl: null },
    ]);
  });

  it('a template with a shot that continues another shot\'s clip has fewer boxes than shots: which box a shot is cannot be told, so none is listed', () => {
    const { job, runId } = running(4, 3);
    operation(runId, 'v1:image:s1', 'done', file(runId, 'image-s1.png'));
    expect(engine().refresh(job).shots).toBeUndefined();
  });

  it('a shot is the box of its place in the template, whatever its id is called: a clip made for `demo` is the second box', () => {
    const { job, runId } = running(3, 3, 1, ['hook', 'demo', 'cta']);
    operation(runId, 'v1:image:hook', 'done', file(runId, 'image-hook.png'));
    operation(runId, 'v1:clip:hook', 'done', file(runId, 'clip-hook.mp4'));
    operation(runId, 'v1:clip:demo', 'done', file(runId, 'clip-demo.mp4'));
    operation(runId, 'v1:image:cta', 'done', file(runId, 'image-cta.png'));
    expect(engine().refresh(job).shots).toEqual([
      { variant: 1, n: 1, image: `/media/${file(runId, 'image-hook.png')}`, clip: true, clipUrl: `/media/${file(runId, 'clip-hook.mp4')}` },
      { variant: 1, n: 2, image: null, clip: true, clipUrl: `/media/${file(runId, 'clip-demo.mp4')}` },
      { variant: 1, n: 3, image: `/media/${file(runId, 'image-cta.png')}`, clip: false, clipUrl: null },
    ]);
  });

  it('ids with gaps (s1, s2, s4) are the first three boxes: the clip of s4 is the third', () => {
    const { job, runId } = running(3, 3, 1, ['s1', 's2', 's4']);
    operation(runId, 'v1:clip:s4', 'done', file(runId, 'clip-s4.mp4'));
    operation(runId, 'v1:image:s4', 'done', file(runId, 'image-s4.png'));
    expect(engine().refresh(job).shots).toEqual([{ variant: 1, n: 3, image: `/media/${file(runId, 'image-s4.png')}`, clip: true, clipUrl: `/media/${file(runId, 'clip-s4.mp4')}` }]);
  });

  it('the resend of a clip under another id is its box too', () => {
    const { job, runId } = running(3, 3, 1, ['hook', 'demo', 'cta']);
    operation(runId, 'v1:clip:demo', 'failed');
    operation(runId, 'v1:clip:demo#2', 'done', file(runId, 'clip-demo.mp4'));
    expect(engine().refresh(job).shots).toEqual([{ variant: 1, n: 2, image: null, clip: true, clipUrl: `/media/${file(runId, 'clip-demo.mp4')}` }]);
  });

  it('a picture that belongs to no shot of the template (a still named like no shot) is no box', () => {
    const { job, runId } = running(3, 3, 1, ['hook', 'demo', 'cta']);
    operation(runId, 'v1:image:table', 'done', file(runId, 'image-table.png'));
    expect(engine().refresh(job).shots).toEqual([]);
  });

  it('when the template file does not tell the shots in the card\'s order (missing, not the same count, a shot that continues another), no box is told: the counters speak', () => {
    const { job, runId } = running(3, 3, 1, ['hook', 'demo', 'cta']);
    operation(runId, 'v1:clip:hook', 'done', file(runId, 'clip-hook.mp4'));
    putShotIds(['hook', 'demo']);
    expect(engine().refresh(job).shots).toBeUndefined();
    putShotIds(['hook', 'demo', 'cta'], [{}, { continues: 'hook' }, {}]);
    expect(engine().refresh(job).shots).toBeUndefined();
    rmSync(join(dir, 'templates', 't1', 'template.json'));
    expect(engine().refresh(job).shots).toBeUndefined();
  });
});

describe('the files of a running job: the clip of a shot, the music, the pictures every shot shares', () => {
  it('a shot\'s clip is the file the clip request recorded, whatever it is called; a file of another run or another folder is no clip file, though the clip is made', () => {
    const { job, runId } = running(3, 3, 1, ['hook', 'demo', 'cta']);
    operation(runId, 'v1:clip:hook', 'done', file(runId, 'whatever.mp4'));
    operation(runId, 'v1:clip:demo', 'done', 'jobs/another-run/paid/v1/clip-demo.mp4');
    operation(runId, 'v1:clip:cta', 'done', 'uploads/11111111-2222-4333-8444-555555555555/1.mp4');
    expect(engine().refresh(job).shots).toEqual([
      { variant: 1, n: 1, image: null, clip: true, clipUrl: `/media/${file(runId, 'whatever.mp4')}` },
      { variant: 1, n: 2, image: null, clip: true, clipUrl: null },
      { variant: 1, n: 3, image: null, clip: true, clipUrl: null },
    ]);
  });

  it('a frame is the shot\'s by its request\'s key, not by its file name: a frame under a name that is no s<n> is shown, and one made for another variant\'s folder is not', () => {
    const { job, runId } = running(3, 6, 2, ['hook', 'demo', 'cta']);
    operation(runId, 'v1:image:demo', 'done', file(runId, 'frame-two.webp'));
    operation(runId, 'v2:image:hook', 'done', file(runId, 'image-hook.png', 1));
    expect(engine().refresh(job).shots).toEqual([{ variant: 1, n: 2, image: `/media/${file(runId, 'frame-two.webp')}`, clip: false, clipUrl: null }]);
  });

  it('the music of each variant and every picture the shots share are listed, the voice and what is not finished are not', () => {
    const { job, runId } = running(3, 6, 2);
    operation(runId, 'v1:music', 'done', file(runId, 'music.mp3'));
    operation(runId, 'v2:music', 'done', file(runId, 'music.m4a', 2));
    operation(runId, 'v1:voice', 'done', file(runId, 'voice.mp3'));
    operation(runId, 'v1:image:woman', 'done', file(runId, 'image-woman.png'));
    operation(runId, 'v2:image:woman', 'done', file(runId, 'image-woman.png', 2));
    operation(runId, 'v1:image:table', 'pending');
    operation(runId, 'v1:image:s2', 'done', file(runId, 'image-s2.png'));
    expect(engine().refresh(job).made).toEqual({
      music: [{ variant: 1, url: `/media/${file(runId, 'music.mp3')}` }, { variant: 2, url: `/media/${file(runId, 'music.m4a', 2)}` }],
      shared: [{ variant: 1, url: `/media/${file(runId, 'image-woman.png')}` }, { variant: 2, url: `/media/${file(runId, 'image-woman.png', 2)}` }],
    });
  });

  it('a file recorded outside this run\'s own folders is listed nowhere', () => {
    const { job, runId } = running(3, 3);
    operation(runId, 'v1:music', 'done', 'jobs/another-run/paid/v1/music.mp3');
    operation(runId, 'v1:image:woman', 'done', 'uploads/11111111-2222-4333-8444-555555555555/1.png');
    expect(engine().refresh(job).made).toEqual({ music: [], shared: [] });
  });

  it('when the template file cannot tell which picture is a shot\'s, the pictures are not listed as shared (they could be a shot\'s), but the music still is', () => {
    const { job, runId } = running(3, 3);
    operation(runId, 'v1:music', 'done', file(runId, 'music.mp3'));
    operation(runId, 'v1:image:woman', 'done', file(runId, 'image-woman.png'));
    rmSync(join(dir, 'templates', 't1', 'template.json'));
    const refreshed = engine().refresh(job);
    expect(refreshed.shots).toBeUndefined();
    expect(refreshed.made).toEqual({ music: [{ variant: 1, url: `/media/${file(runId, 'music.mp3')}` }], shared: [] });
  });
});
