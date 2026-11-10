import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chooseCandidates, createShorts, detailArgs, listArgs, parseDetail, parseListLines, shortsTag } from './shorts.ts';

// The list fixture is written by hand to the shape measured on 2026-10-05; it was not captured.
const fx = (n: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), 'utf8');
const U = (id: string) => `https://www.youtube.com/shorts/${id}`;

describe('shortsTag', () => {
  it('drops #, lower-cases, removes whitespace, URL-encodes; empty stays empty', () => {
    expect(shortsTag('  #Skin Care Tips ')).toBe('skincaretips');
    expect(shortsTag('güzel')).toBe('g%C3%BCzel');
    expect(shortsTag(' # ')).toBe('');
  });
});

describe('arguments', () => {
  it('list call: flat playlist of the hashtag page, count, URL last behind --', () => {
    const a = listArgs('skincare', 40);
    expect(a).toEqual(['--flat-playlist', '--dump-json', '--no-warnings', '--no-progress', '--ignore-errors', '--playlist-end', '40', '--', 'https://www.youtube.com/hashtag/skincare/shorts']);
  });
  it('detail call: one video, no download, URL last behind --', () => {
    expect(detailArgs(U('x'))).toEqual(['--no-playlist', '--skip-download', '--dump-json', '--no-warnings', '--', U('x')]);
  });
});

describe('parseListLines', () => {
  it('keeps id + view count as Shorts URLs; skips and counts the rest', () => {
    const r = parseListLines(fx('shorts-flat.handwritten.jsonl'));
    expect(r.entries).toEqual([{ url: U('aaaaaaaaaaa'), views: 5300000 }, { url: U('bbbbbbbbbbb'), views: 820000 }]);
    expect(r.skipped).toBe(3);
  });
  it('empty output gives nothing', () => {
    expect(parseListLines('')).toEqual({ entries: [], skipped: 0 });
  });
});

describe('parseDetail', () => {
  it('takes title, exact views and duration from the last JSON line', () => {
    expect(parseDetail('{"title":"t","duration":15,"view_count":24965,"like_count":3}\n', U('a'))).toEqual({ url: U('a'), title: 't', views: 24965, seconds: 15 });
  });
  it('no JSON, no duration or no views gives null', () => {
    expect(parseDetail('', U('a'))).toBeNull();
    expect(parseDetail('oops', U('a'))).toBeNull();
    expect(parseDetail('{"title":"t","view_count":5}', U('a'))).toBeNull();
    expect(parseDetail('{"title":"t","duration":5,"view_count":null}', U('a'))).toBeNull();
  });
});

describe('chooseCandidates', () => {
  const e = [{ url: 'a', views: 100 }, { url: 'b', views: 900 }, { url: 'c', views: 500 }, { url: 'd', views: 700 }];
  it('no want: all, most views first, default limit 15', () => {
    expect(chooseCandidates(e).map((x) => x.url)).toEqual(['b', 'd', 'c', 'a']);
  });
  it('minViews, skip and limit apply, in view order', () => {
    expect(chooseCandidates(e, { minViews: 500, skip: new Set(['d']) }).map((x) => x.url)).toEqual(['b', 'c']);
    expect(chooseCandidates(e, { limit: 2 }).map((x) => x.url)).toEqual(['b', 'd']);
    expect(chooseCandidates(e, { minViews: 1000 })).toEqual([]);
  });
});

/** A stub yt-dlp: the hashtag call prints `list`; each detail call logs start/end (to measure overlap) and prints the JSON for its id. */
function stub(list: string[], details: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 've-sh-'));
  const log = join(dir, 'log');
  const bin = join(dir, 'yt-dlp');
  const cases = Object.entries(details).map(([id, out]) => `  *${id}) ${out === 'FAIL' ? 'echo boom >&2; exit 1' : `echo '${out}'`};;`).join('\n');
  writeFileSync(bin, `#!/bin/sh
for last; do :; done
case "$last" in
  */hashtag/*) echo "list $last" >> "${log}"; cat <<'EOF2'
${list.join('\n')}
EOF2
  ;;
  *) echo "start $last" >> "${log}"; sleep 0.2
  case "$last" in
${cases}
  *) echo nothing ;;
  esac
  echo "end $last" >> "${log}" ;;
esac
`);
  chmodSync(bin, 0o755);
  const lines = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { bin, lines };
}
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
const entry = (id: string, views: number) => JSON.stringify({ id, url: U(id), view_count: views, title: '' });
const detail = (views: number, duration = 12) => JSON.stringify({ title: 't', duration, view_count: views });

