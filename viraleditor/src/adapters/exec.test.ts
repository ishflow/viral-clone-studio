import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { timeoutWhenReady } from '../testing/timeout-when-ready.ts';
import { ExecError, childEnv, runProcess } from './exec.ts';

describe('childEnv', () => {
  it('drops everything outside the allow-list, MAGNIFIC_API_KEY included', () => {
    const env = childEnv({}, { PATH: '/bin', USER: 'u', MAGNIFIC_API_KEY: 'secret', OTHER: 'x' });
    expect(env).toEqual({ PATH: '/bin', USER: 'u' });
  });
  it('does not hand HOME to a child by default (SEC2 I5); a caller that needs it names it', () => {
    expect(childEnv({}, { PATH: '/bin', HOME: '/h' })).toEqual({ PATH: '/bin' });
    expect(childEnv({ passEnv: ['HOME'] }, { PATH: '/bin', HOME: '/h' })).toEqual({ PATH: '/bin', HOME: '/h' });
  });
  it('strips MAGNIFIC_API_KEY unconditionally, even when named in passEnv or env', () => {
    expect(childEnv({ passEnv: ['MAGNIFIC_API_KEY'] }, { MAGNIFIC_API_KEY: 'k', PATH: '/bin' })).toEqual({ PATH: '/bin' });
    expect(childEnv({ env: { MAGNIFIC_API_KEY: 'k', A: '1' } }, {})).toEqual({ A: '1' });
  });
  it('adds named pass-through variables and explicit values', () => {
    const env = childEnv({ passEnv: ['A'], env: { B: '2' } }, { A: '1', C: '3' });
    expect(env).toEqual({ A: '1', B: '2' });
  });
});

describe('runProcess', () => {
  it('passes arguments untouched (no shell) and captures stdout and stderr', async () => {
    const r = await runProcess(process.execPath, ['-e', 'console.log(process.argv[1]); console.error("e")', '$HOME; echo hi']);
    expect(r).toEqual({ code: 0, stdout: '$HOME; echo hi\n', stderr: 'e\n' });
  });
  it('returns a non-zero exit as a result', async () => {
    const r = await runProcess(process.execPath, ['-e', 'process.exit(3)']);
    expect(r.code).toBe(3);
  });
  it('writes input to stdin', async () => {
    const r = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'abc' });
    expect(r.stdout).toBe('abc');
  });
  it('keeps MAGNIFIC_API_KEY away from the child', async () => {
    process.env.MAGNIFIC_API_KEY = 'secret-key';
    try {
      const r = await runProcess(process.execPath, ['-e', 'console.log(Object.keys(process.env).join())']);
      expect(r.stdout).not.toContain('MAGNIFIC');
    } finally { delete process.env.MAGNIFIC_API_KEY; }
  });
  it('times out with a typed error', async () => {
    await expect(runProcess(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], { timeoutMs: 200 })).rejects.toMatchObject({ code: 'timeout' });
  });
  it('reports a missing binary as spawn-failed', async () => {
    const e = await runProcess('/no/such/binary', []).catch((x) => x);
    expect(e).toBeInstanceOf(ExecError);
    expect(e.code).toBe('spawn-failed');
  });
});

