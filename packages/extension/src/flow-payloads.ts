// Payloads ported from FlowKit agent/services/flow_batch.py (MIT).
import type { FlowSettings } from '@flow-batch/protocol';
import type { FlowRpcRequest } from './flow-rpc-page.js';

function context(projectId: string): unknown[] {
  return [
    null,
    22,
    null,
    null,
    null,
    projectId,
    null,
    null,
    null,
    null,
    [null, 1],
  ];
}
function uuid(): string {
  return crypto.randomUUID().toUpperCase();
}
export function uploadRequest(
  flow: FlowSettings,
  base64: string,
): FlowRpcRequest {
  return {
    rpcId: 'maseQ',
    projectId: flow.projectId,
    captchaAction: 'IMAGE_GENERATION',
    payload: [
      context(flow.projectId),
      base64,
      flow.reference.mime,
      1,
      null,
      null,
      null,
      null,
      flow.reference.name,
      null,
      uuid(),
      uuid(),
    ],
  };
}
export function imageRequest(
  flow: FlowSettings,
  prompt: string,
  referenceId: string,
): FlowRpcRequest {
  const item: unknown[] = [
    null,
    null,
    [[referenceId, null, null, null, 1]],
    flow.seed,
    flow.aspect === '9:16' ? 2 : 3,
    flow.imageModel,
    null,
    context(flow.projectId),
    [[[prompt]]],
    null,
    null,
    null,
    null,
    uuid(),
  ];
  return {
    rpcId: 'ogiZ0b',
    projectId: flow.projectId,
    captchaAction: 'IMAGE_GENERATION',
    payload: [null, [item], 1, context(flow.projectId), [uuid()]],
  };
}
export function videoRequest(
  flow: FlowSettings,
  prompt: string,
  imageId: string,
): FlowRpcRequest {
  const item: unknown[] = [
    [null, null, [[[prompt]]]],
    flow.videoModel,
    flow.aspect === '9:16' ? 1 : 2,
    null,
    [null, imageId, null, null, null, [null, null, 1, 1]],
    [null, null, null, null, uuid(), uuid()],
  ];
  return {
    rpcId: 'eb1hJf',
    projectId: flow.projectId,
    captchaAction: 'VIDEO_GENERATION',
    payload: [[item], context(flow.projectId), [uuid(), 2]],
  };
}
