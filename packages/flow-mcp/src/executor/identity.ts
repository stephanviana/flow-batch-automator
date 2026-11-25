import { webcrypto, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { publicKeySchema, type PublicKey } from '@flow-batch/protocol';
import { FlowBrowserError } from '../contracts.js';

const storedSchema = z.strictObject({
  version: z.literal(1),
  publicKey: publicKeySchema,
  privateKey: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export interface ExecutorIdentity {
  publicKey: PublicKey;
  privateKey: webcrypto.CryptoKey;
}

async function readIdentity(path: string): Promise<ExecutorIdentity> {
  const stored = storedSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const privateKey = await webcrypto.subtle.importKey(
    'pkcs8',
    Buffer.from(stored.privateKey, 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const publicKey = await webcrypto.subtle.importKey(
    'jwk',
    stored.publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const probe = new TextEncoder().encode('flow-browser-key-integrity');
  const signature = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    probe,
  );
  if (
    !(await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      probe,
    ))
  )
    throw new Error('Key mismatch');
  return { publicKey: stored.publicKey, privateKey };
}

export async function executorIdentity(
  home: string,
): Promise<ExecutorIdentity> {
  const path = join(home, 'executor-identity.json');
  try {
    return await readIdentity(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new FlowBrowserError(
        'executor_identity_invalid',
        'A identidade local é inválida ou não pode ser lida. Nenhuma identidade será substituída automaticamente.',
      );
  }
  await mkdir(home, { recursive: true, mode: 0o700 });
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const exported = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const publicKey = publicKeySchema.parse({
    kty: exported.kty,
    crv: exported.crv,
    x: exported.x,
    y: exported.y,
  });
  const privateKey = Buffer.from(
    await webcrypto.subtle.exportKey('pkcs8', pair.privateKey),
  ).toString('base64');
  const staging = join(home, `.identity-${randomUUID()}.tmp`);
  try {
    await writeFile(
      staging,
      JSON.stringify({ version: 1, publicKey, privateKey }),
      { flag: 'wx', mode: 0o600 },
    );
    try {
      await link(staging, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    await unlink(staging).catch(() => {});
  }
  return readIdentity(path);
}
