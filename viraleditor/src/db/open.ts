import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from '../paths.ts';

const schemaFile = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema.sql');

interface Column { name: string; type: string; notnull: number; dflt_value: string | null }
const columnsOf = (db: DatabaseSync, table: string): Column[] => db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as Column[];

/**
 * A database made by an older version lacks the columns added since (`CREATE TABLE IF NOT EXISTS` leaves its tables as
 * they are). Each one is added with its type and default; one that cannot be (NOT NULL without a default) stops the start.
 */
function addMissingColumns(db: DatabaseSync, schema: string): void {
  const want = new DatabaseSync(':memory:');
  try {
    want.exec(schema);
    const tables = want.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name: table } of tables) {
      const have = new Set(columnsOf(db, table).map((c) => c.name));
      for (const c of columnsOf(want, table).filter((c) => !have.has(c.name))) {
        if (c.notnull && c.dflt_value === null) throw new Error(`the database was made by an older version: ${table}.${c.name} is missing and cannot be added (NOT NULL without a default)`);
        db.exec(`ALTER TABLE "${table}" ADD COLUMN "${c.name}" ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value === null ? '' : ` DEFAULT ${c.dflt_value}`}`);
      }
    }
  } finally {
    want.close();
  }
}

/** SQLite cannot ALTER a CHECK constraint. Rebuild atomically, preserving extension columns, indexes and triggers. */
function allowClosed(db: DatabaseSync): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() as { sql: string };
  if (row.sql.includes("'closed'")) return;
  const sql = row.sql.replace("'done','stopped'", "'done','stopped','closed'");
  if (sql === row.sql) throw new Error('runs state CHECK needs an explicit migration');
  const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'runs' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as { sql: string }[];
  const names = columnsOf(db, 'runs').map(column => `"${column.name}"`).join(',');
  const foreignKeys = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql.replace(/CREATE TABLE(?: IF NOT EXISTS)? ["`]?runs["`]?/i, 'CREATE TABLE runs_closed_migration'));
    db.exec(`INSERT INTO runs_closed_migration (${names}) SELECT ${names} FROM runs`);
    db.exec('DROP TABLE runs');
    db.exec('ALTER TABLE runs_closed_migration RENAME TO runs');
    for (const extra of extras) db.exec(extra.sql);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('runs migration failed foreign key check');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`); }
}

export function openDb(file: string = join(dataDir(), 'db.sqlite')): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  const schema = readFileSync(schemaFile, 'utf8');
  db.exec(schema);
  addMissingColumns(db, schema);
  allowClosed(db);
  return db;
}
