import type { FlowRpcRequest, FlowRpcValue } from './flow-response-types.js';
import { cdnUrl, sameId, validId } from './flow-response-id.js';

interface ImageIdentity {
  mediaId: string;
  operationId: string;
  fileId?: string;
}

function matches(image: ImageIdentity, id: unknown): boolean {
  return [image.mediaId, image.operationId, image.fileId].some((key) =>
    sameId(key, id),
  );
}

function imageAsset(record: unknown[]): ImageIdentity | undefined {
  const container: unknown = record[6];
  if (!Array.isArray(container)) return;
  const dimensions: unknown = container[2];
  const detail: unknown = container[0];
  const url = Array.isArray(detail) ? cdnUrl(detail[13], 'image') : null;
  if (
    !url ||
    !validId(record[0]) ||
    !validId(record[2]) ||
    !Array.isArray(dimensions) ||
    dimensions.length < 2 ||
    !dimensions
      .slice(0, 2)
      .every(
        (size: unknown) =>
          typeof size === 'number' && Number.isInteger(size) && size > 0,
      )
  )
    return;
  const path = new URL(url).pathname;
  return {
    mediaId: record[0],
    operationId: record[2],
    ...(path.startsWith('/image/')
      ? { fileId: path.slice('/image/'.length) }
      : {}),
  };
}

function header(record: unknown[], projectId: string): boolean {
  return sameId(record[4], projectId) && Array.isArray(record[3]);
}

function unique(images: ImageIdentity[]): ImageIdentity | undefined {
  const first = images[0];
  if (
    first &&
    images.every(
      (entry) =>
        sameId(first.mediaId, entry.mediaId) &&
        sameId(first.operationId, entry.operationId),
    )
  )
    return first;
}

function scopedAssets(
  records: unknown[][],
  projectId: string,
): ImageIdentity[] {
  const headers = records.filter((record) => header(record, projectId));
  return records.flatMap((record) => {
    const asset = imageAsset(record);
    if (
      !asset ||
      !(
        sameId(record[1], projectId) ||
        (record[1] == null &&
          headers.some(
            (h) =>
              sameId(h[0], asset.operationId) ||
              (sameId(h[0], asset.mediaId) &&
                Array.isArray(h[3]) &&
                sameId(h[3][4], asset.operationId)),
          ))
      )
    )
      return [];
    return [asset];
  });
}

function hasForeignProject(records: unknown[][], projectId: string): boolean {
  return records.some(
    (record) =>
      (validId(record[1]) && !sameId(record[1], projectId)) ||
      (Array.isArray(record[3]) &&
        validId(record[4]) &&
        !sameId(record[4], projectId)),
  );
}

function hasImageCdnUrl(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') return cdnUrl(value, 'image') !== null;
  if (!Array.isArray(value)) return false;
  return value.some((entry) => hasImageCdnUrl(entry, depth + 1));
}

function fallbackGeneratedAssets(
  records: unknown[][],
  projectId: string,
  allowUnscoped: boolean,
): ImageIdentity[] {
  const assets: ImageIdentity[] = [];
  for (const record of records) {
    if (
      !validId(record[0]) ||
      !validId(record[2]) ||
      !(sameId(record[1], projectId) || (allowUnscoped && record[1] == null))
    )
      continue;
    if (hasImageCdnUrl(record[6]) || hasImageCdnUrl(record[5]))
      assets.push({ mediaId: record[0], operationId: record[2] });
  }
  return assets;
}

export function generatedImage(
  records: unknown[][],
  projectId: string,
): FlowRpcValue | undefined {
  const allowUnscoped = !hasForeignProject(records, projectId);
  const structured = records
    .map((record) => ({ record, asset: imageAsset(record) }))
    .filter((entry): entry is { record: unknown[]; asset: ImageIdentity } =>
      Boolean(entry.asset),
    );
  if (structured.length) {
    const scoped = scopedAssets(records, projectId);
    const image = unique(
      scoped.length
        ? scoped
        : allowUnscoped
          ? structured
              .filter(({ record }) => record[1] == null)
              .map(({ asset }) => asset)
          : [],
    );
    return image ? { mediaId: image.mediaId } : undefined;
  }
  const fallback = unique(
    fallbackGeneratedAssets(records, projectId, allowUnscoped),
  );
  if (fallback) return { mediaId: fallback.mediaId };
  for (const record of records) {
    for (const value of record) {
      const url = cdnUrl(value, 'image');
      if (url) {
        const path = new URL(url).pathname;
        if (path.startsWith('/image/'))
          return { mediaId: path.slice('/image/'.length) };
      }
    }
  }
  return undefined;
}

