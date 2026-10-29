import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomInt, randomUUID, webcrypto } from 'node:crypto';
import {
  publicKeySchema,
  type PublicKey,
  type PairingReceipt,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

export interface Client {
  id: string;
  extensionId: string;
  publicKey: PublicKey;
  authorizedAt: number | null;
  revokedAt: number | null;
}

export class ClientStore {
  constructor(private readonly database: DatabaseSync) {}

  get(id: string): Client | undefined {
    const row = this.database
      .prepare('SELECT * FROM clients WHERE id = ?')
      .get(id);
    if (!row) return undefined;
    return {
      id: String(row.id),
      extensionId: String(row.extension_id),
      publicKey: publicKeySchema.parse(JSON.parse(String(row.public_key))),
      authorizedAt:
        row.authorized_at === null ? null : Number(row.authorized_at),
      revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    };
  }

  authorized(id: string, extensionId: string): Client {
    const client = this.get(id);
    if (
      !client ||
      client.extensionId !== extensionId ||
      client.authorizedAt === null
    )
      throw new HttpError(401, 'Unauthorized');
    if (client.revokedAt !== null) throw new HttpError(403, 'Revoked');
    return client;
  }

  async request(
    extensionId: string,
    publicKey: PublicKey,
    now = Date.now(),
  ): Promise<PairingReceipt> {
    await webcrypto.subtle.importKey(
      'jwk',
      publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    this.cleanup(now);
    const count = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM pairing_requests WHERE state = 'pending'",
      )
      .get();
    if (Number(count?.count) >= 20)
      throw new HttpError(429, 'Too many pending requests');
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([publicKey.x, publicKey.y]))
      .digest('hex');
    const existing = this.database
      .prepare(
        'SELECT id FROM clients WHERE extension_id = ? AND fingerprint = ?',
      )
      .get(extensionId, fingerprint);
    const clientId = existing ? String(existing.id) : randomUUID();
    if (!existing)
      this.database
        .prepare(
          'INSERT INTO clients (id, extension_id, public_key, fingerprint) VALUES (?, ?, ?, ?)',
        )
        .run(clientId, extensionId, JSON.stringify(publicKey), fingerprint);
    const requestId = randomUUID();
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const expiresAt = now + 120000;
    this.database
      .prepare(
        "UPDATE pairing_requests SET state = 'cancelled' WHERE client_id = ? AND state = 'pending'",
      )
      .run(clientId);
    this.database
      .prepare(
        "INSERT INTO pairing_requests (id,client_id,code,expires_at,state) VALUES (?,?,?,?,'pending')",
      )
      .run(requestId, clientId, code, expiresAt);
    return { requestId, clientId, code, expiresAt };
  }

  decide(requestId: string, approve: boolean, now = Date.now()): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database
        .prepare(
          "UPDATE pairing_requests SET state = ? WHERE id = ? AND state = 'pending' AND expires_at > ? RETURNING client_id",
        )
        .get(approve ? 'approved' : 'cancelled', requestId, now);
      if (!row) throw new HttpError(409, 'Request expired or already resolved');
      if (approve)
        this.database
          .prepare(
            'UPDATE clients SET authorized_at = ?, revoked_at = NULL WHERE id = ?',
          )
          .run(now, String(row.client_id));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  revoke(id: string): void {
    this.database
      .prepare('UPDATE clients SET revoked_at = ? WHERE id = ?')
      .run(Date.now(), id);
    this.database.prepare('DELETE FROM challenges WHERE client_id = ?').run(id);
    this.database
      .prepare(
        "UPDATE pairing_requests SET state = 'cancelled' WHERE client_id = ? AND state = 'pending'",
      )
      .run(id);
  }

  managementStatus(now = Date.now()): {
    pending: unknown[];
    clients: unknown[];
  } {
    this.cleanup(now);
    return {
      pending: this.database
        .prepare(
          "SELECT p.id,p.code,p.expires_at AS expiresAt,c.extension_id AS extensionId FROM pairing_requests p JOIN clients c ON c.id = p.client_id WHERE p.state = 'pending' ORDER BY p.expires_at",
        )
        .all(),
      clients: this.database
        .prepare(
          'SELECT id,extension_id AS extensionId,authorized_at AS authorizedAt,revoked_at AS revokedAt FROM clients WHERE authorized_at IS NOT NULL',
        )
        .all(),
    };
  }

  private cleanup(now: number): void {
    this.database
      .prepare(
        'DELETE FROM pairing_requests WHERE expires_at <= ? OR state != ?',
      )
      .run(now, 'pending');
    this.database
      .prepare('DELETE FROM challenges WHERE expires_at <= ?')
      .run(now);
    this.database
      .prepare(
        'DELETE FROM clients WHERE authorized_at IS NULL AND id NOT IN (SELECT client_id FROM pairing_requests)',
      )
      .run();
  }
}
