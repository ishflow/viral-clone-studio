import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AlignError, createAligner } from './aligner.ts';

/** A stub in the place of the environment's Python: logs argv, the offline switches, two variables that must not arrive and stdin, then behaves as scripted. `media`: a file that exists (the adapter looks). */
function stub(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 've-align-stub-'));
  const log = join(dir, 'log.txt');
  const python = join(dir, 'python');
  const media = join(dir, 'a.mp4');
  writeFileSync(media, '');
  writeFileSync(python, `#!/bin/sh
{ for a in "$@"; do printf 'arg:%s\\n' "$a"; done
  echo "offline:$HF_HUB_OFFLINE$TRANSFORMERS_OFFLINE$UV_OFFLINE"
  echo "key:\${MAGNIFIC_API_KEY-unset}"; echo "proxy:\${HTTPS_PROXY-unset}"; echo "path:\${PATH:+set}"
  printf 'stdin:'; cat; echo; } > "${log}"
${body}
`);
  chmodSync(python, 0o755);
  return { dir, python, media, script: '/tool/align.py', started: () => existsSync(log), log: () => readFileSync(log, 'utf8').split('\n') };
}
const answer = (words: unknown[], seconds = 10) => `cat <<'JSON'\n${JSON.stringify({ words, model: 'fake-ctc', seconds })}\nJSON`;
const THREE = [
  { text: 'It\'s', start: 0.1, end: 0.4, score: 0.9 },
  { text: 'the', start: 0.4, end: 0.5, score: 0.8 },
  { text: 'ACME.', start: 0.62, end: 1.3, score: 0.35 },
];
const WORDS = THREE.map((w) => w.text);
const run = (body: string, words = WORDS, language = 'en') => {
  const s = stub(body);
  return { s, result: createAligner({ python: s.python, script: s.script }).align(s.media, words, language) };
};
const codeOf = async (body: string, words = WORDS) => {
  const e = await run(body, words).result.catch((x) => x);
  expect(e).toBeInstanceOf(AlignError);
  return (e as AlignError).code;
};

describe('createAligner: the child', () => {
  it('gets the script as its only argument, the request on stdin, the offline switches, and nothing else from the environment', async () => {
    process.env.MAGNIFIC_API_KEY = 'secret-key';
    process.env.HTTPS_PROXY = 'http://proxy.invalid:1';
    try {
      const { s, result } = run(answer(THREE));
      expect(await result).toEqual(THREE);
      const log = s.log();
      expect(log.filter((l) => l.startsWith('arg:'))).toEqual(['arg:/tool/align.py']);
      expect(log).toContain('offline:111');
      expect(log).toContain('key:unset');
      expect(log).toContain('proxy:unset');
      expect(log).toContain('path:set');
      expect(JSON.parse(log.find((l) => l.startsWith('stdin:'))!.slice(6))).toEqual({ media: s.media, words: WORDS, language: 'en' });
    } finally { delete process.env.MAGNIFIC_API_KEY; delete process.env.HTTPS_PROXY; }
  });
  it('accepts en and en-*; any other language is language-unsupported and starts no child', async () => {
    for (const language of ['en', 'en-US', 'EN_gb']) expect(await run(answer(THREE), WORDS, language).result).toHaveLength(3);
    for (const language of ['tr', 'es', 'eng', 'end', '']) {
      const { s, result } = run(answer(THREE), WORDS, language);
      await expect(result).rejects.toMatchObject({ name: 'AlignError', code: 'language-unsupported' });
      expect(s.started()).toBe(false);
    }
  });
  it('no words: an empty answer, no child', async () => {
    const { s, result } = run('exit 9', []);
    expect(await result).toEqual([]);
    expect(s.started()).toBe(false);
  });
});

describe('createAligner: errors', () => {
  it('a missing Python is not-installed', async () => {
    const e = await createAligner({ python: '/no/such/venv/bin/python', script: '/tool/align.py' }).align(stub('exit 0').media, WORDS, 'en').catch((x) => x);
    expect(e).toBeInstanceOf(AlignError);
    expect(e.code).toBe('not-installed');
  });
  it('the tool\'s own error object names the code: not-installed, language-unsupported, anything else is tool-failed', async () => {
    const fail = (error: string) => `echo '{"error":"${error}","message":"why"}'; exit 1`;
    expect(await codeOf(fail('not-installed'))).toBe('not-installed');
    expect(await codeOf(fail('language-unsupported'))).toBe('language-unsupported');
    expect(await codeOf(fail('bad-media'))).toBe('bad-media');
    expect(await codeOf(fail('failed'))).toBe('tool-failed');
    expect(await codeOf(fail('made-up'))).toBe('tool-failed');
  });
  it('a non-zero exit without an error object is tool-failed and carries the end of stderr', async () => {
    const e = await run('echo "Traceback: boom" >&2; exit 2').result.catch((x) => x);
    expect(e).toMatchObject({ name: 'AlignError', code: 'tool-failed' });
    expect(e.message).toContain('boom');
  });
  it('a child that does not finish is timeout', async () => {
    const s = stub('sleep 30');
    const aligner = createAligner({ python: s.python, script: s.script, timeoutMs: 300 });
    await expect(aligner.align(s.media, WORDS, 'en')).rejects.toMatchObject({ name: 'AlignError', code: 'timeout' });
  }, 60_000);
});