function projectCandidates(
  records: unknown[][],
  request: FlowRpcRequest,
): ImageIdentity[] {
  const candidates: ImageIdentity[] = [];
  for (const record of records) {
    if (!validId(record[0])) continue;
    if (
      sameId(record[1], request.projectId) &&
      validId(record[2]) &&
      Array.isArray(record[5]) &&
      record.length === 7
    )
      candidates.push({ mediaId: record[2], operationId: record[0] });
    const meta: unknown = record[3];
    if (
      !header(record, request.projectId) ||
      !Array.isArray(meta) ||
      !validId(meta[4])
    )
      continue;
    if (meta[2] === false)
      candidates.push({ mediaId: meta[4], operationId: meta[4] });
    else if (meta[2] == null)
      candidates.push({ mediaId: record[0], operationId: meta[4] });
  }
  return candidates.filter((image) => matches(image, request.sourceMediaId));
}

export function locateProjectImage(
  records: unknown[][],
  request: FlowRpcRequest,
): FlowRpcValue {
  const assets = scopedAssets(records, request.projectId).filter((asset) =>
    matches(asset, request.sourceMediaId),
  );
  const image = unique(
    assets.length ? assets : projectCandidates(records, request),
  );
  return image
    ? {
        sourceFound: true,
        mediaId: image.mediaId,
        operationId: image.operationId,
      }
    : { sourceFound: false };
}

export function readProjectImage(
  records: unknown[][],
  request: FlowRpcRequest,
): FlowRpcValue {
  const unavailable = { mediaId: null, imageAvailable: false };
  const assets = scopedAssets(records, request.projectId);
  const candidates = assets.filter(
    (asset) =>
      matches(asset, request.operationId) && matches(asset, request.mediaId),
  );
  const asset = unique(candidates);
  if (asset) return { mediaId: asset.mediaId, imageAvailable: true };
  // A structured reply is evidence for this exact image only. A video poster
  // or an unrelated image elsewhere in that reply cannot identify the frame.
  if (records.some((r) => imageAsset(r))) return unavailable;
  const generations = records.filter(
    (r) =>
      validId(r[0]) && validId(r[1]) && validId(r[2]) && Array.isArray(r[5]),
  );
  if (generations.length) {
    const images = generations
      .filter(
        (r) =>
          sameId(r[1], request.projectId) &&
          r.length === 7 &&
          [r[0], r[2]].every(
            (id) =>
              sameId(id, request.operationId) || sameId(id, request.mediaId),
          ) &&
          Array.isArray(r[5]) &&
          r[5].some((value: unknown) => cdnUrl(value, 'image')),
      )
      .map((r) => ({ operationId: String(r[0]), mediaId: String(r[2]) }));
    const image = unique(images);
    return image
      ? { mediaId: image.mediaId, imageAvailable: true }
      : unavailable;
  }
  // Legacy asset reads can contain only the URL. Bind its file ID to the
  // project entry before accepting it as evidence.
  if (
    records.some((r) => validId(r[0]) && Array.isArray(r[3]) && validId(r[4]))
  )
    return unavailable;
  const fileMatches = records.some((r) =>
    r.some((value) => {
      const url = cdnUrl(value, 'image');
      if (!url) return false;
      const path = new URL(url).pathname;
      return (
        path.startsWith('/image/') &&
        sameId(path.slice('/image/'.length), request.mediaId)
      );
    }),
  );
  return fileMatches && request.mediaId
    ? { mediaId: request.mediaId, imageAvailable: true }
    : unavailable;
}