describe('createShorts (stub executable)', () => {
  it('SEC2 fix M1: both yt-dlp calls (the hashtag list and each detail) start with --ignore-config and run with an empty HOME of their own', async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-sh-argv-'));
    const log = join(dir, 'log');
    const bin = join(dir, 'yt-dlp');
    writeFileSync(bin, `#!/bin/sh
echo "first:$1 home:\$HOME files:$(ls -A "$HOME" | wc -l | tr -d ' ')" >> "${log}"
for last; do :; done
case "$last" in
  */hashtag/*) echo '${entry('aaa', 900)}' ;;
  *) echo '${detail(901)}' ;;
esac
`);
    chmodSync(bin, 0o755);
    const r = await createShorts({ bin }).search('x');
    expect(r).toHaveLength(1);
    const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    expect(calls).toHaveLength(2);                                                    // one list, one detail
    for (const call of calls) {
      expect(call).toMatch(/^first:--ignore-config /);
      expect(call).toContain('files:0');
      expect(call).not.toContain(`home:${process.env.HOME} `);
    }
  });
  it('lists the hashtag page, details only the chosen candidates, returns their cards in view order', async () => {
    const s = stub([entry('aaa', 900), entry('bbb', 5000), entry('ccc', 100), entry('ddd', 3000)], { aaa: detail(901), bbb: detail(5001), ddd: detail(3001) });
    const r = await createShorts({ bin: s.bin, count: 40 }).search('#Skin Care', { minViews: 500, skip: new Set([U('ddd')]) });
    expect(r.map((c) => c.url)).toEqual([U('bbb'), U('aaa')]);
    expect(r[0]).toEqual({ url: U('bbb'), title: 't', views: 5001, seconds: 12 });
    const l = s.lines();
    expect(l[0]).toBe('list https://www.youtube.com/hashtag/skincare/shorts');
    expect(l.filter((x) => x.startsWith('start ')).sort()).toEqual([`start ${U('aaa')}`, `start ${U('bbb')}`]);   // none for ccc (low views) or ddd (skipped)
  });
  it('a failing or unusable detail is dropped and counted; the search still answers', async () => {
    const s = stub([entry('aaa', 900), entry('bbb', 800), entry('ccc', 700)], { aaa: 'FAIL', bbb: 'not json', ccc: detail(701) });
    const skipped: number[] = [];
    const r = await createShorts({ bin: s.bin, onSkipped: (_q, n) => skipped.push(n) }).search('x');
    expect(r.map((c) => c.url)).toEqual([U('ccc')]);
    expect(skipped).toEqual([2]);
  });
  it('never runs more than 3 detail calls at once', async () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
    const s = stub(ids.map((id, i) => entry(id, 1000 - i)), Object.fromEntries(ids.map((id) => [id, detail(1)])));
    const r = await createShorts({ bin: s.bin }).search('x', { limit: 7 });
    expect(r).toHaveLength(7);
    let running = 0, peak = 0;
    for (const l of s.lines()) {
      if (l.startsWith('start ')) peak = Math.max(peak, ++running);
      if (l.startsWith('end ')) running -= 1;
    }
    expect(peak).toBe(3);
  });
  it('an empty tag runs nothing', async () => {
    const s = stub([], {});
    expect(await createShorts({ bin: s.bin }).search(' # ')).toEqual([]);
    expect(() => s.lines()).toThrow();      // the stub was never started: no log file
  });
  it('throws when the list call fails with no usable line', async () => {
    const s = stub(['garbage'], {});
    await expect(createShorts({ bin: s.bin }).search('x')).resolves.toEqual([]);   // exit 0, no entries: an empty hashtag is not a failure
    const bad = join(mkdtempSync(join(tmpdir(), 've-sh-')), 'yt-dlp');
    writeFileSync(bad, '#!/bin/sh\necho ERROR >&2\nexit 1\n');
    chmodSync(bad, 0o755);
    await expect(createShorts({ bin: bad }).search('x')).rejects.toThrow(/exited 1/);
    await expect(createShorts({ bin: join(tmpdir(), 'no-such-yt-dlp') }).search('x')).rejects.toThrow(/failed/);
  });
  it('a timeout of the list call also ends what yt-dlp started: no grandchild left (C6b, F10)', { timeout: 20_000 }, async () => {
    const s = sleeper('yt-dlp');
    await expect(createShorts({ bin: s.bin, timeoutMs: 1000 }).search('skincare', {})).rejects.toThrow(/timeout/);
    expect(await grandchildLeft(s.pid)).toBe(false);
  });
  it('a timeout of a detail call also ends what yt-dlp started: no grandchild left (C6b, F10)', { timeout: 20_000 }, async () => {
    const s = sleeper('yt-dlp', `for last; do :; done\ncase "$last" in */hashtag/*) echo '${entry('aaa', 900)}'; exit 0;; esac\n`);
    expect(await createShorts({ bin: s.bin, detailTimeoutMs: 1000 }).search('skincare', {})).toEqual([]);
    expect(await grandchildLeft(s.pid)).toBe(false);
  });
});