describe('createAligner: the media must be a local file', () => {
  // ffmpeg would read each of these as a protocol or an option: a URL makes it open a connection. None may reach the child.
  const REFUSED = ['http://127.0.0.1:9/x.mp4', 'https://example.invalid/a.mp4', 'rtmp://example.invalid/live', 'file:///tmp/a.mp4', 'concat:/a.mp4|/b.mp4',
    'subfile,,start,0,end,100,,:/a.mp4', 'pipe:0', 'fd:0', 'data:audio/wav;base64,AAAA', ':a.mp4', '-', '-version', ''];
  it.each(REFUSED)('refuses "%s" with bad-media and starts no child', async (media) => {
    const s = stub(answer(THREE));
    await expect(createAligner({ python: s.python, script: s.script }).align(media, WORDS, 'en')).rejects.toMatchObject({ name: 'AlignError', code: 'bad-media' });
    expect(s.started()).toBe(false);
  });
  it('refuses what is not an existing regular file: a missing path, a folder, a named pipe', async () => {
    const s = stub(answer(THREE));
    const folder = join(s.dir, 'folder.mp4'), pipe = join(s.dir, 'pipe.mp4');
    mkdirSync(folder);
    execFileSync('mkfifo', [pipe]);
    for (const media of [join(s.dir, 'missing.mp4'), folder, pipe]) {
      await expect(createAligner({ python: s.python, script: s.script }).align(media, WORDS, 'en')).rejects.toMatchObject({ name: 'AlignError', code: 'bad-media' });
    }
    expect(s.started()).toBe(false);
  });
  it('takes a relative path and hands the child the absolute one', async () => {
    const s = stub(answer(THREE));
    const given = relative(process.cwd(), s.media);
    expect(given.startsWith('/')).toBe(false);
    expect(await createAligner({ python: s.python, script: s.script }).align(given, WORDS, 'en')).toHaveLength(3);
    expect(JSON.parse(s.log().find((l) => l.startsWith('stdin:'))!.slice(6)).media).toBe(s.media);
  });
});

describe('createAligner: the answer is checked', () => {
  const change = (i: number, patch: object) => THREE.map((w, k) => (k === i ? { ...w, ...patch } : w));
  it('not JSON, another shape, or an error object with exit 0', async () => {
    expect(await codeOf('echo "Loading model..."; ' + answer(THREE))).toBe('bad-output');
    expect(await codeOf('exit 0')).toBe('bad-output');
    expect(await codeOf('echo \'{"words":[{"text":"a"}]}\'')).toBe('bad-output');
    expect(await codeOf('echo \'{"error":"failed","message":"x"}\'')).toBe('bad-output');
  });
  it('count: a short or a long answer', async () => {
    expect(await codeOf(answer(THREE.slice(0, 2)))).toBe('bad-output');
    expect(await codeOf(answer([...THREE, { text: 'more', start: 2, end: 3, score: 0.5 }]))).toBe('bad-output');
  });
  it('order and text: every entry carries the given word, untouched', async () => {
    expect(await codeOf(answer([THREE[1], THREE[0], THREE[2]]))).toBe('bad-output');
    expect(await codeOf(answer(change(2, { text: 'ACME' })))).toBe('bad-output');
  });
  it('length: start before end', async () => {
    expect(await codeOf(answer(change(1, { end: 0.4 })))).toBe('bad-output');
    expect(await codeOf(answer(change(1, { start: 0.5, end: 0.45 })))).toBe('bad-output');
  });
  it('overlap: a word starts before the one before it ends', async () => {
    expect(await codeOf(answer(change(1, { start: 0.39 })))).toBe('bad-output');
  });
  it('inside the media: not before 0, not after its end', async () => {
    expect(await codeOf(answer(change(0, { start: -0.01 })))).toBe('bad-output');
    expect(await codeOf(answer(THREE, 1.29))).toBe('bad-output');
    expect(await run(answer(THREE, 1.3)).result).toHaveLength(3);
  });
  it('score: 0 … 1, a number', async () => {
    expect(await codeOf(answer(change(0, { score: 1.2 })))).toBe('bad-output');
    expect(await codeOf(answer(change(0, { score: -0.1 })))).toBe('bad-output');
    expect(await codeOf(answer(change(0, { score: null })))).toBe('bad-output');
    expect(await run(answer(change(0, { score: 0 }))).result).toHaveLength(3);
  });
});

describe('createAligner: ready', () => {
  const ready = (body: string) => { const s = stub(body); return { s, result: createAligner({ python: s.python, script: s.script }).ready() }; };
  it('asks the tool with --check and passes its answer on', async () => {
    const { s, result } = ready('echo \'{"ready":true,"note":null}\'');
    expect(await result).toEqual({ ready: true, note: null });
    expect(s.log().filter((l) => l.startsWith('arg:'))).toEqual(['arg:/tool/align.py', 'arg:--check']);
    expect(s.log()).toContain('offline:111');
    expect(await ready('echo \'{"ready":false,"note":"the weight file is missing"}\'').result).toEqual({ ready: false, note: 'the weight file is missing' });
  });
  it('a tool that floods its output (70 MB) is tool-failed in align and not ready with that cause, never "not installed" (C6 fix round 1)', { timeout: 60_000 }, async () => {
    const flood = "head -c 70000000 /dev/zero | tr '\\0' x";
    expect(await codeOf(flood)).toBe('tool-failed');
    const r = await ready(flood).result;
    expect(r.ready).toBe(false);
    expect(r.note).toMatch(/more than \d+ characters/);
  });
  it('no Python, a crash or a strange answer: not ready, with a note, never a throw', async () => {
    const missing = await createAligner({ python: '/no/such/venv/bin/python', script: '/tool/align.py' }).ready();
    expect(missing.ready).toBe(false);
    expect(missing.note).toContain('/no/such/venv/bin/python');
    for (const body of ['echo boom >&2; exit 1', 'echo hello', 'echo \'{"ready":"yes"}\'']) {
      const r = await ready(body).result;
      expect(r.ready).toBe(false);
      expect(typeof r.note).toBe('string');
    }
  });
});
