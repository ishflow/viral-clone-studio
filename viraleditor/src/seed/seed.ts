import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, Media } from '../ports.ts';
import * as candidates from '../db/candidates.ts';
import * as templates from '../db/templates.ts';
import { rel } from '../paths.ts';
import { cardOf } from '../template/card.ts';
import { minutesFor, paidFor } from '../template/estimate.ts';
import { Template } from '../template/schema.ts';

export interface SeedDeps { db: DatabaseSync; media: Media; clock: Clock; dataDir: string }
/** golden: folders `<id>/template.json` · productions: `<id>/drafts/final-v<N>.mp4` · candidates: any depth of `*.json` */
export interface SeedSources { golden: string; productions: string; candidates: string }

export type Status = 'written' | 'unchanged';
export interface SeedReport {
  templates: { id: string; status: Status; sample: boolean }[];
  candidates: { file: string; id: string | null; status: Status | 'skipped'; reason?: string }[];
  notes: string[];
}

const POSTER_SECOND = 1;

/** The newest finished draft of a production (`final-v<N>.mp4`, highest N), or null. */
function finishedVideo(productions: string, id: string): string | null {
  const dir = join(productions, id, 'drafts');
  if (!existsSync(dir)) return null;
  let best: { n: number; file: string } | null = null;
  for (const name of readdirSync(dir)) {
    const m = /^final-v(\d+)\.mp4$/.exec(name);
    if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), file: join(dir, name) };
  }
  return best?.file ?? null;
}

async function seedTemplate(deps: SeedDeps, sources: SeedSources, id: string, report: SeedReport): Promise<void> {
  const { db, media, clock, dataDir } = deps;
  const raw = readFileSync(join(sources.golden, id, 'template.json'), 'utf8');
  const template = Template.parse(JSON.parse(raw));
  const dir = join(dataDir, 'templates', id);
  mkdirSync(dir, { recursive: true });
  let changed = false;

  if (!existsSync(join(dir, 'template.json'))) { writeFileSync(join(dir, 'template.json'), raw); changed = true; }

  const source = finishedVideo(sources.productions, id);
  const sample = join(dir, 'sample.mp4'), poster = join(dir, 'poster.jpg');
  // Written next to the target and renamed, so a crash leaves a `.tmp` (overwritten next time), never a half file under the real name.
  if (source && !existsSync(sample)) { copyFileSync(source, sample + '.tmp'); renameSync(sample + '.tmp', sample); changed = true; }
  const hasSample = existsSync(sample);
  if (hasSample && !existsSync(poster)) {
    const tmp = join(dir, 'poster.tmp.jpg');
    await media.still(sample, POSTER_SECOND, tmp);
    renameSync(tmp, poster);
    changed = true;
  }
  if (!source && !hasSample) report.notes.push(`${id}: no finished video under productions, seeded ready without a sample`);

  const media_ = {
    image: existsSync(poster) ? rel('templates', id, 'poster.jpg') : null,
    video: hasSample ? rel('templates', id, 'sample.mp4') : null,
  };
  const row = templates.get(db, id);
  if (row) {
    // Keep everything the row already says (state, owner, note, counters); only the two card fields follow the files on disk.
    if (row.card.image !== media_.image || row.card.video !== media_.video) {
      templates.upsert(db, { ...row, card: { ...row.card, ...media_ } }, clock.now());
      changed = true;
    }
  } else {
    const card = cardOf(template, media_);
    templates.upsert(db, {
      id, state: 'ready', owner: null, sourceKind: 'seed', sourceUrl: template.source.url || null, note: null,
      card, estimate: paidFor(template, 1), minutes: minutesFor(template),
    }, clock.now());
    changed = true;
  }
  report.templates.push({ id, status: changed ? 'written' : 'unchanged', sample: hasSample });
}

/** `*.json` inside the sub-folders only: a file next to them (the page's `tr.json`) is not a candidate. */
function jsonFiles(dir: string, top = true): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsonFiles(full, false));
    else if (!top && name.endsWith('.json')) out.push(full);
  }
  return out;
}

const isBeat = (b: unknown) => typeof b === 'string' || (typeof b === 'object' && b !== null && !Array.isArray(b));

/** A candidate row from a file's JSON, or the reason it cannot be one. */
function candidateOf(j: unknown): { row: Omit<candidates.CandidateRow, 'foundAt' | 'updatedAt'> } | { reason: string } {
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return { reason: 'not an object' };
  const o = j as Record<string, unknown>;
  const text = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() !== '' ? (o[k] as string).trim() : null);
  const count = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : null);
  const url = text('url'), creator = text('creator'), seconds = count('duration_s'), views = count('views'), likes = count('likes');
  for (const [k, v] of [['url', url], ['creator', creator], ['duration_s', seconds], ['views', views], ['likes', likes]] as const)
    if (v === null) return { reason: `missing or invalid field: ${k}` };
  if (!/^https?:\/\//.test(url!)) return { reason: 'invalid field: url' };
  if (!Array.isArray(o.beats) || o.beats.length === 0 || !o.beats.every(isBeat)) return { reason: 'missing or invalid field: beats' };
  const id = 'c-' + (/\/video\/(\d+)/.exec(url!)?.[1] ?? url!.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60));
  const format = text('format');
  return {
    row: {
      id, scanId: null, source: 'manual', url: url!, title: format ? `${creator}: ${format}` : creator!,
      views: views!, likes: likes!, seconds: seconds!, state: 'found', score: null, scoreNotes: null, image: null,
    },
  };
}

function seedCandidates(deps: SeedDeps, sources: SeedSources, report: SeedReport): void {
  for (const full of jsonFiles(sources.candidates)) {
    const file = relative(sources.candidates, full).split('\\').join('/');
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(full, 'utf8')); } catch { report.candidates.push({ file, id: null, status: 'skipped', reason: 'not valid JSON' }); continue; }
    const made = candidateOf(parsed);
    if ('reason' in made) { report.candidates.push({ file, id: null, status: 'skipped', reason: made.reason }); continue; }
    const { row } = made;
    if (candidates.get(deps.db, row.id)) { report.candidates.push({ file, id: row.id, status: 'unchanged' }); continue; }
    candidates.upsert(deps.db, row, deps.clock.now());
    report.candidates.push({ file, id: row.id, status: 'written' });
  }
}

export async function seed(deps: SeedDeps, sources: SeedSources): Promise<SeedReport> {
  const report: SeedReport = { templates: [], candidates: [], notes: [] };
  const ids = readdirSync(sources.golden).sort().filter((n) => existsSync(join(sources.golden, n, 'template.json')));
  for (const id of ids) await seedTemplate(deps, sources, id, report);
  if (existsSync(sources.candidates)) seedCandidates(deps, sources, report);
  else report.notes.push(`candidates folder not found: ${sources.candidates}`);
  return report;
}

export function formatReport(r: SeedReport): string {
  const count = (list: { status: string }[], s: string) => list.filter((x) => x.status === s).length;
  const lines = [
    `templates: ${count(r.templates, 'written')} written, ${count(r.templates, 'unchanged')} unchanged`,
    ...r.templates.map((t) => `  ${t.status.padEnd(9)} ${t.id}${t.sample ? '' : ' (no sample)'}`),
    `candidates: ${count(r.candidates, 'written')} written, ${count(r.candidates, 'unchanged')} unchanged, ${count(r.candidates, 'skipped')} skipped`,
    ...r.candidates.filter((c) => c.status === 'skipped').map((c) => `  skipped   ${c.file}: ${c.reason}`),
    ...r.notes.map((n) => `note: ${n}`),
  ];
  return lines.join('\n');
}
