// The world of the real end-to-end specs: a temp data dir seeded by the engine, the real worker (fake provider, scripted LLM) and
// the real site (`next start` of a production build) as child processes of the test run. Nothing paid, no network beyond localhost.
// One world per spec file (beforeAll / afterAll): the site restarts with it, so the in-memory auth rate limits start empty.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const PORT = 3200;
export const BASE = `http://127.0.0.1:${PORT}`;
export const ADMIN_EMAIL = 'admin@viralclone.app';
export const ADMIN_PASSWORD = 'admin-password-for-e2e-1';
const SESSION_SECRET = 'e2e-session-secret-0123456789-abcdefghij';
const WEB = resolve(__dirname, '..', '..');
const ENGINE = resolve(WEB, '..', 'viraleditor');
export const PRODUCT_1 = join(WEB, 'e2e', 'fixtures', 'product-1.png');
export const PRODUCT_2 = join(WEB, 'e2e', 'fixtures', 'product-2.png');

export interface Proc { child: ChildProcess; exited: Promise<void>; output: () => string }
export interface LogLine { kind: 'image' | 'clip' | 'music' | 'voice'; words: string; seconds: number | null; ticket: string }
export interface Mail { kind: string; to: string; at: string; data: Record<string, string> }

function launch(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Proc {
  // detached: its own process group, so the whole group ends together (next start may fork)
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let text = '';
  const keep = (b: Buffer) => { text = (text + b.toString()).slice(-3000); };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  return { child, exited, output: () => text };
}

async function end(proc: Proc | undefined, signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
  if (!proc || proc.child.exitCode !== null || proc.child.signalCode !== null) return;
  try { process.kill(-proc.child.pid!, signal); } catch { proc.child.kill(signal); }
  await Promise.race([proc.exited, new Promise((r) => setTimeout(r, 12_000))]);
  if (proc.child.exitCode === null && proc.child.signalCode === null) { try { process.kill(-proc.child.pid!, 'SIGKILL'); } catch { /* gone */ } await proc.exited; }
}

export async function until<T>(what: string, ms: number, check: () => T | null | false | undefined, every = 300): Promise<T> {
  const stop = Date.now() + ms;
  for (;;) {
    const got = check();
    if (got) return got;
    if (Date.now() > stop) throw new Error(`timed out (${ms} ms) waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

export interface WorldOptions { failClip?: number; port?: number; distDir?: string; siteEnv?: Record<string, string> }

export class World {
  get base(): string { return `http://127.0.0.1:${this.options.port ?? PORT}`; }
  dir = mkdtempSync(join(tmpdir(), 'vc-real-e2e-'));
  generatorLog = join(this.dir, 'generator.log');
  worker: Proc | undefined;
  site: Proc | undefined;
  constructor(private options: WorldOptions = {}) {}

  static async start(options: WorldOptions = {}): Promise<World> {
    const free = spawnSync('df', ['-k', '/System/Volumes/Data'], { encoding: 'utf8' }).stdout.trim().split('\n').pop()!.split(/\s+/);
    if (Number(free[3]) < 10 * 1024 * 1024) throw new Error('less than 10 GB free: not starting a world');
    const world = new World(options);
    try {
      const seeded = spawnSync('node', [join(WEB, 'e2e', 'real', 'seed-world.mjs'), world.dir], { cwd: ENGINE, encoding: 'utf8', timeout: 120_000 });
      if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr.slice(-500)}`);
      world.startWorker();   // the worker first: it creates the db the site opens
      await until('the worker has made the db', 20_000, () => existsSync(join(world.dir, 'db.sqlite')));
      await world.startSite();
    } catch (error) {
      await world.stop();
      throw error;
    }
    return world;
  }

  startWorker(): void {
    const env: NodeJS.ProcessEnv = {
      ...process.env, VC_DATA_DIR: this.dir, VC_FAKE_GENERATOR_LOG: this.generatorLog, VC_LLM_SCRIPT: join(this.dir, 'answers.json'),
      VC_FAKE_DELAY_MS: '1500', HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', NO_COLOR: '1',
    };
    delete env.VC_PROVIDER;
    if (this.options.failClip !== undefined) env.VC_FAKE_FAIL_CLIP = String(this.options.failClip);
    this.worker = launch('node', ['src/worker/main.ts'], ENGINE, env);
  }

  async startSite(): Promise<void> {
    const env: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: 'production', PORT: String(this.options.port ?? PORT), NEXT_DIST_DIR: this.options.distDir ?? '.next-real', NEXT_TELEMETRY_DISABLED: '1',
      VC_ENGINE: 'sqlite', VC_DATA_DIR: this.dir, VC_SESSION_SECRET: SESSION_SECRET, VC_ADMIN_PASSWORD: ADMIN_PASSWORD,
    };
    for (const name of ['VC_PROVIDER', 'VC_DEMO_LINKS', 'VC_TRUST_PROXY', 'VC_DEV_PASSWORD']) delete env[name];
    Object.assign(env, this.options.siteEnv ?? {});
    this.site = launch('node', ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(this.options.port ?? PORT)], WEB, env);
    await this.waitForSite();
  }

  private async waitForSite(): Promise<void> {
    const stop = Date.now() + 60_000;
    for (;;) {
      try {
        const r = await fetch(`${this.base}/login`, { redirect: 'manual' });
        if (r.status === 200) return;
      } catch { /* not listening yet */ }
      if (Date.now() > stop) throw new Error(`the site did not come up: ${this.site?.output().slice(-400)}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async killSite(): Promise<void> { await end(this.site); }
  async restartSite(): Promise<void> { await this.killSite(); await this.startSite(); }
  /** SIGTERM: the worker hands its run back at once. SIGKILL would make the next worker wait for the 60 s heartbeat. */
  async killWorker(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> { await end(this.worker, signal); }

  async stop(): Promise<void> {
    await end(this.site);
    await end(this.worker);
  }

  /** What the fake generator was asked for, one line per paid request. */
  generated(): LogLine[] {
    return existsSync(this.generatorLog)
      ? readFileSync(this.generatorLog, 'utf8').split('\n').filter((row) => row !== '').map((row) => JSON.parse(row) as LogLine)
      : [];
  }

  /** Paths (under the data dir) of the product images the runs were made with, read from the engine's db. */
  uploadedPaths(): string[] {
    const db = new DatabaseSync(join(this.dir, 'db.sqlite'), { readOnly: true });
    try {
      const rows = db.prepare('SELECT input FROM runs').all() as { input: string }[];
      return rows.flatMap((row) => (JSON.parse(row.input) as { products?: { images: string[] }[] }).products?.flatMap((p) => p.images) ?? []);
    } finally { db.close(); }
  }

  /** The outbox of the fake mailer, newest first (the site keeps it in site.json). */
  mails(to: string, kind: string): Mail[] {
    const file = join(this.dir, 'site.json');
    if (!existsSync(file)) return [];
    try {
      const outbox = (JSON.parse(readFileSync(file, 'utf8')) as { outbox?: Mail[] }).outbox ?? [];
      return outbox.filter((mail) => mail.to === to && mail.kind === kind).sort((a, b) => b.at.localeCompare(a.at));
    } catch { return []; }   // half-written: the next poll reads it whole
  }

  /** The link in the newest mail of that kind to that address: the verification link or the reset link. */
  async link(to: string, kind: 'verify' | 'reset', notIn: string[] = []): Promise<string> {
    const mail = await until(`a ${kind} mail to ${to}`, 20_000, () => this.mails(to, kind).find((m) => !notIn.includes(m.data.token ?? '')));
    const token = encodeURIComponent(mail.data.token ?? '');
    return kind === 'verify' ? `${this.base}/verify-email/confirm?token=${token}` : `${this.base}/reset-password?token=${token}`;
  }
}

export const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@example.com`;

/** Answers the cookie notice with "Only necessary" through the cookie itself (the notice is covered by the buttons spec). */
export async function noNotice(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'vc_cookies', value: 'necessary', url: BASE }]);
}

export async function signUp(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
}

export async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

/** Signs out through the header's account menu is UI-specific; the cookie is all a sign-out removes. */
export async function signOut(context: BrowserContext): Promise<void> {
  await context.clearCookies({ name: 'vc_session' });
}

/** The admin adds credits to a customer through the admin users page (the only way to give a customer credits without a payment provider). */
export async function addCredits(page: Page, email: string, amount: number, reason: string): Promise<void> {
  await logIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`${BASE}/admin/users?q=${encodeURIComponent(email)}`);
  await page.getByRole('row').filter({ hasText: email }).getByRole('link', { name: 'Open' }).click();
  const form = page.getByRole('group', { name: 'Add credits' });
  await form.getByLabel('Credits to add').fill(String(amount));
  await form.getByRole('button', { name: 'Add credits' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add credits' });
  await dialog.getByLabel('Reason').fill(reason);
  await dialog.getByRole('button', { name: 'Add credits' }).click();
  await expect(page.getByRole('dialog', { name: 'Done' })).toBeVisible();
}

/** A customer who signed up and opened the verification link from the outbox (the sign-up leaves them logged in). */
export async function newCustomer(world: World, page: Page, prefix = 'cust'): Promise<{ email: string; password: string }> {
  const email = unique(prefix);
  const password = 'a-long-password';
  await signUp(page, email, password);
  await page.goto(await world.link(email, 'verify'));
  await expect(page).toHaveURL(/\/welcome$/);
  return { email, password };
}

/** The generate form of the seeded template (4 products): names and the two fixture images, alternating. Does not click "Generate". */
export async function fillGenerateForm(page: Page, quality: 'Fast' | 'Best' = 'Fast'): Promise<void> {
  for (let n = 1; n <= 4; n += 1) {
    const block = page.getByRole('group', { name: `Product ${n}`, exact: true });
    await block.getByLabel('Product name').fill(`Real E2E Serum ${n}`);
    await block.getByLabel('Add image').setInputFiles(n % 2 === 1 ? PRODUCT_1 : PRODUCT_2);
    await expect(block.getByAltText('Uploaded product image')).toHaveCount(1);
  }
  if (quality === 'Best') await page.getByRole('group', { name: 'Quality' }).getByText('Best', { exact: true }).click();
}

/** Opens the confirmation dialog (clicks "Generate"). */
export async function openConfirm(page: Page) {
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm generation' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** "Confirm and generate" and wait for the job page; returns its path. */
export async function confirmJob(page: Page): Promise<string> {
  await page.getByRole('dialog', { name: 'Confirm generation' }).getByRole('button', { name: 'Confirm and generate' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}

/** The number in the header's credits chip ("42 credits"). */
export async function headerCredits(page: Page): Promise<number> {
  const text = await page.locator('header:visible').first().innerText();
  const m = /(\d+)\s+credits?/.exec(text);
  if (!m) throw new Error(`no credits in the header: ${text.slice(0, 120)}`);
  return Number(m[1]);
}

/** A verified customer with `credits` (granted by the admin through the admin UI). */
export async function customerWithCredits(world: World, page: Page, browser: Browser, credits: number, prefix: string): Promise<string> {
  const { email } = await newCustomer(world, page, prefix);
  const adminContext = await browser.newContext();
  await addCredits(await adminContext.newPage(), email, credits, 'real e2e');
  await adminContext.close();
  return email;
}

/** Starts a Best-quality job from the seeded template and returns its path and the confirmed cost. */
export async function startBestJob(page: Page): Promise<{ jobPath: string; cost: number }> {
  await page.goto(`${BASE}/templates/layering-01/generate`);
  await fillGenerateForm(page, 'Best');
  const dialog = await openConfirm(page);
  const text = (await dialog.getByText('Credits for this job').locator('..').innerText()).replace('Credits for this job', '');
  const cost = Number(/(\d+)/.exec(text)![1]);
  return { jobPath: await confirmJob(page), cost };
}

/** The job page says "Your video is ready." */
export async function expectReady(page: Page, ms = 120_000): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: /ready/i })).toBeVisible({ timeout: ms });
}
