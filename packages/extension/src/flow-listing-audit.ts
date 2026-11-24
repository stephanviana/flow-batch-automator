import { sameId, validId, cdnUrl } from './flow-media-id.js';

interface ListingAudit {
  generations: number;
  matches: number;
  identified: number;
  downloadable: number;
  states: number[];
  hasFrame: boolean;
  mappedWorkflow?: string | undefined;
}

export function auditListing(
  payload: unknown[],
  projectId: string,
  prompt: string,
  operationId: string,
  frameId: string | undefined,
): ListingAudit {
  const pending: unknown[] = [payload];
  const audit: ListingAudit = {
    generations: 0,
    matches: 0,
    identified: 0,
    downloadable: 0,
    states: [],
    hasFrame: false,
  };
  while (pending.length) {
    const node = pending.pop();
    if (!Array.isArray(node)) continue;
    pending.push(...node);
    const detail: unknown = node[5];
    const video: unknown = node[7];
    if (
      !sameId(node[1], projectId) ||
      !validId(node[0]) ||
      !validId(node[2]) ||
      !Array.isArray(detail) ||
      !Array.isArray(video)
    )
      continue;
    audit.generations++;
    if (sameId(node[0], operationId) || sameId(node[2], operationId))
      audit.identified++;
    if (detail[1] !== prompt) continue;
    audit.matches++;
    audit.mappedWorkflow = audit.matches === 1 ? node[0] : undefined;
    const state: unknown = Array.isArray(detail[8]) ? detail[8][0] : null;
    if (
      typeof state === 'number' &&
      Number.isInteger(state) &&
      state >= 0 &&
      state <= 999
    )
      audit.states.push(state);
    if (Array.isArray(video[0]) && cdnUrl(video[0][8], 'video'))
      audit.downloadable++;
    const input: unknown = Array.isArray(detail[6]) ? detail[6][1] : null;
    const refs: unknown[] = [input];
    while (refs.length) {
      const ref = refs.pop();
      if (Array.isArray(ref)) refs.push(...ref);
      else if (sameId(ref, frameId)) audit.hasFrame = true;
    }
  }
  return audit;
}

export function auditMessage(audit: ListingAudit, operationId: string): string {
  const identity =
    audit.matches === 1 && audit.mappedWorkflow
      ? sameId(audit.mappedWorkflow, operationId)
        ? 'mesma operação'
        : 'outra operação'
      : 'sem vínculo único';
  return `Projeto: ${audit.generations} vídeos; ID registrado: ${audit.identified} registros. Copy exata do CTA: ${audit.matches}; ${identity}; estados ${audit.states.join(',') || 'ausentes'}; MP4s ${audit.downloadable}; frame ${audit.hasFrame ? 'confirmado' : 'ausente'}.`;
}
