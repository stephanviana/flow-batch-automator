import type {
  FlowRpcReply,
  FlowRpcRequest,
  FlowRpcValue,
} from './flow-response-types.js';

import { cdnUrl, sameId, validId } from './flow-response-id.js';
import {
  generatedImage,
  locateProjectImage,
  readProjectImage,
} from './flow-response-image.js';

function arrays(payload: unknown[]): unknown[][] {
  const pending: unknown[] = [payload],
    records: unknown[][] = [];
  while (pending.length) {
    const node = pending.pop();
    if (!Array.isArray(node)) continue;
    records.push(node);
    for (const child of node as unknown[]) pending.push(child);
  }
  return records;
}
function complaint(
  record: unknown[],
): Pick<FlowRpcValue, 'outcomeCode' | 'complaint' | 'status'> {
  const detail: unknown = record[5];
  const block: unknown = Array.isArray(detail) ? detail[8] : null;
  const code: unknown = Array.isArray(block) ? block[0] : null;
  const marker: unknown = record[3];
  return {
    status:
      typeof marker === 'string' && /^[A-Za-z0-9_-]{0,80}$/.test(marker)
        ? marker
        : '',
    ...(typeof code === 'number' &&
    Number.isInteger(code) &&
    code >= 0 &&
    code <= 999
      ? {
          outcomeCode: code,
          ...(code === 4
            ? {
                complaint: JSON.stringify(block).includes(
                  'PUBLIC_ERROR_UNSAFE_GENERATION',
                )
                  ? ('unsafe_generation' as const)
                  : JSON.stringify(block).includes('Media not found.')
                    ? ('media_not_found' as const)
                    : ('other' as const),
              }
            : {}),
        }
      : {}),
  };
}
function generation(record: unknown[], projectId: string): boolean {
  return (
    validId(record[0]) &&
    sameId(record[1], projectId) &&
    validId(record[2]) &&
    Array.isArray(record[5])
  );
}
function videoRecord(record: unknown[]): boolean {
  return Array.isArray(record[7]) && Array.isArray(record[7][0]);
}
function videoArm(record: unknown[]): unknown[] | undefined {
  const media: unknown = record[7];
  return Array.isArray(media) && Array.isArray(media[0])
    ? (media[0] as unknown[])
    : undefined;
}
function readyClip(record: unknown[]): Pick<FlowRpcValue, 'videoUrl'> {
  const url = cdnUrl(videoArm(record)?.[8], 'video');
  return url ? { videoUrl: url } : {};
}
function matchingGeneration(
  records: unknown[][],
  request: FlowRpcRequest,
): unknown[] | undefined {
  const target = request.operationId ?? request.mediaId;
  return records.find(
    (record) =>
      generation(record, request.projectId) &&
      (request.rpcId !== 'eb1hJf' || videoRecord(record)) &&
      (!target || sameId(record[0], target) || sameId(record[2], target)),
  );
}

function listingValue(
  records: unknown[][],
  request: FlowRpcRequest,
): FlowRpcValue {
  if (!request.operationId) return { ready: true };
  const generated = matchingGeneration(records, request);
  let value: FlowRpcValue =
    generated && videoRecord(generated)
      ? {
          operationId: String(generated[0]),
          mediaId: String(generated[2]),
          ...complaint(generated),
          ...readyClip(generated),
        }
      : { mediaId: null };
  let sourceFound = false;
  let sourceOperationId: string | undefined;
  for (const record of records) {
    if (
      generation(record, request.projectId) &&
      !videoRecord(record) &&
      (sameId(record[0], request.sourceMediaId) ||
        sameId(record[2], request.sourceMediaId))
    ) {
      sourceFound = true;
      sourceOperationId = String(record[0]);
    }
    const meta: unknown = record[3];
    if (
      !Array.isArray(meta) ||
      (!sameId(record[4], request.projectId) && record[4] !== undefined)
    )
      continue;
    if (
      meta[2] !== true &&
      (sameId(record[0], request.sourceMediaId) ||
        sameId(meta[4], request.sourceMediaId))
    ) {
      sourceFound = true;
      if (meta[2] == null && validId(meta[4])) sourceOperationId = meta[4];
    }
    // Older replies use an explicit boolean and put the operation in slot 5.
    // Current metadata can omit that boolean: slot 0 is media, slot 4 workflow.
    const legacyMatch =
      meta[2] === true &&
      (sameId(record[0], request.operationId) ||
        sameId(meta[5], request.operationId));
    const currentMatch =
      meta[2] == null &&
      (sameId(record[0], request.operationId) ||
        sameId(meta[4], request.operationId));
    if (
      !value.mediaId &&
      validId(record[0]) &&
      validId(meta[4]) &&
      (legacyMatch || currentMatch)
    )
      value = legacyMatch
        ? { mediaId: meta[4] }
        : { mediaId: String(record[0]), operationId: meta[4] };
  }
  return {
    ...value,
    ...(request.sourceMediaId
      ? { sourceFound, ...(sourceOperationId ? { sourceOperationId } : {}) }
      : {}),
  };
}

