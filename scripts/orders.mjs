import {
  localClient,
  requireContract,
} from '../packages/orchestrator/dist/agent-client/http.js';
import {
  checkout,
  publishWorkspace,
} from '../packages/orchestrator/dist/agent-client/workspace.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { orderExecution } from '../packages/orchestrator/dist/agent-client/execution.js';
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
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options:
        command === 'publish'
          ? { execute: { type: 'boolean' }, client: { type: 'string' } }
          : {},
    });
    if (positionals.length !== 1 || (values.client && !values.execute))
      throw new Error(
        'Informe o arquivo ou pasta; --client exige --execute na publicação.',
      );
    const execution = values.execute
      ? await orderExecution(api, values.client)
      : undefined;
    const filename = resolve(positionals[0]);
    const folder = command === 'publish' ? resolve(filename, '..') : filename;
    const { order, leaseId } = JSON.parse(
      await readFile(resolve(folder, 'pedido.json'), 'utf8'),
    );
    const result =
      command === 'publish'
        ? await publishWorkspace(api, folder, execution, filename)
        : await api(`/manage/orders/${order.id}/heartbeat`, { leaseId });
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
  if (command === 'show' || command === 'approve') {
    const { order } = await api(`/manage/orders/${Number(args[0])}`);
    if (command === 'show') {
      console.log(JSON.stringify(order, null, 2));
      return;
    }
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { approve: { type: 'boolean' }, client: { type: 'string' } },
    });
    if (!values.approve || positionals.length !== 1)
      throw new Error(
        'Após um pedido de execução no chat: pnpm orders approve NUMERO --approve [--client UUID]',
      );
    await requireContract(api);
    const { clientId } = await orderExecution(api, values.client);
    const result = await api(`/manage/orders/${order.id}/approve`, {
      approve: true,
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
    'Uso: pnpm orders list | show NUMERO | checkout NUMEROS | renew PASTA | publish PREPARACAO.JSON [--execute] [--client UUID] | approve NUMERO --approve [--client UUID]',
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
