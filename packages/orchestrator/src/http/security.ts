import type { FastifyInstance } from 'fastify';

const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;

export function registerLocalBoundary(
  app: FastifyInstance,
  port: number,
): void {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const localOrigins = new Set(
    [...allowedHosts].map((host) => `http://${host}`),
  );
  app.addHook('onRequest', async (request, reply): Promise<void> => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    reply.header('Cache-Control', 'no-store');
    if (
      request.method === 'GET' &&
      (request.headers['transfer-encoding'] ||
        (request.headers['content-length'] &&
          request.headers['content-length'] !== '0'))
    ) {
      await reply.code(400).send({ error: 'GET body is not supported' });
      return;
    }
    if (!request.headers.host || !allowedHosts.has(request.headers.host)) {
      await reply.code(403).send({ error: 'Forbidden' });
      return;
    }
    const origin = request.headers.origin;
    if (origin && !localOrigins.has(origin) && !extensionOrigin.test(origin)) {
      await reply.code(403).send({ error: 'Forbidden' });
    }
  });
}
