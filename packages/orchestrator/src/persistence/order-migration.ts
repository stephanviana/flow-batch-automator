export const orderMigration = `
CREATE TABLE materials (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL,
 size INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('available','deleting','deleted'))
) STRICT;
CREATE TABLE production_orders (
 number INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 body TEXT NOT NULL, body_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('awaiting-preparation','preparing','prepared','dispatched','cancelled')),
 created_at INTEGER NOT NULL, lease_id TEXT, lease_worker TEXT, lease_expires_at INTEGER,
 preparation TEXT, preparation_hash TEXT
) STRICT;
CREATE TABLE order_materials (
 order_id TEXT NOT NULL REFERENCES production_orders(id),
 material_id TEXT NOT NULL REFERENCES materials(id), PRIMARY KEY(order_id,material_id)
) STRICT;
CREATE TABLE order_dispatches (
 order_id TEXT NOT NULL REFERENCES production_orders(id),
 dispatch_id TEXT NOT NULL UNIQUE REFERENCES dispatch_commands(id),
 batch_id TEXT NOT NULL UNIQUE, PRIMARY KEY(order_id,dispatch_id)
) STRICT;
CREATE TABLE order_preparations (
 order_id TEXT NOT NULL REFERENCES production_orders(id), hash TEXT NOT NULL,
 body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(order_id,hash)
) STRICT;
`;
