export interface FlowRpcRequest {
  rpcId:
    'maseQ' | 'ogiZ0b' | 'eb1hJf' | 'jwpduf' | 'Zzl0ze' | 'as29s' | 'jHPbke';
  projectId: string;
  payload: unknown[];
  captchaAction?: 'IMAGE_GENERATION' | 'VIDEO_GENERATION';
  operationId?: string | undefined;
  mediaId?: string;
  sourceMediaId?: string;
  timeoutMs?: number;
  mediaKind?: 'image';
}
export interface FlowRpcValue {
  projectId?: string;
  projectTitle?: string;
  mediaId?: string | null | undefined;
  operationId?: string | undefined;
  status?: string | undefined;
  videoUrl?: string | null | undefined;
  ready?: boolean | undefined;
  sourceFound?: boolean | undefined;
  sourceOperationId?: string | undefined;
  outcomeCode?: number | undefined;
  complaint?: 'media_not_found' | 'unsafe_generation' | 'other' | undefined;
  imageAvailable?: boolean | undefined;
}
export type FlowRpcReply =
  | { ok: true; value: FlowRpcValue }
  | { ok: false; code: string; message: string; sent: boolean };

export type FlowRpcTransportReply =
  { ok: true; payload: unknown[] } | Extract<FlowRpcReply, { ok: false }>;
