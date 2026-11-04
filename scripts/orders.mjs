import {
  localClient,
  requireContract,
} from '../packages/orchestrator/dist/agent-client/http.js';
import { checkout } from '../packages/orchestrator/dist/agent-client/workspace.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export { localClient, checkout };
async function run() {
  const [command, ...args] = process.argv.slice(2),
    api = await localClient(process.env.FLOW_API_URL);
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
      const prepared = await checkout(
        api,
        Number(number),
        process.env.FLOW_AGENT_NAME ?? 'agente-local',
        directory,
        args.includes('--revise'),
      );
      console.log(
        JSON.stringify({
          number: prepared.number,
          directory: prepared.directory,
          expiresAt: prepared.expiresAt,
          preparationFile: prepared.preparationFile,
          contextFile: resolve(directory, 'contexto.json'),
          libraryRevision: prepared.context.revision,
        }),
      );
    }
    return;
  }
  if (command === 'publish' || command === 'renew') {
    if (command === 'publish') await requireContract(api);
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
