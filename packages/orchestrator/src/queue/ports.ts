import type {
  QueueExecute,
  QueueProgress,
  QueueCheckpoint,
} from '@flow-batch/protocol';
export interface QueueTransport {
  queueConnections(): {
    clientId: string;
    connectionId: string;
    flowCapable?: boolean;
  }[];
  sendQueue(connectionId: string, message: QueueExecute): boolean;
  closeQueue(connectionId: string): void;
}
export interface QueueEvents {
  connected(): void;
  disconnected(connectionId: string, reason?: string): void;
  progress(
    clientId: string,
    connectionId: string,
    message: QueueProgress | QueueCheckpoint,
  ): void;
}
