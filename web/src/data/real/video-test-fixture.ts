// Offline test fixture: a real short vertical MP4 and the immutable upload registry the site writes.
import type * as ChildProcess from 'node:child_process';
import type * as Fs from 'node:fs';
import type * as Path from 'node:path';
import type * as Crypto from 'node:crypto';

export function registeredVideo(dir: string, owner: string, seconds = 8, name = 'video.mp4'): string {
  const fs: typeof Fs = process.getBuiltinModule('node:fs');
  const path: typeof Path = process.getBuiltinModule('node:path');
  const crypto: typeof Crypto = process.getBuiltinModule('node:crypto');
  const child: typeof ChildProcess = process.getBuiltinModule('node:child_process');
  const id = crypto.randomUUID(), folder = path.join(dir, 'uploads', id);
  fs.mkdirSync(folder, { recursive: true });
  const video = path.join(folder, 'source.mp4');
  child.execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=90x160:r=30', '-t', String(seconds), '-c:v', 'libx264', video]);
  const bytes = fs.readFileSync(video);
  fs.writeFileSync(path.join(folder, 'uploader'), owner);
  fs.writeFileSync(path.join(folder, 'video.json'), JSON.stringify({ path: `uploads/${id}/source.mp4`, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, seconds, width: 90, height: 160, name }));
  return id;
}
