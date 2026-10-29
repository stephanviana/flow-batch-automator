interface Identity {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}
let identityPromise: Promise<Identity> | undefined;

function openIdentityDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('flow-batch-identity', 1);
    request.onupgradeneeded = (): void => {
      request.result.createObjectStore('keys');
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void =>
      reject(new Error('Identity database unavailable'));
  });
}

async function loadOrCreateIdentity(): Promise<Identity> {
  const database = await openIdentityDatabase();
  try {
    const stored = await new Promise<Identity | undefined>(
      (resolve, reject) => {
        const transaction = database.transaction('keys', 'readonly');
        const request = transaction.objectStore('keys').get('identity');
        transaction.oncomplete = (): void =>
          resolve(request.result as Identity | undefined);
        transaction.onerror = (): void =>
          reject(new Error('Identity read failed'));
      },
    );
    if (stored) return stored;
    const identity = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    );
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('keys', 'readwrite');
      transaction.objectStore('keys').add(identity, 'identity');
      transaction.oncomplete = (): void => resolve();
      transaction.onerror = (): void =>
        reject(new Error('Identity persistence failed'));
      transaction.onabort = (): void =>
        reject(new Error('Identity persistence aborted'));
    });
    return identity;
  } finally {
    database.close();
  }
}

export function getIdentity(): Promise<Identity> {
  identityPromise ??= loadOrCreateIdentity().catch((error: unknown): never => {
    identityPromise = undefined;
    throw error;
  });
  return identityPromise;
}
