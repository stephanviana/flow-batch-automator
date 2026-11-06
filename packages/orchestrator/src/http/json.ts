import type { FastifyInstance } from 'fastify';
import { HttpError } from '../security/errors.js';
import { ZodError } from 'zod';

export function registerJsonHandling(app: FastifyInstance): void {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done): void => {
      request.rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      try {
        done(null, JSON.parse(request.rawBody.toString('utf8')) as unknown);
      } catch {
        done(new HttpError(400, 'Invalid JSON'));
      }
    },
  );
  app.setErrorHandler(async (error, _request, reply): Promise<void> => {
    const suppliedStatus =
      error instanceof Error && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const knownStatus =
      typeof suppliedStatus === 'number' &&
      [400, 413, 415, 429].includes(suppliedStatus)
        ? suppliedStatus
        : 500;
    const status =
      error instanceof HttpError
        ? error.statusCode
        : error instanceof ZodError || error instanceof DOMException
          ? 400
          : knownStatus;
    await reply.code(status).send({
      ...(error instanceof HttpError && error.code ? { code: error.code } : {}),
      ...(error instanceof ZodError
        ? {
            issues: error.issues.map((issue) => ({
              path: issue.path,
              code: issue.code,
              message: issue.message,
            })),
          }
        : {}),
      error:
        error instanceof HttpError
          ? error.message
          : status < 500
            ? 'Invalid request'
            : 'Internal server error',
    });
  });
}