function mediaValue(
  records: unknown[][],
  request: FlowRpcRequest,
): FlowRpcValue {
  const generated = matchingGeneration(records, request);
  const mediaId = generated ? String(generated[2]) : (request.mediaId ?? null);
  if (generated) {
    const arm = videoArm(generated);
    const details: unknown = generated[5];
    const input: unknown = Array.isArray(details) ? details[6] : null;
    const refs: unknown = Array.isArray(input) ? input[1] : null;
    const sourceFound =
      request.sourceMediaId && Array.isArray(refs)
        ? arrays(refs).some((row) =>
            row.some((value) => sameId(value, request.sourceMediaId)),
          )
        : undefined;
    return {
      mediaId,
      operationId: String(generated[0]),
      ...complaint(generated),
      ...(sourceFound === undefined
        ? {}
        : { sourceFound: Boolean(sourceFound) }),
      videoUrl: Array.isArray(arm) ? cdnUrl(arm[8], 'video') : null,
    };
  }
  const missing = records.find(
    (record) =>
      sameId(record[0], request.operationId ?? request.mediaId) &&
      record[1] == null &&
      record[2] == null &&
      Array.isArray(record[5]),
  );
  if (missing)
    return {
      mediaId,
      operationId: String(missing[0]),
      ...complaint(missing),
      videoUrl: null,
    };
  // A different generation record must never provide this take's URL.
  if (
    records.some(
      (record) =>
        validId(record[0]) &&
        validId(record[1]) &&
        validId(record[2]) &&
        Array.isArray(record[5]),
    )
  )
    return { mediaId, videoUrl: null };
  for (const record of records)
    for (const candidate of record) {
      const url = cdnUrl(candidate, 'video');
      if (url && validId(mediaId)) return { mediaId, videoUrl: url };
    }
  return { mediaId, videoUrl: null };
}

export function readFlowPayload(
  request: FlowRpcRequest,
  payload: unknown[],
): FlowRpcReply {
  const records = arrays(payload);
  let value: FlowRpcValue | undefined;
  if (request.rpcId === 'Zzl0ze' && request.mediaKind === 'image')
    value = locateProjectImage(records, request);
  else if (request.rpcId === 'as29s' && request.mediaKind === 'image')
    value = readProjectImage(records, request);
  else if (request.rpcId === 'Zzl0ze') value = listingValue(records, request);
  else if (request.rpcId === 'ogiZ0b')
    value = generatedImage(records, request.projectId);
  else if (request.rpcId === 'as29s') value = mediaValue(records, request);
  else if (
    request.rpcId === 'maseQ' &&
    Array.isArray(payload[0]) &&
    validId(payload[0][0])
  )
    value = { mediaId: payload[0][0] };
  else if (
    request.rpcId === 'jHPbke' &&
    typeof payload[0] === 'string' &&
    /^[a-f0-9-]{36}$/i.test(payload[0])
  ) {
    const title: unknown = Array.isArray(payload[1]) ? payload[1][0] : null;
    value = {
      projectId: payload[0],
      ...(typeof title === 'string'
        ? { projectTitle: title.slice(0, 160) }
        : {}),
    };
  } else if (request.rpcId === 'eb1hJf' || request.rpcId === 'jwpduf') {
    const generated = matchingGeneration(records, request);
    const legacy: unknown = Array.isArray(payload[2]) ? payload[2][0] : null;
    if (generated)
      value = {
        operationId: String(generated[0]),
        mediaId: String(generated[2]),
        ...complaint(generated),
        ...(request.rpcId === 'jwpduf' ? readyClip(generated) : {}),
      };
    else if (
      Array.isArray(legacy) &&
      validId(legacy[0]) &&
      (!request.operationId || sameId(legacy[0], request.operationId))
    ) {
      const meta: unknown = legacy[3];
      value =
        Array.isArray(meta) && validId(meta[4])
          ? { operationId: meta[4], mediaId: legacy[0] }
          : { operationId: legacy[0], ...complaint(legacy) };
    }
  }
  return value
    ? { ok: true, value }
    : {
        ok: false,
        code: 'flow_response_invalid',
        message: 'Resposta do Flow incompatível com o adaptador.',
        sent: true,
      };
}
