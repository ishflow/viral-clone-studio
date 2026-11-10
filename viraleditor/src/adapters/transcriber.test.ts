import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TranscribeError, createTranscriber, whisperModel } from './transcriber.ts';

const SOURCE = join(mkdtempSync(join(tmpdir(), 've-local-container-')), 'source.mp4');
writeFileSync(SOURCE, Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109, 109, 112, 52, 50]));

const FIXTURE = resolve(import.meta.dirname, '../../../docs/reference/fixtures/transcript.json');

/** A stub `hyperframes`: logs argv and the three switches, then behaves as scripted. */
function stub(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 've-stub-'));
  const log = join(dir, 'log.txt');
  const bin = join(dir, 'hyperframes');
  writeFileSync(bin, `#!/bin/sh
{ for a in "$@"; do printf '%s\\n' "$a"; done; echo "env:$HYPERFRAMES_NO_TELEMETRY$DO_NOT_TRACK$HYPERFRAMES_NO_UPDATE_CHECK"; echo "key:\${MAGNIFIC_API_KEY-unset}"; } > "${log}"
${body}
`);
  chmodSync(bin, 0o755);
  return { bin, args: () => readFileSync(log, 'utf8').split('\n') };
}
const okBody = `# find -d value
while [ $# -gt 0 ]; do [ "$1" = "-d" ] && d="$2"; shift; done
cp "${FIXTURE}" "$d/transcript.json"
echo '{"ok":true}'`;

describe('createTranscriber', () => {
  it('rejects a disguised playlist before starting the CLI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-container-'));
    const file = join(dir, 'source.mp4');
    writeFileSync(file, '#EXTM3U\nhttp://127.0.0.1/private\n');
    const cli = stub(okBody);
    await expect(createTranscriber(cli.bin).words(file, 'en')).rejects.toMatchObject({ code: 'unsupported-container' });
  });
  it('passes the exact arguments, three switches, no key; parses the fixture', async () => {
    process.env.MAGNIFIC_API_KEY = 'secret-key';
    try {
      const s = stub(okBody);
      const words = await createTranscriber(s.bin).words(SOURCE, 'en');
      expect(words).toHaveLength(91);
      expect(words[1]).toEqual({ text: 'try', start: 0.09, end: 0.25 });
      const a = s.args();
      expect(a[0]).toBe('transcribe');
      expect(a[1]).toBe(SOURCE);
      expect(a[2]).toBe('-d');
      expect(a.slice(4, 11)).toEqual(['--engine', 'whisper', '--model', 'small.en', '--language', 'en', '--json']);
      expect(a).toContain('env:111');
      expect(a).toContain('key:unset');
    } finally { delete process.env.MAGNIFIC_API_KEY; }
  });
  it('uses large-v3 for other languages', async () => {
    const s = stub(okBody);
    await createTranscriber(s.bin).words(SOURCE, 'es');
    expect(s.args()).toContain('large-v3');
    expect(whisperModel('en-US')).toBe('small.en');
    expect(whisperModel('ja')).toBe('large-v3');
  });
  it('non-zero exit is a typed error', async () => {
    const s = stub('echo boom >&2; exit 2');
    await expect(createTranscriber(s.bin).words(SOURCE, 'en')).rejects.toMatchObject({ name: 'TranscribeError', code: 'tool-failed' });
  });
  it('exit 0 with no transcript.json is bad-output', async () => {
    const s = stub('exit 0');
    await expect(createTranscriber(s.bin).words(SOURCE, 'en')).rejects.toMatchObject({ code: 'bad-output' });
  });
  it('malformed transcript is bad-output', async () => {
    const s = stub(`while [ $# -gt 0 ]; do [ "$1" = "-d" ] && d="$2"; shift; done\necho '{"a":1}' > "$d/transcript.json"`);
    const e = await createTranscriber(s.bin).words(SOURCE, 'en').catch((x) => x);
    expect(e).toBeInstanceOf(TranscribeError);
    expect(e.code).toBe('bad-output');
  });
  it('a missing binary is tool-failed', async () => {
    await expect(createTranscriber('/no/such/hyperframes').words(SOURCE, 'en')).rejects.toMatchObject({ code: 'tool-failed' });
  });
  it.skipIf(!process.env.VC_LIVE_WHISPER)('live whisper run', async () => {
    const bin = resolve(import.meta.dirname, '../../node_modules/.bin/hyperframes');
    const words = await createTranscriber(bin).words(process.env.VC_LIVE_WHISPER!, 'en');
    expect(words.length).toBeGreaterThan(0);
  }, 300_000);

  it('a timeout also ends what the CLI started (the recogniser runs as its child): no grandchild left (C6)', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-stub-'));
    const pidFile = join(dir, 'pid');
    const s = stub(`sleep 30 & echo $! > "${pidFile}"; wait`);
    await expect(createTranscriber(s.bin, { timeoutMs: 1000 }).words(SOURCE, 'en')).rejects.toMatchObject({ code: 'timeout' });
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    const alive = () => { try { process.kill(grandchild, 0); return true; } catch { return false; } };
    for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
    const left = alive();
    if (left) process.kill(grandchild, 'SIGKILL');                                       // never leave it behind
    expect(left).toBe(false);
  });
  // M7 of C6: `killGroup: true` settles the call on the CLI's exit (plus a short drain), not on the close of its pipes, and ends the group then.
  // What the real CLI does at its end, as a stub: it writes the transcript, leaves its recogniser running with the pipes, and exits 0.
  it('a CLI that exits 0 and leaves a child holding its pipes: the words come back at once, and the child is ended (C6 M7)', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-stub-'));
    const pidFile = join(dir, 'pid');
    const s = stub(`${okBody}\nsleep 30 & echo $! > "${pidFile}"`);                      // the grandchild keeps stdout and stderr open
    const began = Date.now();
    const words = await createTranscriber(s.bin, { timeoutMs: 15_000 }).words(SOURCE, 'en');
    expect(words.length).toBeGreaterThan(0);
    expect(Date.now() - began, 'settled on the exit of the CLI, not on its pipes').toBeLessThan(10_000);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    const alive = () => { try { process.kill(grandchild, 0); return true; } catch { return false; } };
    for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
    const left = alive();
    if (left) process.kill(grandchild, 'SIGKILL');
    expect(left, 'the recogniser the CLI left behind').toBe(false);
  });

  it('a CLI that prints its reason and exits 3 straight after: the message still has the reason (nothing cut by the early settle) (C6 M7)', async () => {
    const s = stub(`echo 'model download failed: no space left' >&2\nexit 3`);
    await expect(createTranscriber(s.bin).words(SOURCE, 'en')).rejects.toMatchObject({ code: 'tool-failed', message: expect.stringContaining('no space left') });
  });
});
