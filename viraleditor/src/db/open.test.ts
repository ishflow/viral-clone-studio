import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openDb } from './open.ts';

const TABLES = ['candidates', 'health', 'operations', 'provider_hold', 'runs', 'scans', 'settings', 'templates', 'usage'];

describe('openDb', () => {
  it('creates every table, creates the folder, and is idempotent', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'vc-')), 'sub', 'db.sqlite');
    const db = openDb(file);
    const names = () => (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(names()).toEqual(TABLES);
    db.close();
    const again = openDb(file);
    expect(again.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).toHaveLength(TABLES.length);
    again.close();
  });

  it('a database made before a column was added gets the column, with its default (R2fix, C7b minor 5)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'vc-')), 'db.sqlite');
    const schema = readFileSync(fileURLToPath(new URL('../../schema.sql', import.meta.url)), 'utf8');
    const old = schema.split('\n').filter((line) => !/^\s+(variants|video)\s/.test(line)).join('\n');
    expect(old).not.toContain('variants    TEXT');
    const before = new DatabaseSync(file);
    before.exec(old);
    before.prepare("INSERT INTO runs (id, kind, ref, input, created_at, updated_at) VALUES ('r1', 'scan', 's1', '{}', 't', 't')").run();
    before.close();
    const db = openDb(file);
    const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(columns('runs')).toContain('variants');
    expect(columns('candidates')).toContain('video');
    expect(db.prepare("SELECT variants FROM runs WHERE id = 'r1'").get()).toEqual({ variants: '[]' });
    db.close();
    openDb(file).close();                                                  // again: nothing left to add
  });

  it('a scans row of a database made before `queued` has it, 0', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'vc-')), 'db.sqlite');
    const schema = readFileSync(fileURLToPath(new URL('../../schema.sql', import.meta.url)), 'utf8');
    const old = schema.split('\n').filter((line) => !/^\s+queued\s/.test(line)).join('\n');
    expect(old).not.toContain('queued          INTEGER');
    const before = new DatabaseSync(file);
    before.exec(old);
    before.prepare("INSERT INTO scans (id, source, started_at, status) VALUES ('s1', 'shorts', 't', 'done')").run();
    before.close();
    const db = openDb(file);
    expect(db.prepare("SELECT queued FROM scans WHERE id = 's1'").get()).toEqual({ queued: 0 });
    db.close();
  });
});

it('migrates the old runs CHECK to admit closed without losing operations or indexes', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'vc-closed-')), 'db.sqlite');
  const schema = readFileSync(fileURLToPath(new URL('../../schema.sql', import.meta.url)), 'utf8').replace(", 'closed'", '').replace(",'closed'", '');
  const before = new DatabaseSync(file); before.exec(schema);
  before.prepare("INSERT INTO runs (id,kind,ref,input,created_at,updated_at) VALUES ('r','produce','j','{}','a','a')").run();
  before.prepare("INSERT INTO operations (run_id,key,kind,state,created_at,updated_at) VALUES ('r','k','image','done','a','a')").run();
  before.close();
  const db = openDb(file);
  expect(() => db.prepare("UPDATE runs SET state = 'closed' WHERE id = 'r'").run()).not.toThrow();
  expect(db.prepare('SELECT run_id FROM operations').get()).toEqual({ run_id: 'r' });
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'runs_once'").get()).toBeDefined();
  db.close(); openDb(file).close();
});