describe('runProcess with isolatedHome (SEC2 I5)', () => {
  const printHome = 'const fs=require("node:fs");const h=process.env.HOME;console.log(JSON.stringify({home:h,files:fs.readdirSync(h),dir:fs.statSync(h).isDirectory()}))';
  it('gives each run its own empty HOME, not the real one, and removes it afterwards', async () => {
    const real = process.env.HOME;
    const a = JSON.parse((await runProcess(process.execPath, ['-e', printHome], { isolatedHome: true })).stdout);
    const b = JSON.parse((await runProcess(process.execPath, ['-e', printHome], { isolatedHome: true, passEnv: ['HOME'], env: { HOME: '/owner' } })).stdout);
    for (const run of [a, b]) {
      expect(run).toMatchObject({ dir: true, files: [] });
      expect(run.home).not.toBe(real);
      expect(run.home).not.toBe('/owner');
      expect(run.home.startsWith(tmpdir()) || run.home.startsWith(realpathSync(tmpdir()))).toBe(true);
      expect(existsSync(run.home)).toBe(false);
    }
    expect(a.home).not.toBe(b.home);
  });
  it('is removed after a failing run and after a timeout as well', { timeout: 30_000 }, async () => {
    const homes: string[] = [];
    const script = 'require("node:fs").writeFileSync(process.env.HOME+"/x","1");console.log(process.env.HOME);process.exit(4)';
    const r = await runProcess(process.execPath, ['-e', script], { isolatedHome: true });
    homes.push(r.stdout.trim());
    const slow = 'console.log(process.env.HOME);setTimeout(()=>{},5000)';
    // the timeout counts from the moment the child has printed its HOME: a child that is slow to start (a loaded machine) must not be killed before it is up
    await timeoutWhenReady(
      () => runProcess(process.execPath, ['-e', slow], { isolatedHome: true, timeoutMs: 400, onData: (c) => homes.push(c.trim()) }),
      () => homes.length === 2,
      400,
    ).catch(() => {});
    expect(r.code).toBe(4);
    expect(homes).toHaveLength(2);
    for (const h of homes) for (let i = 0; i < 300 && existsSync(h); i++) await new Promise((r) => setTimeout(r, 50));   // after a timeout the folder goes when the killed child is gone
    for (const h of homes) expect(existsSync(h)).toBe(false);
  });
  it('without it a node child still finds the real home through the passwd database (what the render, whisper and aligner callers rely on)', async () => {
    const r = await runProcess(process.execPath, ['-e', 'console.log(String(process.env.HOME)+"|"+require("node:os").homedir())']);
    expect(r.stdout.trim()).toBe(`undefined|${homedir()}`);
  });
});

describe('runProcess with watch (SEC2 fix round, I2)', () => {
  it('a text from the check ends the run with ExecError limit; a check that throws or says null does not', async () => {
    let n = 0;
    const e = await runProcess(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { watch: { everyMs: 30, check: () => (++n > 3 ? 'too big' : null) } }).catch((x) => x);
    expect(e).toBeInstanceOf(ExecError);
    expect(e).toMatchObject({ code: 'limit', message: 'too big' });
    const r = await runProcess(process.execPath, ['-e', 'setTimeout(()=>{},300)'], { watch: { everyMs: 20, check: () => { throw new Error('stat failed'); } } });
    expect(r.code).toBe(0);
  });
});

