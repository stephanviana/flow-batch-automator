import type { FlowRpcReply, FlowRpcRequest } from './flow-rpc-contract.js';
import { callFlowRpc } from './flow-rpc.js';
import { projectImageTiles } from './flow-image-tile.js';
import { sameId } from './flow-media-id.js';

type Read = (request: FlowRpcRequest) => Promise<FlowRpcReply>;
type FrameLookup =
  | { ok: true; mediaId: string; via: 'tile' | 'asset' }
  | { ok: false; message: string };

export async function resolveSourceFrame(
  read: Read,
  projectId: string,
  sourceMediaId: string,
  findTiles?: (ids: string[]) => Promise<string[]>,
): Promise<FrameLookup> {
  const context = {
    projectId,
    sourceMediaId,
    mediaKind: 'image' as const,
    timeoutMs: 20000,
  };
  const listing = await read({
    ...context,
    rpcId: 'Zzl0ze',
    payload: [`projects/${projectId}`, null, null, null, [1]],
  });
  if (findTiles) {
    const keys = [sourceMediaId];
    if (listing.ok && listing.value.sourceFound) {
      if (listing.value.mediaId) keys.push(listing.value.mediaId);
      if (listing.value.operationId) keys.push(listing.value.operationId);
    }
    const tiles = await findTiles(keys);
    if (tiles.length === 1 && tiles[0])
      return { ok: true, mediaId: tiles[0], via: 'tile' };
    if (tiles.length > 1)
      return {
        ok: false,
        message:
          'Mais de uma imagem do projeto corresponde ao frame de origem.',
      };
  }
  if (!listing.ok) return { ok: false, message: listing.message };
  const { operationId, mediaId } = listing.value;
  if (!mediaId || !operationId)
    return {
      ok: false,
      message:
        'O projeto não identificou uma única imagem para o take de origem.',
    };
  const lookups = sameId(operationId, mediaId)
    ? [operationId]
    : [operationId, mediaId];
  let message =
    'A leitura da imagem não confirmou o identificador do frame inicial.';
  for (const lookup of lookups) {
    const asset = await read({
      ...context,
      rpcId: 'as29s',
      operationId,
      mediaId,
      payload: [lookup],
    });
    if (asset.ok && asset.value.imageAvailable && asset.value.mediaId)
      return { ok: true, mediaId: asset.value.mediaId, via: 'asset' };
    if (!asset.ok) message = asset.message;
  }
  return { ok: false, message };
}

export function readSourceFrame(
  tabId: number,
  projectId: string,
  sourceMediaId: string,
): Promise<FrameLookup> {
  return resolveSourceFrame(
    (request) => callFlowRpc(tabId, request),
    projectId,
    sourceMediaId,
    (ids) => projectImageTiles(tabId, projectId, ids),
  );
}
