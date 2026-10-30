import {
  flowReferenceSchema,
  type FlowReference,
  type FlowDraft,
} from '@flow-batch/protocol';

interface StoredReference {
  reference: FlowReference;
  base64: string;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('flow-batch-assets', 1);
    request.onupgradeneeded = (): void => {
      request.result.createObjectStore('references');
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void =>
      reject(new Error('Armazenamento de referências indisponível.'));
  });
}
async function assetOperation<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('references', mode);
      const request = operation(transaction.objectStore('references'));
      transaction.oncomplete = (): void => resolve(request.result);
      transaction.onerror = transaction.onabort = (): void =>
        reject(new Error('Não foi possível preservar a referência.'));
    });
  } finally {
    db.close();
  }
}
function imageBytes(
  base64: string,
  mime: FlowReference['mime'],
): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  );
  const png =
    bytes[0] === 137 &&
    String.fromCharCode(...bytes.slice(1, 8)) === 'PNG\r\n\x1a\n';
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (
    bytes.length > 8_388_608 ||
    !(mime === 'image/png' ? png : mime === 'image/jpeg' ? jpeg : webp)
  )
    throw new Error(
      'Selecione uma imagem JPEG, PNG ou WebP válida, com até 8 MB.',
    );
  return bytes;
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
export async function saveReference(draft: FlowDraft): Promise<FlowReference> {
  const bytes = imageBytes(draft.reference.base64, draft.reference.mime);
  const reference = flowReferenceSchema.parse({
    assetId: draft.taskKey,
    name: draft.reference.name,
    mime: draft.reference.mime,
    bytes: bytes.length,
    sha256: await digest(bytes),
  });
  const previous: unknown = await assetOperation('readonly', (store) =>
    store.get(reference.assetId),
  );
  if (
    previous &&
    JSON.stringify((previous as StoredReference).reference) !==
      JSON.stringify(reference)
  )
    throw new Error('Esta referência já foi preservada com outros dados.');
  await assetOperation('readwrite', (store) =>
    store.put({ reference, base64: draft.reference.base64 }, reference.assetId),
  );
  return reference;
}
export async function loadReference(reference: FlowReference): Promise<string> {
  const stored: unknown = await assetOperation('readonly', (store) =>
    store.get(reference.assetId),
  );
  if (
    !stored ||
    typeof stored !== 'object' ||
    !('base64' in stored) ||
    typeof stored.base64 !== 'string' ||
    !('reference' in stored)
  )
    throw new Error('A referência local não foi encontrada nesta extensão.');
  const metadata = flowReferenceSchema.parse(stored.reference);
  if (
    JSON.stringify(metadata) !== JSON.stringify(reference) ||
    (await digest(imageBytes(stored.base64, reference.mime))) !==
      reference.sha256
  )
    throw new Error(
      'A referência local mudou. Selecione o arquivo original novamente.',
    );
  return stored.base64;
}
