import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOURCE_SECONDS_MAX } from '../template/limits.ts';
import { createDownloader, DURATION_CAP_SECONDS, MAX_DIR_BYTES, MAX_FILESIZE, MAX_FILESIZE_BYTES } from './downloader.ts';

/** A stub yt-dlp: logs argv, writes a file named after the -o template, prints the JSON yt-dlp prints. */
function stub(json: (file: string) => string, exitCode = 0, writeFile = true) {
  const dir = mkdtempSync(join(tmpdir(), 've-dl-'));
  const log = join(dir, 'args');
  const bin = join(dir, 'yt-dlp');
  writeFileSync(bin, `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a"; done > "${log}"
echo "key:\${MAGNIFIC_API_KEY-unset}" >> "${log}"
echo "home:\${HOME-unset}" >> "${log}"
echo "homefiles:$(ls -A "$HOME" 2>/dev/null | wc -l | tr -d ' ')" >> "${log}"
[ ${exitCode} -ne 0 ] && { echo 'ERROR: nope' >&2; exit ${exitCode}; }
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && t="$2"; shift; done
f=$(printf '%s' "$t" | sed 's/%(id)s/abc123/; s/%(ext)s/mp4/')
${writeFile ? 'echo video > "$f"' : ''}
cat <<EOF2
${json('$f')}
EOF2
`);
  chmodSync(bin, 0o755);
  return { bin, args: () => readFileSync(log, 'utf8').split('\n') };
}

const fresh = () => mkdtempSync(join(tmpdir(), 've-dl-out-'));
/** A stub that starts a grandchild (`sleep 30`), writes its pid to `pid` and waits for it: a timeout must end the grandchild too (C6b, F10). */
function sleeper(name: string, before = '') {
  const dir = mkdtempSync(join(tmpdir(), 've-f10-'));
  const pid = join(dir, 'pid');
  const bin = join(dir, name);
  writeFileSync(bin, `#!/bin/sh\n${before}sleep 30 & echo $! > "${pid}"; wait\n`);
  chmodSync(bin, 0o755);
  return { bin, pid };
}
/** Whether the grandchild whose pid is in `file` is still alive ~2 s after the call ended; it is killed here either way. */
async function grandchildLeft(file: string): Promise<boolean> {
  const grandchild = Number(readFileSync(file, 'utf8'));
  const alive = () => { try { process.kill(grandchild, 0); return true; } catch { return false; } };
  for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
  const left = alive();
  if (left) process.kill(grandchild, 'SIGKILL');                                       // never leave it behind
  return left;
}


