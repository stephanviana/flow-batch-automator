export class ExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly notSubmitted: boolean,
    readonly confirmedFailure = false,
  ) {
    super(message);
  }
}