describe('runProcess with killGroup', () => {
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const gone = async (pid: number): Promise<boolean> => {
    for (let i = 0; i < 40; i++) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 50)); }
    return false;
  };
  /** A child that starts a grandchild (`sleep`), writes its pid to a file, then runs `after`. */
  function parent(after: string, holdPipe = false) {
    const file = join(mkdtempSync(join(tmpdir(), 've-exec-')), 'pid');
    const script = `const {spawn}=require('node:child_process');
const g=spawn('sleep',['30'],{stdio:['ignore',${holdPipe ? "'inherit'" : "'ignore'"},'ignore']});
require('node:fs').writeFileSync(${JSON.stringify(file)},String(g.pid));
${after}`;
    return { args: ['-e', script], pid: () => Number(readFileSync(file, 'utf8')) };
  }
  it('kills the grandchild on a timeout', async () => {
    const p = parent('setTimeout(()=>{},30000)');
    await expect(runProcess(process.execPath, p.args, { timeoutMs: 1000, killGroup: true })).rejects.toMatchObject({ code: 'timeout' });
    expect(await gone(p.pid())).toBe(true);
  });
  it('kills the grandchild after a normal exit and after a failing exit', async () => {
    const ok = parent('setTimeout(()=>process.exit(0),300)');
    expect((await runProcess(process.execPath, ok.args, { killGroup: true })).code).toBe(0);
    expect(await gone(ok.pid())).toBe(true);
    const bad = parent('setTimeout(()=>process.exit(5),300)');
    expect((await runProcess(process.execPath, bad.args, { killGroup: true })).code).toBe(5);
    expect(await gone(bad.pid())).toBe(true);
  });
  it('a grandchild that holds stdout open does not keep it from settling; the output is kept', async () => {
    const p = parent('console.log("hello");setTimeout(()=>process.exit(0),300)', true);
    const r = await runProcess(process.execPath, p.args, { killGroup: true, timeoutMs: 20_000 });
    expect(r).toMatchObject({ code: 0, stdout: 'hello\n' });
    expect(await gone(p.pid())).toBe(true);
  });
  it('hands every chunk to onData with its stream', async () => {
    const seen: string[] = [];
    await runProcess(process.execPath, ['-e', 'console.log("a");console.error("b")'], { killGroup: true, onData: (c, s) => seen.push(`${s}:${c.trim()}`) });
    expect(seen.sort()).toEqual(['stderr:b', 'stdout:a']);
    const plain: string[] = [];
    await runProcess(process.execPath, ['-e', 'console.log("c")'], { onData: (c) => plain.push(c.trim()) });
    expect(plain).toEqual(['c']);
  });
  it('keeps the allow-listed environment and strips the key', async () => {
    process.env.MAGNIFIC_API_KEY = 'secret-key';
    try {
      const r = await runProcess(process.execPath, ['-e', 'console.log(Object.keys(process.env).join())'], { killGroup: true });
      expect(r.stdout).not.toContain('MAGNIFIC');
    } finally { delete process.env.MAGNIFIC_API_KEY; }
  });

  /** A child that starts a grandchild in a process group of its own (as puppeteer starts Chrome inside the HyperFrames CLI), then runs `after`. */
  function leaver(after: string) {
    const file = join(mkdtempSync(join(tmpdir(), 've-exec-')), 'pid');
    const script = `const g=require('node:child_process').spawn('sleep',['30'],{stdio:'ignore',detached:true});g.unref();
require('node:fs').writeFileSync(${JSON.stringify(file)},String(g.pid));
${after}`;
    return { args: ['-e', script], pid: () => Number(readFileSync(file, 'utf8')) };
  }
  it('on a timeout also kills a grandchild that left the group (C6 finding: Chrome outlived a killed render by 2-3 min)', { timeout: 20_000 }, async () => {
    const p = leaver('setTimeout(()=>{},30000)');
    await expect(runProcess(process.execPath, p.args, { timeoutMs: 1500, killGroup: true })).rejects.toMatchObject({ code: 'timeout' });
    const grandchild = p.pid();
    const ok = await gone(grandchild);
    if (!ok) process.kill(grandchild, 'SIGKILL');                                       // never leave it behind
    expect(ok).toBe(true);
  });

  it('kills the group exactly once per child: normal exit, timeout, and a grandchild holding the pipe', { timeout: 30_000 }, async () => {   // three runs and three 800 ms waits: past the 5 s default under load (C6)
    const groupKills = async (run: () => Promise<unknown>): Promise<number> => {
      const spy = vi.spyOn(process, 'kill');
      try { await run().catch(() => {}); await new Promise((r) => setTimeout(r, 800)); }   // past the drain timer
      finally { /* restored below */ }
      const n = spy.mock.calls.filter(([pid, signal]) => typeof pid === 'number' && pid < 0 && signal === 'SIGKILL').length;
      spy.mockRestore();
      return n;
    };
    const normal = parent('setTimeout(()=>process.exit(0),200)');
    expect(await groupKills(() => runProcess(process.execPath, normal.args, { killGroup: true }))).toBe(1);
    const slow = parent('setTimeout(()=>{},30000)');
    expect(await groupKills(() => runProcess(process.execPath, slow.args, { killGroup: true, timeoutMs: 800 }))).toBe(1);
    const held = parent('setTimeout(()=>process.exit(0),200)', true);
    expect(await groupKills(() => runProcess(process.execPath, held.args, { killGroup: true }))).toBe(1);
  });
});

describe('runProcess keeps what the caller can see through onData bounded', () => {
  const script = 'for (let i = 0; i < 40000; i++) console.log("line " + i + " " + "x".repeat(40)); console.error("err tail");';
  const LAST = 'line 39999 ' + 'x'.repeat(40) + '\n';
  it('with onData: at most 256 KB per stream, and the end of the stream', async () => {
    let seen = 0;
    const r = await runProcess(process.execPath, ['-e', script], { onData: (c) => { seen += c.length; } });
    expect(seen).toBeGreaterThan(2_000_000);
    expect(r.stdout.length).toBeLessThanOrEqual(256 * 1024);
    expect(r.stdout.endsWith(LAST)).toBe(true);
    expect(r.stderr).toBe('err tail\n');
  });
  it('without onData: everything', async () => {
    const r = await runProcess(process.execPath, ['-e', script]);
    expect(r.stdout.length).toBeGreaterThan(2_000_000);
    expect(r.stdout.startsWith('line 0 ')).toBe(true);
  });
  it('without onData, a child that floods stdout (400 MB) is stopped with a typed error and the heap stays bounded (C6)', { timeout: 60_000 }, async () => {
    // without a limit everything was kept; past V8's longest string (~512 M characters) `stdout + d` would throw out of the data handler
    const flood = 'const b=Buffer.alloc(1<<20,120);let n=0;const w=()=>{while(n<400){n++;if(!process.stdout.write(b))return process.stdout.once("drain",w);}};w();';
    const before = process.memoryUsage().heapUsed;
    const e = await runProcess(process.execPath, ['-e', flood], { timeoutMs: 50_000 }).catch((x) => x);
    expect(e).toBeInstanceOf(ExecError);
    expect(e.code).toBe('output-limit');
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(160 * 1024 * 1024);
  });
});

