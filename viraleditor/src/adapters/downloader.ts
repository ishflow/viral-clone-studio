import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Downloader } from '../ports.ts';
import { SOURCE_SECONDS_MAX } from '../template/limits.ts';
import { reelVideo } from './reels.ts';
import { ExecError, runProcess } from './exec.ts';

export type DownloadErrorCode = 'tool-failed' | 'bad-output' | 'timeout' | 'rejected' | 'bad-url';
export class DownloadError extends Error {
  code: DownloadErrorCode;
  constructor(code: DownloadErrorCode, message: string) { super(message); this.name = 'DownloadError'; this.code = code; }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * What a link may make the worker download (SEC2 I1). A reference is a short video: the template limit is VIDEO_SECONDS_MAX (60 s) and
 * `prepare` still answers 'too-long' for a video between that and this cap, unless the customer picked a range of it: the cap is the
 * longest video a range may be picked from (SOURCE_SECONDS_MAX, five minutes). It stops the hour-long upload. 200 MB is far above a one-minute 1080p short (about 20 MB) and far below a disk.
 * A missing duration passes the filter (`?`): a direct file of a Top Ads card has none, and the size cap covers it.
 */
export const DURATION_CAP_SECONDS = SOURCE_SECONDS_MAX;
export const MAX_FILESIZE_BYTES = 200 * 1024 * 1024;
export const MAX_FILESIZE = `${MAX_FILESIZE_BYTES / 1024 / 1024}M`;      // yt-dlp's M is 1024 * 1024 bytes
/**
 * `--max-filesize` is checked by yt-dlp only when the answer announces its length (a chunked answer or an HLS/DASH stream is not checked
 * at all), so the folder is also measured while yt-dlp runs. What a good download may put there: the video part, the audio part (each
 * under the per-file cap) and the merged file, so three times the cap; more than that grown since the run began ends it.
 */
export const MAX_DIR_BYTES = 3 * MAX_FILESIZE_BYTES;
/** How often the folder is measured. */
export const SIZE_POLL_MS = 1000;

/** Bytes of every file below `dir` (a file that goes away while it is read counts nothing). */
function bytesBelow(dir: string): number {
  let total = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) total += bytesBelow(path);
    else { try { total += statSync(path).size; } catch { /* gone */ } }
  }
  return total;
}

/** yt-dlp's words when a filter or the size cap skips a video: the exit code is still 0. */
const SKIPPED = /does not pass filter|larger than max-filesize|is live/i;

/** `bin` is the yt-dlp executable. */
export function createDownloader(bin = 'yt-dlp', options: { timeoutMs?: number; maxDirBytes?: number; pollMs?: number } = {}): Downloader {
  return {
    async video(url, toDir) {
      // https only: rtmp, rtsp, mms and the like make yt-dlp start its own ffmpeg with no protocol whitelist, file: reads the worker's disk
      let scheme = '';
      try { scheme = new URL(url).protocol; } catch { /* not a URL at all */ }
      if (scheme !== 'https:') throw new DownloadError('bad-url', 'only https links are downloaded');
      const host = new URL(url).hostname;
      if (['instagram.com', 'www.instagram.com'].includes(host)) {
        try { return await reelVideo(url, toDir); } catch { throw new DownloadError('tool-failed', 'public Reel is unavailable or failed source admission'); }
      }
      const args = ['--ignore-config', '--max-filesize', MAX_FILESIZE, '--match-filters', `duration<=?${DURATION_CAP_SECONDS} & !is_live`, '--no-playlist', '--playlist-items', '1', '--no-progress', '--no-warnings', '--no-simulate', '--dump-json',
        '-S', 'res:1080',          // `res` is the SHORT side: a vertical 1080x1920 video stays whole, a 4K one is not fetched (every later step is 4 times slower on it)
        '-f', 'b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b', '--merge-output-format', 'mp4', '-o', join(toDir, '%(id)s.%(ext)s'), '--', url];
      const limit = options.maxDirBytes ?? MAX_DIR_BYTES;
      const before = bytesBelow(toDir);          // what the folder held already (the source folder of a prepare keeps its other files) is not the download's
      let r;
      try {
        r = await runProcess(bin, args, {
          timeoutMs: options.timeoutMs ?? 10 * 60_000, killGroup: true, isolatedHome: true,   // yt-dlp's ffmpeg ends with it
          watch: { everyMs: options.pollMs ?? SIZE_POLL_MS, check: () => (bytesBelow(toDir) - before > limit ? `the download grew past the size limit of ${limit} bytes` : null) },
        });
      } catch (e) {
        if (e instanceof ExecError) throw new DownloadError(e.code === 'timeout' ? 'timeout' : e.code === 'limit' ? 'rejected' : 'tool-failed', e.message);
        throw e;
      }
      if (r.code !== 0) throw new DownloadError('tool-failed', `yt-dlp exited ${r.code}: ${r.stderr.trim().slice(-500)}`);
      const line = r.stdout.trim().split('\n').filter(Boolean).pop() ?? '';
      const skipped = (): DownloadError => new DownloadError('rejected', `yt-dlp skipped the video (longer than ${DURATION_CAP_SECONDS} s, larger than ${MAX_FILESIZE}, or live)`);
      if (line === '' && (r.stderr.trim() === '' || SKIPPED.test(r.stderr))) throw skipped();
      let info: Record<string, unknown>;
      try { info = JSON.parse(line); } catch { throw new DownloadError('bad-output', 'yt-dlp printed no JSON'); }
      const downloads = info.requested_downloads as { filepath?: string }[] | undefined;
      const file = downloads?.[0]?.filepath ?? (info._filename as string | undefined);
      if (!file || !existsSync(file)) throw SKIPPED.test(r.stderr) ? skipped() : new DownloadError('bad-output', 'yt-dlp reported no downloaded file');
      return {
        file,
        title: typeof info.title === 'string' ? info.title : '',
        seconds: num(info.duration) ?? 0,
        views: num(info.view_count),
        likes: num(info.like_count),
      };
    },
  };
}
