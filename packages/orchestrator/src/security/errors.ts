export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: 'MANAGEMENT_SESSION_REQUIRED',
  ) {
    super(message);
  }
}