describe('runProcess killGroup when this process ends', () => {
  const EXEC = join(import.meta.dirname, 'exec.ts');
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  async function until(check: () => boolean, ms = 10_000): Promise<boolean> {
    for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return true; await new Promise((r) => setTimeout(r, 50)); }
    return check();
  }
  /** A script that starts a killGroup child with a grandchild (its pid goes to a file), then does `after(pidFile)`. */
  function script(after: (pidFile: string) => string) {
    const dir = mkdtempSync(join(tmpdir(), 've-exec-hook-'));
    const pidFile = join(dir, 'pid');
    const file = join(dir, 'run.ts');
    const inner = `const g = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setTimeout(() => {}, 60000);`;
    writeFileSync(file, `import { existsSync, readFileSync } from 'node:fs';
import { runProcess } from ${JSON.stringify(EXEC)};
void runProcess(process.execPath, ['-e', ${JSON.stringify(inner)}], { killGroup: true, timeoutMs: 120000 });
${after(pidFile)}`);
    return { file, pidFile };
  }
  const start = (file: string) => spawn(process.execPath, [file], { stdio: 'ignore' });
  const exited = (p: ReturnType<typeof spawn>) => new Promise<{ code: number | null; signal: string | null }>((res) => p.on('exit', (code, signal) => res({ code, signal })));

  it('SIGTERM to the process: it still dies of SIGTERM and the grandchild is gone', { timeout: 30_000 }, async () => {
    const s = script(() => 'setInterval(() => {}, 1000);');
    const p = start(s.file);
    const done = exited(p);
    expect(await until(() => existsSync(s.pidFile) && readFileSync(s.pidFile, 'utf8') !== '')).toBe(true);   // not between its creation and its write (C6)
    const grandchild = Number(readFileSync(s.pidFile, 'utf8'));
    expect(alive(grandchild)).toBe(true);
    p.kill('SIGTERM');
    expect(await done).toEqual({ code: null, signal: 'SIGTERM' });
    expect(await until(() => !alive(grandchild))).toBe(true);
  });
  it('SIGTERM to the process: a grandchild in a group of its own is gone too (C6)', { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-exec-hook-'));
    const pidFile = join(dir, 'pid');
    const file = join(dir, 'run.ts');
    const inner = `const g = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore', detached: true }); g.unref();
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setTimeout(() => {}, 60000);`;
    writeFileSync(file, `import { runProcess } from ${JSON.stringify(EXEC)};
void runProcess(process.execPath, ['-e', ${JSON.stringify(inner)}], { killGroup: true, timeoutMs: 120000 });
setInterval(() => {}, 1000);`);
    const p = start(file);
    const done = exited(p);
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '')).toBe(true);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    p.kill('SIGTERM');
    expect(await done).toEqual({ code: null, signal: 'SIGTERM' });
    const ok = await until(() => !alive(grandchild), 5000);
    if (!ok) process.kill(grandchild, 'SIGKILL');
    expect(ok).toBe(true);
  });
  it('process.exit(3): the code is kept and the grandchild is gone', { timeout: 30_000 }, async () => {
    const s = script((pidFile) => `setInterval(() => { if (existsSync(${JSON.stringify(pidFile)}) && readFileSync(${JSON.stringify(pidFile)}, 'utf8') !== '') process.exit(3); }, 50);`);
    const p = start(s.file);
    const done = exited(p);
    expect(await until(() => existsSync(s.pidFile) && readFileSync(s.pidFile, 'utf8') !== '')).toBe(true);   // not between its creation and its write (C6)
    const grandchild = Number(readFileSync(s.pidFile, 'utf8'));
    expect(await done).toEqual({ code: 3, signal: null });
    expect(await until(() => !alive(grandchild))).toBe(true);
  });
});
