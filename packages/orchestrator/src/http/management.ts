import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ClientStore } from '../persistence/clients.js';
import type { ConnectionHub } from '../communication/sockets.js';
import { LocalSessions } from '../security/local-session.js';

export function registerManagement(
  app: FastifyInstance,
  clients: ClientStore,
  hub: ConnectionHub,
  assets: URL,
  sessions = new LocalSessions(),
): void {
  const files = new Map<string, readonly [string, string]>([
    ['/theme.css', ['theme.css', 'text/css; charset=utf-8']],
    ['/connect', ['connect.html', 'text/html; charset=utf-8']],
    ['/connect.js', ['connect.js', 'text/javascript; charset=utf-8']],
    ['/connect.css', ['connect.css', 'text/css; charset=utf-8']],
    ['/orders', ['orders.html', 'text/html; charset=utf-8']],
    ['/orders.js', ['orders.js', 'text/javascript; charset=utf-8']],
    ['/orders.css', ['orders.css', 'text/css; charset=utf-8']],
    ['/orders-editor.css', ['orders-editor.css', 'text/css; charset=utf-8']],
    ['/orders-cards.css', ['orders-cards.css', 'text/css; charset=utf-8']],
    [
      '/management-api.js',
      ['management-api.js', 'text/javascript; charset=utf-8'],
    ],
    [
      '/orders-editor.js',
      ['orders-editor.js', 'text/javascript; charset=utf-8'],
    ],
  ]);
  for (const filename of [
    'orders-elements.js',
    'orders-materials-editor.js',
    'orders-format-editor.js',
    'orders-config.js',
    'orders-video-preview.js',
    'ui-icons.js',
    'orders-cards.js',
  ])
    files.set(`/${filename}`, [filename, 'text/javascript; charset=utf-8']);
  for (const [route, [filename, contentType]] of files) {
    const contents = readFileSync(new URL(filename, assets));
    app.get(route, async (request, reply): Promise<Buffer> => {
      if (route === '/connect' || route === '/orders')
        sessions.open(request, reply);
      reply.header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src blob:; media-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      reply.type(contentType ?? 'text/plain');
      return contents;
    });
  }
  app.get('/manage/status', async (request) => {
    sessions.require(request);
    const status = clients.managementStatus();
    return {
      ...status,
      clients: (status.clients as { id: string }[]).map((client) => ({
        ...client,
        connected: hub.connected(client.id),
      })),
    };
  });
  app.get('/agent/flow-batch-mcp.mjs', async (_request, reply) => {
    reply
      .type('text/javascript; charset=utf-8')
      .header(
        'Content-Disposition',
        'attachment; filename="flow-batch-mcp.mjs"',
      );
    return readFileSync(new URL('flow-batch-mcp.mjs', assets));
  });
  app.get('/manage/agent/download', async (request, reply) => {
    sessions.require(request);
    reply
      .type('text/javascript; charset=utf-8')
      .header(
        'Content-Disposition',
        'attachment; filename="flow-batch-mcp.mjs"',
      );
    return readFileSync(new URL('flow-batch-mcp.mjs', assets));
  });
  app.post('/manage/requests/:id', async (request) => {
    sessions.require(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { approve } = z
      .strictObject({ approve: z.boolean() })
      .parse(request.body);
    clients.decide(id, approve);
    return { ok: true };
  });
  app.post('/manage/clients/:id/revoke', async (request) => {
    sessions.require(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    clients.revoke(id);
    hub.revoke(id);
    return { ok: true };
  });
}
