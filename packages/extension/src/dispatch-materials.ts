import {
  referenceFileSchema,
  type DispatchCommand,
  type ImportManifest,
} from '@flow-batch/protocol';
import { signedRequest } from './api.js';
import { FlowInputError } from './flow-errors.js';

export interface PreparedFiles {
  manifest: ImportManifest;
  files: File[];
  stamp: string;
}

export async function readDispatchMaterials(
  command: DispatchCommand,
): Promise<PreparedFiles> {
  if (command.source !== 'managed')
    throw new FlowInputError(
      'Pedido antigo. Crie um novo pedido no painel local.',
    );
  const files: File[] = [];
  for (const reference of command.references) {
    const content = referenceFileSchema.parse(
      await signedRequest(command.clientId, 'POST', '/api/materials', {
        dispatchId: command.id,
        path: reference.path,
      }),
    );
    const bytes = Uint8Array.from(atob(content.base64), (character) =>
      character.charCodeAt(0),
    );
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (
      bytes.length !== reference.size ||
      hash !== reference.sha256 ||
      content.name !== reference.path
    )
      throw new FlowInputError(
        'A referência recebida não corresponde ao material autorizado.',
      );
    files.push(new File([bytes], reference.path, { type: content.mime }));
  }
  return { manifest: command.manifest, files, stamp: command.id };
}
