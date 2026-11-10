// Real Chrome through HyperFrames: the estimate of fitText against the ink of a rendered frame. `pnpm test:render`.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitText } from './index.ts';
import type { FitStyle } from './index.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HF = join(ROOT, 'node_modules/.bin/hyperframes');
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((p) => existsSync(p));
const CHROME = join(homedir(), '.cache/hyperframes/chrome');
const available = existsSync(HF) && existsSync(CHROME) && FFMPEG !== undefined;
const ENV = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };

const FONT_DIR = (dir: string) => join(ROOT, 'node_modules/@fontsource-variable', dir, 'files');
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

interface Case { copy: string; style: FitStyle; lines: number; loose?: boolean }      // loose: only the lower bound is asserted (the emoji of this machine)
interface Canvas { name: string; width: number; height: number; box: { left: number; width: number; height: number }; cases: Case[] }
const CANVASES: Canvas[] = [
  { name: '720x1280', width: 720, height: 1280, box: { left: 60, width: 600, height: 150 }, cases: [
    { copy: 'Kısa bir cümle', style: { font: 'Inter', weight: 800, size: 36 }, lines: 1 },
    { copy: "İstanbul'da ışıl ışıl çiçekli güzel bir öğle şöleni", style: { font: 'Montserrat', weight: 400, size: 34 }, lines: 1 },
    { copy: 'Üç hafta boyunca her gece sürdüm ve sonuç gerçekten çok şaşırtıcı oldu', style: { font: 'Inter', weight: 400, size: 40 }, lines: 2 },
    { copy: 'AVATAR To Yo WAVE Tavern Type', style: { font: 'Montserrat', weight: 900, size: 44 }, lines: 2 },
    { copy: 'Bunu mutlaka dene, çok güzel oldu gerçekten', style: { font: 'Inter', weight: 600, size: 38, tracking: 0.02 }, lines: 2 },
    { copy: 'İSTANBUL ŞEHRİ ĞÜ', style: { font: 'Inter', weight: 700, size: 44 }, lines: 1 },
    { copy: 'Negative tracking line', style: { font: 'Montserrat', weight: 700, size: 40, tracking: -0.05 }, lines: 1 },
    { copy: 'Çok güzel 😍 oldu', style: { font: 'Inter', weight: 600, size: 40 }, lines: 1, loose: true },
  ] },
  { name: '1080x1920', width: 1080, height: 1920, box: { left: 90, width: 900, height: 230 }, cases: [
    { copy: 'İlk gün hiçbir şey fark etmedim, ikinci hafta kirpiklerim gözle görülür şekilde uzadı, dördüncü haftada herkes sormaya başladı', style: { font: 'Montserrat', weight: 700, size: 52 }, lines: 3 },
    { copy: 'ÇOK GÜZEL ŞÖLEN ĞÜÖİ', style: { font: 'Inter', weight: 900, size: 90 }, lines: 1 },
    { copy: 'Wow, this works. Fifty-two ways to fit text!', style: { font: 'Inter', weight: 300, size: 64 }, lines: 2 },
    { copy: 'Yazı tipi ağırlığı değişince genişlik de değişir', style: { font: 'Montserrat', weight: 500, size: 60 }, lines: 2 },
    { copy: 'Last words: (almost) done — “quoted” & more…', style: { font: 'Montserrat', weight: 800, size: 56 }, lines: 2 },
    { copy: 'Weight four fifty here', style: { font: 'Inter', weight: 450, size: 48 }, lines: 1 },
    { copy: 'Weight four fifty here', style: { font: 'Montserrat', weight: 450, size: 48 }, lines: 1 },
    { copy: 'Weight six fifty there', style: { font: 'Inter', weight: 650, size: 48 }, lines: 1 },
    { copy: 'Weight six fifty there', style: { font: 'Montserrat', weight: 650, size: 48 }, lines: 1 },
  ] },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Row { loose: boolean; top: number; lineHeight: number; gap: number; estimates: number[]; lines: string[]; style: FitStyle; size: number }

function build(canvas: Canvas, dir: string): { rows: Row[] } {
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  let css = '';
  for (const [name, d] of [['Inter', 'inter'], ['Montserrat', 'montserrat']] as const) {
    for (const [part, range] of [['latin', LATIN], ['latin-ext', EXT]] as const) {
      const file = `${d}-${part}-wght-normal.woff2`;
      copyFileSync(join(FONT_DIR(d), file), join(dir, 'fonts', file));
      css += `@font-face { font-family: "${name}"; src: url("fonts/${file}") format("woff2"); font-weight: 100 900; font-display: block; unicode-range: ${range}; }\n`;
    }
  }
  const rows: Row[] = [];
  let body = '', track = 0, y = 20;
  for (const c of canvas.cases) {
    const r = fitText(c.copy, c.style, { width: canvas.box.width, height: canvas.box.height }, { lines: c.lines, shrink: 0.5 });
    if (!r.ok) throw new Error(`${c.copy}: ${r.code}`);
    const gap = Math.ceil(r.lineHeight * 0.5);          // vertical air between lines so one line's descenders never touch the next band
    rows.push({ loose: c.loose === true, top: y, lineHeight: r.lineHeight, gap, estimates: r.widths, lines: r.lines, style: c.style, size: r.size });
    r.lines.forEach((line, i) => {
      const letter = c.style.tracking ? `letter-spacing:${c.style.tracking}em;` : '';
      body += `      <div class="clip line" data-start="0" data-duration="1" data-track-index="${track++}" style="left:${canvas.box.left}px;top:${y + i * (r.lineHeight + gap)}px;height:${r.lineHeight}px;line-height:${r.lineHeight}px;font:${c.style.weight} ${r.size}px/${r.lineHeight}px '${c.style.font}';${letter}">${esc(line)}</div>\n`;
    });
    y += r.lines.length * (r.lineHeight + gap) + 20;
  }
  if (y > canvas.height) throw new Error(`rows need ${y} px, canvas is ${canvas.height}`);
  writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html lang="tr"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${canvas.width}, height=${canvas.height}" />
<style>
${css}* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${canvas.width}px; height: ${canvas.height}px; overflow: hidden; background: #000; }
#root { position: relative; width: 100%; height: 100%; background: #000; }
.line { position: absolute; white-space: nowrap; color: #fff; }
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-width="${canvas.width}" data-height="${canvas.height}" data-fps="30" data-duration="1" data-no-timeline>
${body}</div>
<script>
  window.__hf = window.__hf || {}; window.__hf.buildReady = window.__hf.buildReady || {};
  window.__hf.buildReady.fonts = Promise.all(['Inter', 'Montserrat'].flatMap((f) => [100, 300, 400, 500, 600, 700, 800, 900].map((w) => document.fonts.load(w + ' 40px "' + f + '"', 'AÀŞğİ'))));
</script>
</body></html>
`);
  return { rows };
}

function renderFrame(dir: string, canvas: Canvas): Uint8Array {
  const out = join(dir, 'out.mp4');
  const run = spawnSync(HF, ['render', dir, '--fps', '30', '--quality', 'looks', '--workers', '1', '--output', out], { env: ENV, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) throw new Error(`render failed (${run.status}): ${run.stderr.slice(-1500)}\n${run.stdout.slice(-1500)}`);
  const raw = spawnSync(FFMPEG!, ['-v', 'error', '-i', out, '-vf', 'select=eq(n\\,15)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 28 });
  if (raw.status !== 0 || raw.stdout.length !== canvas.width * canvas.height) throw new Error(`frame decode failed: ${raw.stderr?.toString()}`);
  return raw.stdout;
}

/** horizontal extent of the pixels brighter than 40 in a band of rows */
function ink(gray: Uint8Array, width: number, y0: number, y1: number): { minX: number; maxX: number } {
  let minX = Infinity, maxX = -Infinity;
  for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) {
    if (gray[y * width + x] > 40) { if (x < minX) minX = x; if (x + 1 > maxX) maxX = x + 1; }
  }
  return { minX, maxX };
}

describe.skipIf(!available)('fitText against a real render', () => {
  const report: string[] = [];
  for (const canvas of CANVASES) {
    it(`${canvas.name}: the estimate is never smaller than the ink and at most 2 % of the box wider`, () => {
      const dir = mkdtempSync(join(tmpdir(), 've-fit-render-'));
      const { rows } = build(canvas, dir);
      const gray = renderFrame(dir, canvas);
      for (const row of rows) {
        row.lines.forEach((line, i) => {
          const top = row.top + i * (row.lineHeight + row.gap);
          const { minX, maxX } = ink(gray, canvas.width, top - 2, top + row.lineHeight + 2);
          expect(maxX, `no ink for "${line}"`).toBeGreaterThan(minX);
          const inkWidth = maxX - minX;
          const estimate = row.estimates[i];
          const diff = estimate - inkWidth;
          report.push(`${canvas.name} ${row.style.font} ${row.style.weight}${row.style.tracking ? ` (tracking ${row.style.tracking})` : ''} ${row.size}px "${line.slice(0, 30)}": estimate ${estimate.toFixed(1)}, ink ${inkWidth}, diff ${diff.toFixed(1)} (${((diff / canvas.box.width) * 100).toFixed(2)} % of box)`);
          expect(estimate, `"${line}" estimate below ink`).toBeGreaterThanOrEqual(inkWidth);
          if (!row.loose) expect(diff, `"${line}" estimate too wide`).toBeLessThanOrEqual(canvas.box.width * 0.02);
        });
      }
      writeFileSync(join(dir, 'report.txt'), report.join('\n'));
      console.log(report.join('\n'));
    });
  }

  it('the checked-in metrics.json is what scripts/metrics.ts builds now, entry for entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 've-fit-table-'));
    const out = join(dir, 'metrics.json');
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts/metrics.ts'), out], { cwd: ROOT, env: ENV, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`metrics.ts failed (${run.status}): ${run.stderr.slice(-1500)}`);
    const built = JSON.parse(readFileSync(out, 'utf8')) as Record<string, { advances: Record<string, number[]> }>;
    const checkedIn = JSON.parse(readFileSync(join(ROOT, 'src/fit/metrics.json'), 'utf8')) as typeof built;
    expect(Object.keys(built).sort()).toEqual(Object.keys(checkedIn).sort());
    for (const font of ['Inter', 'Montserrat']) {
      expect(Object.keys(built[font].advances)).toEqual(Object.keys(checkedIn[font].advances));
      for (const ch of Object.keys(checkedIn[font].advances)) expect(built[font].advances[ch], `${font} ${ch}`).toEqual(checkedIn[font].advances[ch]);
    }
    expect(built).toEqual(checkedIn);
  });
});
