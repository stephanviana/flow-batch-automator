import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `CREATE TABLE application_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    INSERT INTO application_metadata (key, value) VALUES ('foundation', '1');`,
  },
  {
    version: 2,
    sql: `CREATE TABLE clients (
      id TEXT PRIMARY KEY, extension_id TEXT NOT NULL, public_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL, authorized_at INTEGER, revoked_at INTEGER,
      UNIQUE(extension_id, fingerprint)
    ) STRICT;
    CREATE TABLE pairing_requests (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id),
      code TEXT NOT NULL, expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','approved','cancelled'))
    ) STRICT;
    CREATE TABLE challenges (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id),
      payload TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE simulations (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id),
      connection_id TEXT NOT NULL, request_id TEXT NOT NULL,
      duration_ms INTEGER NOT NULL, state TEXT NOT NULL
      CHECK(state IN ('sent','running','completed','interrupted')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(client_id, request_id)
    ) STRICT;
    CREATE TABLE simulation_events (
      id INTEGER PRIMARY KEY, simulation_id TEXT NOT NULL REFERENCES simulations(id),
      state TEXT NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL
    ) STRICT;
    CREATE INDEX pairing_expiry ON pairing_requests(expires_at);
    CREATE INDEX challenge_expiry ON challenges(expires_at);`,
  },
];

export function migrate(
  database: DatabaseSync,
  steps: readonly Migration[] = migrations,
): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT`);
    const applied = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all();
    const expectedPrefix = steps
      .slice(0, applied.length)
      .map((step) => step.version);
    if (applied.some((row, index) => row.version !== expectedPrefix[index])) {
      throw new Error('Unsupported database migration history');
    }
    const record = database.prepare(
      'INSERT INTO schema_migrations (version) VALUES (?)',
    );
    for (const step of steps.slice(applied.length)) {
      database.exec(step.sql);
      record.run(step.version);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
