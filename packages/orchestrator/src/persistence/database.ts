import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations.js';

export function openDatabase(
  filename: string,
  busyTimeoutMs: number,
): DatabaseSync {
  mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename, {
    enableForeignKeyConstraints: true,
  });
  try {
    database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    const journal = database.prepare('PRAGMA journal_mode = WAL').get();
    if (journal?.journal_mode !== 'wal')
      throw new Error('SQLite WAL is unavailable');
    database.exec('PRAGMA synchronous = NORMAL');
    migrate(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function isDatabaseReady(database: DatabaseSync): boolean {
  try {
    // Exercise the real persisted schema as well as SQLite's connection.
    return (
      database
        .prepare(
          "SELECT value FROM application_metadata WHERE key = 'foundation'",
        )
        .get()?.value === '1'
    );
  } catch {
    return false;
  }
}
