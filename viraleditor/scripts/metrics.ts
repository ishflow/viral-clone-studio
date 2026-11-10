// Rebuilds src/fit/metrics.json: the advance of every covered character, per font and weight, in thousandths of an em,
// measured with canvas.measureText at 1000 px in the headless Chrome that HyperFrames downloaded (driven by playwright-core).
// No network: a file:// page with the local woff2 files of @fontsource-variable/inter and /montserrat (latin, latin-ext).
// A character that Inter or Montserrat does not contain would be measured in a system fallback font, which differs between machines
// and runs: it is detected (its width changes with the fallback font) and left out of the table, so the table is the same on every build.
// usage: node scripts/metrics.ts [output.json]   (from viraleditor/; the default output is src/fit/metrics.json)
import { chromium } from 'playwright-core';
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.argv[2] ?? join(ROOT, 'src/fit/metrics.json');
const FAMILIES = [{ name: 'Inter', dir: 'inter' }, { name: 'Montserrat', dir: 'montserrat' }] as const;
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

// the candidates of design §5.8: printable ASCII, U+00A0–U+017F, ten punctuation marks (minus the ones a font lacks)
const CODES: number[] = [];
for (let c = 0x20; c <= 0x7e; c++) CODES.push(c);
for (let c = 0xa0; c <= 0x17f; c++) CODES.push(c);
CODES.push(0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac, 0x2122);

/** the newest chrome-headless-shell build HyperFrames downloaded */
function chromeBuild(): string {
  const base = join(homedir(), '.cache/hyperframes/chrome/chrome-headless-shell');
  const builds = readdirSync(base).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const build of builds.reverse()) {
    const exe = join(base, build, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  throw new Error(`no chrome-headless-shell under ${base}`);
}

const fontFiles = (dir: string) => join(ROOT, 'node_modules/@fontsource-variable', dir, 'files');
const css = FAMILIES.map(({ name, dir }) => [
  `@font-face { font-family: "${name}"; src: url("file://${fontFiles(dir)}/${dir}-latin-wght-normal.woff2") format("woff2"); font-weight: 100 900; unicode-range: ${LATIN}; }`,
  `@font-face { font-family: "${name}"; src: url("file://${fontFiles(dir)}/${dir}-latin-ext-wght-normal.woff2") format("woff2"); font-weight: 100 900; unicode-range: ${EXT}; }`,
].join('\n')).join('\n');
const tmp = mkdtempSync(join(tmpdir(), 've-metrics-'));
writeFileSync(join(tmp, 'page.html'), `<!doctype html><meta charset="utf-8"><style>${css}</style><body></body>`);

const executablePath = chromeBuild();
const browser = await chromium.launch({ executablePath, headless: true, args: ['--allow-file-access-from-files'] });
try {
  const page = await browser.newPage();
  await page.goto(`file://${tmp}/page.html`);
  // a string, not a function: this file is typechecked without the DOM types
  const script = `(async () => {
    const codes = ${JSON.stringify(CODES)}, weights = ${JSON.stringify(WEIGHTS)}, families = ${JSON.stringify(FAMILIES.map((f) => f.name))};
    const out = { missing: {} };
    const ctx = document.createElement('canvas').getContext('2d');
    const width = (font, ch) => { ctx.font = font; return ctx.measureText(ch).width; };
    for (const family of families) {
      for (const w of weights) await document.fonts.load(w + ' 1000px "' + family + '"', 'AÀŞğ');
      const advances = {}, missing = [];
      for (const code of codes) {
        const ch = String.fromCodePoint(code);
        // the same text with two different fallback fonts: only a character the family lacks changes its width
        if (width('400 1000px "' + family + '", serif', ch) !== width('400 1000px "' + family + '", monospace', ch)) { missing.push(ch); continue; }
        advances[ch] = weights.map((w) => Math.round(width(w + ' 1000px "' + family + '"', ch) * 10) / 10);
      }
      const m = (ctx.font = '400 1000px "' + family + '"', ctx.measureText('Hg'));
      out[family] = { weights, ascent: Math.round(m.fontBoundingBoxAscent), descent: Math.round(m.fontBoundingBoxDescent), advances };
      out.missing[family] = missing;
    }
    out.loaded = [...document.fonts].filter((f) => f.status === 'loaded').length;
    return out;
  })()`;
  const raw = (await page.evaluate(script)) as { missing: Record<string, string[]>; loaded: number } & Record<string, unknown>;
  const { missing, loaded, ...result } = raw;

  const tables = result as unknown as Record<string, { advances: Record<string, number[]> }>;
  for (const { name } of FAMILIES) {
    for (const ch of 'İıŞşĞğÜüÖöÇç') if (!tables[name].advances[ch]) throw new Error(`${name} has no entry for ${ch}`);
    // a letter that fell back to a system font would have the same advance as the fallback for every weight
    if (new Set(tables[name].advances['ş']).size < 3) throw new Error(`${name}: weights do not change the advance of ş, the font did not load`);
  }
  writeFileSync(OUT, JSON.stringify(result));
  const entries = FAMILIES.reduce((n, { name }) => n + Object.keys(tables[name].advances).length * WEIGHTS.length, 0);
  const left = FAMILIES.map(({ name }) => `${name} ${missing[name].length ? 'lacks ' + missing[name].map((c) => 'U+' + (c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')).join(' ') : 'lacks nothing'}`).join('; ');
  console.log(`wrote ${OUT}: ${entries} entries (${Object.keys(tables.Inter.advances).length} + ${Object.keys(tables.Montserrat.advances).length} characters × ${WEIGHTS.length} weights); ${left}; font faces loaded ${loaded}; Chrome ${executablePath}`);
} finally {
  await browser.close();
}
