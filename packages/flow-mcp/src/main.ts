import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { loadBrowserConfig, saveBrowserExecutable } from './settings.js';
import { ProfileBrowser } from './browser.js';
import { FlowBrowserService } from './service.js';
import { createBrowserMcpServer } from './server.js';
import { FlowBrowserError } from './contracts.js';
import { ExecutorControl } from './executor/control.js';
import { runBrowserWorker } from './executor/worker.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let config = await loadBrowserConfig();
  if (args.length === 3 && args[0] === '--login' && args[1] === '--chrome') {
    config = await saveBrowserExecutable(config, args[2]!);
    args.splice(1);
  }
  const browser = new ProfileBrowser(config);
  const service = new FlowBrowserService(browser);
  const executor = new ExecutorControl(config, process.env.FLOW_API_URL);
  try {
    if (!args.length) {
      const server = createBrowserMcpServer(service, executor);
      server.server.onclose = (): void => {
        void browser.disconnect();
      };
      await server.connect(new StdioServerTransport());
    } else if (args.length === 1 && args[0] === '--worker')
      await runBrowserWorker(config, process.env.FLOW_API_URL);
    else if (args.length === 1 && args[0] === '--pair')
      console.log(JSON.stringify(await executor.pair(), null, 2));
    else if (args.length === 1 && args[0] === '--executor-status')
      console.log(JSON.stringify(await executor.status(), null, 2));
    else if (args.length === 1 && args[0] === '--pause')
      console.log(JSON.stringify(await executor.pause(), null, 2));
    else if (
      args.length === 1 &&
      ['--login', '--connect', '--status'].includes(args[0]!)
    ) {
      const status =
        args[0] === '--login'
          ? await service.login()
          : args[0] === '--connect'
            ? await service.connectSession()
            : await service.status();
      console.log(JSON.stringify(status, null, 2));
      await browser.disconnect();
    } else
      throw new FlowBrowserError(
        'invalid_arguments',
        'Use sem argumentos para MCP, --login [--chrome CAMINHO] para login manual, --connect após fechar a janela manual ou --status para consultar a sessão.',
      );
  } catch (error) {
    await browser.disconnect();
    throw error;
  }
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof FlowBrowserError
      ? error.message
      : 'Não foi possível iniciar o MCP do navegador. Confira a configuração e o Chrome dedicado.',
  );
  process.exitCode = 1;
}
