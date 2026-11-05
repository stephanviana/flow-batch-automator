import type { DispatchFailure } from '@flow-batch/protocol';
export class FlowInputError extends Error {
  constructor(
    message: string,
    readonly failure?: DispatchFailure,
  ) {
    super(message);
  }
}
