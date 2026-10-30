export const queueMigration = `
CREATE TABLE queue_controls (
  client_id TEXT PRIMARY KEY REFERENCES clients(id),running INTEGER NOT NULL DEFAULT 0 CHECK(running IN (0,1))
) STRICT;
CREATE TABLE queue_requests (
  client_id TEXT NOT NULL REFERENCES clients(id),request_id TEXT NOT NULL,body_hash TEXT NOT NULL,
  task_ids TEXT NOT NULL,PRIMARY KEY(client_id,request_id)
) STRICT;
CREATE TABLE queue_tasks (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES clients(id),task_key TEXT NOT NULL,input TEXT NOT NULL,input_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','dispatching','submitted','generating','download_pending','completed','failed','uncertain','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,active_attempt_id TEXT,connection_id TEXT,deadline_at INTEGER,
  generation_id TEXT,result TEXT,last_error TEXT,safe_to_retry INTEGER NOT NULL DEFAULT 0,
  UNIQUE(client_id,task_key)
) STRICT;
CREATE UNIQUE INDEX queue_single_active ON queue_tasks((1)) WHERE state IN ('dispatching','submitted','generating','download_pending');
CREATE INDEX queue_pending ON queue_tasks(state,next_attempt_at,sequence);
CREATE TABLE queue_attempts (
  id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES queue_tasks(id),number INTEGER NOT NULL,
  connection_id TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER,
  state TEXT NOT NULL,generation_id TEXT,error TEXT,UNIQUE(task_id,number)
) STRICT;
CREATE TABLE queue_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL REFERENCES queue_tasks(id),
  state TEXT NOT NULL,at INTEGER NOT NULL,attempt_id TEXT,reason TEXT NOT NULL,error TEXT
) STRICT;
CREATE TABLE queue_actions (
  client_id TEXT NOT NULL REFERENCES clients(id),request_id TEXT NOT NULL,body_hash TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES queue_tasks(id),PRIMARY KEY(client_id,request_id)
) STRICT;`;
