import {
  materialFilename,
  usesSingleImage,
} from '../packages/protocol/dist/index.js';
import { Buffer } from 'node:buffer';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export async function localClient(base = 'http://127.0.0.1:4319') {
  const url = new URL(base);
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.protocol !== 'http:'
  )
    throw new Error('Use a API HTTP local.');
  // Only retry this read-only session bootstrap, never a mutation or dispatch.
  const open = () =>
    fetch(`${base}/orders`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
  const response = await open().catch(() => open());
  if (!response.ok) throw new Error('Não foi possível iniciar a sessão local.');
  await response.arrayBuffer();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Sessão local indisponível.');
  return async (path, body, binary = false) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        cookie,
        origin: base,
        'X-Flow-Management': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error ?? 'Operação recusada.');
    }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}
export async function checkout(api, number, worker, directory, revise = false) {
  const { order, variationPlan } = await api(`/manage/orders/${number}`);
  let existing;
  try {
    existing = JSON.parse(
      await readFile(resolve(directory, 'pedido.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let lease;
  if (
    existing &&
    existing.order.id === order.id &&
    order.state === 'preparing'
  ) {
    const renewed = await api(`/manage/orders/${order.id}/heartbeat`, {
      leaseId: existing.leaseId,
    });
    lease = { leaseId: existing.leaseId, order: renewed };
  } else
    lease = await api(`/manage/orders/${order.id}/claim`, { worker, revise });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(directory, 'pedido.json'),
    JSON.stringify({ ...lease, variationPlan }, null, 2) + '\n',
    { mode: 0o600 },
  );
  for (const material of order.materials) {
    const bytes = await api(
      `/manage/materials/${material.id}`,
      undefined,
      true,
    );
    if (
      bytes.length !== material.size ||
      createHash('sha256').update(bytes).digest('hex') !== material.sha256
    )
      throw new Error('Material recebido difere do arquivo registrado.');
    await writeFile(resolve(directory, materialFilename(material)), bytes, {
      mode: 0o600,
    });
  }
  const products = order.products.map((product) => ({
    id: product.id,
    variations: variationPlan
      .filter((variation) => variation.productId === product.id)
      .map(({ id, name, format, videoReferenceId }) => ({
        id,
        name,
        format,
        ...(videoReferenceId
          ? {
              cloneVideo: {
                materialId: videoReferenceId,
                analysis: '',
                directions: { hook: '', body: '', cta: '' },
              },
            }
          : {}),
        hookImage: { prompt: '', negative_prompt: '', aspect_ratio: '9:16' },
        ...(!usesSingleImage(format)
          ? {
              presenterImage: {
                prompt: '',
                negative_prompt: '',
                aspect_ratio: '9:16',
              },
            }
          : {}),
        copy: { hook: '', body: '', cta: '' },
      })),
  }));
  let preparation = {
    leaseId: lease.leaseId,
    products: order.preparation?.products ?? products,
  };
  try {
    const previous = JSON.parse(
      await readFile(resolve(directory, 'preparacao.json'), 'utf8'),
    );
    if (existing?.order.id === order.id)
      preparation = { ...previous, leaseId: lease.leaseId };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(
    resolve(directory, 'preparacao.json'),
    JSON.stringify(preparation, null, 2) + '\n',
    { mode: 0o600 },
  );
  return { number, directory, expiresAt: lease.order.lease.expiresAt };
}
async function run() {
  const [command, ...args] = process.argv.slice(2),
    api = await localClient();
  if (command === 'list') {
    const { orders } = await api('/manage/orders');
    console.log(
      JSON.stringify(
        orders.map(({ number, name, state, counts }) => ({
          number,
          name,
          state,
          counts,
        })),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'checkout') {
    const selected = args.filter((arg) => arg !== '--revise');
    if (!selected.length) throw new Error('Informe os números dos pedidos.');
    for (const number of selected) {
      if (!/^\d+$/.test(number)) throw new Error('Use números de pedido.');
      const directory = resolve('.cache/orders', number);
      console.log(
        JSON.stringify(
          await checkout(
            api,
            Number(number),
            process.env.FLOW_AGENT_NAME ?? 'agente-local',
            directory,
            args.includes('--revise'),
          ),
        ),
      );
    }
    return;
  }
  if (command === 'publish' || command === 'renew') {
    const filename = resolve(args[0] ?? '');
    const folder = command === 'publish' ? resolve(filename, '..') : filename;
    const { order, leaseId } = JSON.parse(
      await readFile(resolve(folder, 'pedido.json'), 'utf8'),
    );
    const body =
      command === 'publish'
        ? JSON.parse(await readFile(filename, 'utf8'))
        : { leaseId };
    const result = await api(
      `/manage/orders/${order.id}/${command === 'publish' ? 'prepare' : 'heartbeat'}`,
      body,
    );
    console.log(
      JSON.stringify(
        {
          number: result.number,
          state: result.state,
          preparationHash: result.preparationHash,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'show' || command === 'approve') {
    const { order } = await api(`/manage/orders/${Number(args[0])}`);
    if (command === 'show') {
      console.log(JSON.stringify(order, null, 2));
      return;
    }
    if (args[1] !== '--approve' || args[2] !== '--hash' || !args[3])
      throw new Error(
        'Após autorização explícita no chat: pnpm orders approve NUMERO --approve --hash HASH [--client UUID]',
      );
    const { clients } = await api('/manage/status');
    const available = clients.filter((client) => !client.revokedAt);
    const clientId =
      args[4] === '--client'
        ? args[5]
        : available.length === 1
          ? available[0].id
          : null;
    if (!clientId)
      throw new Error(
        'Conecte uma extensão autorizada ou informe --client UUID.',
      );
    const result = await api(`/manage/orders/${order.id}/approve`, {
      approve: true,
      preparationHash: args[3],
      clientId,
    });
    console.log(
      JSON.stringify(
        {
          number: result.number,
          state: result.state,
          dispatches: result.dispatches,
        },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(
    'Uso: pnpm orders list | show NUMERO | checkout NUMEROS | renew PASTA | publish PREPARACAO.JSON | approve NUMERO --approve --hash HASH',
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
