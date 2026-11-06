import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  nativeStatusSchema,
  type NativeRecord,
  type NativeStatus,
} from './native-state.js';

const requestSchema = z.strictObject({
  secret: z.string().length(64),
  command: z.enum(['status', 'stop']),
});
function handleControl(
  socket: Socket,
  record: NativeRecord,
  status: () => NativeStatus,
  stop: () => void,
): void {
  let text = '',
    handled = false;
  socket.setEncoding('utf8');
  socket.setTimeout(2000, () => socket.destroy());
  socket.on('error', () => socket.destroy());
  socket.on('data', (chunk: string) => {
    if (handled) return;
    text += chunk;
    if (text.length > 4096) {
      socket.destroy();
      return;
    }
    if (!text.includes('\n')) return;
    handled = true;
    try {
      const input = requestSchema.parse(
        JSON.parse(text.slice(0, text.indexOf('\n'))),
      );
      if (
        !timingSafeEqual(Buffer.from(input.secret), Buffer.from(record.secret))
      )
        throw new Error('Unauthorized');
      socket.end(JSON.stringify(status()) + '\n');
      if (input.command === 'stop') setImmediate(stop);
    } catch {
      socket.end('{"error":"Control request refused"}\n');
    }
  });
}
export async function listenNativeControl(
  address: string,
  record: NativeRecord,
  status: () => NativeStatus,
  stop: () => void,
): Promise<Server> {
  const server = createServer((socket) =>
    handleControl(socket, record, status, stop),
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}
export async function requestNativeControl(
  address: string,
  record: NativeRecord,
  command: 'status' | 'stop',
): Promise<NativeStatus> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(address);
    let text = '',
      settled = false;
    const fail = (): void => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error('Controle nativo indisponível.'));
      }
    };
    socket.setEncoding('utf8');
    socket.setTimeout(2000, fail);
    socket.once('error', fail);
    socket.once('connect', () =>
      socket.write(JSON.stringify({ secret: record.secret, command }) + '\n'),
    );
    socket.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > 4096) {
        fail();
        return;
      }
      if (!text.includes('\n')) return;
      try {
        const response = nativeStatusSchema.parse(
          JSON.parse(text.slice(0, text.indexOf('\n'))),
        );
        if (
          response.instanceId !== record.instanceId ||
          response.pid !== record.pid ||
          response.port !== record.port
        )
          throw new Error('Instance mismatch');
        settled = true;
        socket.destroy();
        resolve(response);
      } catch {
        fail();
      }
    });
    socket.once('close', () => {
      if (!settled) fail();
    });
  });
}
