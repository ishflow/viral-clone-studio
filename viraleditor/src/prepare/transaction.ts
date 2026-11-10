import type { DatabaseSync } from 'node:sqlite';

/**
 * One BEGIN IMMEDIATE transaction: the write lock is taken before the first read, so what `run` reads is what it writes
 * over. Nothing asynchronous inside. A throw rolls everything back and goes on to the caller.
 */
export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