describe('createDownloader (stub executable)', () => {
  it('passes the url last behind --, downloads into the folder, parses title/seconds/views/likes', async () => {
    const s = stub((f) => `{"title":"A hook","duration":14.5,"view_count":12000,"like_count":null,"requested_downloads":[{"filepath":"${f}"}]}`);
    const dir = mkdtempSync(join(tmpdir(), 've-dl-out-'));
    const r = await createDownloader(s.bin).video('https://example.com/v?x=1&y=2', dir);
    expect(r).toEqual({ file: join(dir, 'abc123.mp4'), title: 'A hook', seconds: 14.5, views: 12000, likes: null });
    const a = s.args();
    expect(a).toContain('--no-playlist');
    expect(a.slice(a.indexOf('--playlist-items'), a.indexOf('--playlist-items') + 2)).toEqual(['--playlist-items', '1']);   // a playlist / channel link is cut to one video (B11)
    expect(a.slice(a.indexOf('--'), a.indexOf('--') + 2)).toEqual(['--', 'https://example.com/v?x=1&y=2']);
    expect(a).toContain(join(dir, '%(id)s.%(ext)s'));
    expect(a).toContain('key:unset');
  });
  it('SEC2 I1: no config file, a size cap, a duration cap that lets a missing duration through, no playlist', async () => {
    const s = stub((f) => `{"title":"t","requested_downloads":[{"filepath":"${f}"}]}`);
    await createDownloader(s.bin).video('https://x', fresh());
    const a = s.args();
    expect(a[0]).toBe('--ignore-config');                                        // first: nothing else is read before it matters
    expect(a[a.indexOf('--max-filesize') + 1]).toBe(MAX_FILESIZE);
    expect(MAX_FILESIZE).toMatch(/^\d+M$/);
    expect(a[a.indexOf('--match-filters') + 1]).toBe(`duration<=?${DURATION_CAP_SECONDS} & !is_live`);
    expect(DURATION_CAP_SECONDS).toBe(SOURCE_SECONDS_MAX);                     // five minutes: a customer may pick a range of it
    expect(DURATION_CAP_SECONDS).toBeGreaterThanOrEqual(60);                     // the reference limit (VIDEO_SECONDS_MAX) is still decided later, so 'too-long' keeps its meaning
    expect(a).toContain('--no-playlist');
    expect(a.slice(a.indexOf('--'), a.indexOf('--') + 2)).toEqual(['--', 'https://x']);
  });
  it('SEC2 I5: yt-dlp runs with a HOME that is an empty folder of this run, never the owner\'s', async () => {
    const s = stub((f) => `{"title":"t","requested_downloads":[{"filepath":"${f}"}]}`);
    await createDownloader(s.bin).video('https://x', fresh());
    const a = s.args();
    const home = a.find((l) => l.startsWith('home:'))!.slice(5);
    expect(home).not.toBe(process.env.HOME);
    expect(home).not.toBe('unset');
    expect(a).toContain('homefiles:0');
    expect(existsSync(home)).toBe(false);                                        // removed when the run ended
  });
  it('SEC2 I1: a video the filters skip (yt-dlp exits 0 and prints nothing) is rejected, not "no JSON"', async () => {
    const s = stub(() => '');
    await expect(createDownloader(s.bin).video('https://x', fresh())).rejects.toMatchObject({ name: 'DownloadError', code: 'rejected' });
  });
  it('non-zero exit is tool-failed', async () => {
    const s = stub(() => '{}', 1);
    await expect(createDownloader(s.bin).video('https://x', fresh())).rejects.toMatchObject({ name: 'DownloadError', code: 'tool-failed' });
  });
  it('non-JSON output and a missing file are bad-output', async () => {
    await expect(createDownloader(stub(() => 'not json').bin).video('https://x', fresh())).rejects.toMatchObject({ code: 'bad-output' });
    const s = stub((f) => `{"title":"t","requested_downloads":[{"filepath":"${f}"}]}`, 0, false);
    await expect(createDownloader(s.bin).video('https://x', fresh())).rejects.toMatchObject({ code: 'bad-output' });
  });
  it('asks for a merged-or-single mp4 selector and merges into mp4; the url stays last', async () => {
    const s = stub((f) => `{"title":"t","requested_downloads":[{"filepath":"${f}"}]}`);
    await createDownloader(s.bin).video('https://x', fresh());
    const a = s.args();
    expect(a[a.indexOf('-f') + 1]).toBe('b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b');
    expect(a[a.indexOf('--merge-output-format') + 1]).toBe('mp4');
    expect(a.slice(a.indexOf('--'), a.indexOf('--') + 2)).toEqual(['--', 'https://x']);
  });
  it('asks for the largest video whose short side is at most 1080 (-S res:1080), and the url stays last', async () => {
    const s = stub((f) => `{"title":"t","requested_downloads":[{"filepath":"${f}"}]}`);
    await createDownloader(s.bin).video('https://x', fresh());
    const a = s.args();
    expect(a[a.indexOf('-S') + 1]).toBe('res:1080');
    expect(a.join(' ')).not.toContain('height<=');                                  // height would shrink a vertical 1080x1920 video to 608x1080
    expect(a.slice(a.indexOf('--'), a.indexOf('--') + 2)).toEqual(['--', 'https://x']);  });
  it('a merged download has no requested_downloads: the file comes from _filename', async () => {
    const s = stub((f) => `{"title":"t","duration":5,"format_id":"398+140","_filename":"${f}"}`);
    const dir = fresh();
    const r = await createDownloader(s.bin).video('https://x', dir);
    expect(r.file).toBe(join(dir, 'abc123.mp4'));
  });
  it('SEC2 fix I2: only https links are accepted: rtmp, rtsp, mms, file, http and the rest are refused before anything starts', async () => {
    const s = stub((f) => `{"title":"t","requested_downloads":[{"filepath":"${f}"}]}`);
    for (const url of ['rtmp://example.com/live', 'rtsp://example.com/x', 'mms://example.com/x', 'file:///etc/passwd', 'http://example.com/v', 'ftp://example.com/v', '/etc/passwd', 'not a url', 'javascript:alert(1)', 'data:text/plain,x']) {
      await expect(createDownloader(s.bin).video(url, fresh()), url).rejects.toMatchObject({ name: 'DownloadError', code: 'bad-url' });
    }
    expect(() => s.args()).toThrow();                                              // the stub never ran: it writes its log first thing
    await createDownloader(s.bin).video('HTTPS://Example.com/v?x=1', fresh());       // the scheme is case-insensitive
    expect(s.args()).toContain('HTTPS://Example.com/v?x=1');
  });
  it('SEC2 fix I2: the folder is measured while yt-dlp runs; a file that grows past the byte limit ends the run (group killed) with a DownloadError', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-grow-'));
    const bin = join(dir, 'yt-dlp');
    const pid = join(dir, 'pid');
    // no --max-filesize help here: a chunked answer has no length up front; this one writes forever
    writeFileSync(bin, `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && t="$2"; shift; done\nsleep 30 & echo $! > "${pid}"\nf=$(printf '%s' "$t" | sed 's/%(id)s/big/; s/%(ext)s/mp4.part/')\nwhile :; do head -c 20000 /dev/zero >> "$f"; sleep 0.05; done\n`);
    chmodSync(bin, 0o755);
    const out = fresh();
    const started = Date.now();
    await expect(createDownloader(bin, { maxDirBytes: 100_000, pollMs: 50 }).video('https://x', out)).rejects.toMatchObject({ name: 'DownloadError', code: 'rejected', message: expect.stringContaining('size limit') });
    expect(Date.now() - started).toBeLessThan(10_000);                                // not the 10 minute timeout
    expect(await grandchildLeft(pid)).toBe(false);
  });
  it('SEC2 fix I2: bytes that were in the folder before the run do not count against the limit', async () => {
    const out = fresh();
    writeFileSync(join(out, 'transcript.json'), 'x'.repeat(5000));
    const s = stub((f) => `{"title":"t","requested_downloads":[{"filepath":"${f}"}]}`);
    await expect(createDownloader(s.bin, { maxDirBytes: 1000, pollMs: 20 }).video('https://x', out)).resolves.toMatchObject({ title: 't' });
  });
  it('SEC2 fix I2: the byte limit is a named constant that holds a video part, an audio part and the merged file of the per-file cap', () => {
    expect(MAX_FILESIZE_BYTES).toBe(200 * 1024 * 1024);
    expect(MAX_FILESIZE).toBe(`${MAX_FILESIZE_BYTES / 1024 / 1024}M`);
    expect(MAX_DIR_BYTES).toBeGreaterThanOrEqual(3 * MAX_FILESIZE_BYTES);
  });
  it('a timeout also ends what yt-dlp started (ffmpeg): no grandchild left (C6b, F10)', { timeout: 20_000 }, async () => {
    const s = sleeper('yt-dlp');
    await expect(createDownloader(s.bin, { timeoutMs: 1000 }).video('https://x', fresh())).rejects.toMatchObject({ code: 'timeout' });
    expect(await grandchildLeft(s.pid)).toBe(false);
  });
});
