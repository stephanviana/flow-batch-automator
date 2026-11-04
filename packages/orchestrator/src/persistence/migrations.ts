import type { DatabaseSync } from 'node:sqlite';
import { queueMigration } from './queue-migration.js';
import { orderMigration } from './order-migration.js';

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
  { version: 3, sql: queueMigration },
  {
    version: 4,
    sql: `CREATE TABLE queue_checkpoints (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES queue_tasks(id),
    attempt_id TEXT NOT NULL REFERENCES queue_attempts(id),
    stage TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL,
    UNIQUE(attempt_id,stage)
  ) STRICT;`,
  },
  {
    version: 5,
    sql: `CREATE TABLE flow_batches (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id),
      name TEXT NOT NULL, mode TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','creating','ready','uncertain')),
      project_id TEXT, project_title TEXT, creation_attempt_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX batches_client ON flow_batches(client_id);
    ALTER TABLE queue_tasks ADD COLUMN batch_id TEXT REFERENCES flow_batches(id);`,
  },
  {
    version: 6,
    sql: `CREATE TABLE dispatch_commands (
      id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id),
      body TEXT NOT NULL,body_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','queued','blocked')),
      message TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX dispatch_client ON dispatch_commands(client_id,created_at);
    CREATE INDEX dispatch_manifest ON dispatch_commands(client_id,json_extract(body,'$.manifest.id'));`,
  },
  { version: 7, sql: orderMigration },
  {
    version: 8,
    sql: `CREATE TABLE order_library_bindings (
    order_id TEXT NOT NULL REFERENCES production_orders(id),
    lease_id TEXT NOT NULL, revision TEXT NOT NULL,
    PRIMARY KEY(order_id,lease_id)
  ) STRICT;`,
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
