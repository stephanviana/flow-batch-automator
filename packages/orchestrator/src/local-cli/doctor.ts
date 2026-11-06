import { join } from 'node:path';
import { localClient, requireContract } from '../agent-client/http.js';
import { regularFile } from '../mcp/install-files.js';
import { runProcess } from './process.js';
import { stateDirectory, type Installation } from './config.js';
import { nativeStatus } from './native.js';

export interface Diagnostic {
  check: string;
  ok: boolean;
  message: string;
}
export async function diagnose(
  config: Installation,
  root = stateDirectory(),
): Promise<Diagnostic[]> {
  const checks: Diagnostic[] = [];
  if (config.runtime === 'native') {
    let sqlite = false;
    try {
      await import('node:sqlite');
      sqlite = true;
    } catch {
      /* Report the missing built-in. */
    }
    checks.push({
      check: 'sqlite',
      ok: sqlite,
      message: sqlite
        ? `Node ${process.versions.node} com SQLite disponível.`
        : 'Instale uma versão Node suportada com node:sqlite.',
    });
    const status = await nativeStatus(root, config);
    checks.push({
      check: 'native',
      ok: status.state === 'running',
      message:
        status.state === 'running'
          ? 'Servidor nativo em execução.'
          : 'Execute flow-batch up; confira status e logs.',
    });
  }
  for (const args of config.runtime === 'native'
    ? []
    : [
        ['compose', 'version'],
        ['info', '--format', '{{.ServerVersion}}'],
      ]) {
    let ok = false;
    try {
      ok = (await runProcess('docker', args, true)).code === 0;
    } catch {
      /* Report an unavailable dependency. */
    }
    checks.push({
      check: args[0] === 'compose' ? 'compose' : 'docker',
      ok,
      message: ok
        ? 'Disponível.'
        : 'Verifique Docker, Compose e a permissão de acesso ao daemon no WSL.',
    });
  }
  for (const [check, file] of [
    ['library', join(config.libraryDirectory, 'biblioteca.json')],
    [
      'extension',
      join(config.extensionDirectory, '.flow-batch-foundation.json'),
    ],
  ] as const) {
    let ok = false;
    try {
      ok = (await regularFile(file)) !== null;
    } catch {
      /* Report without modifying files. */
    }
    checks.push({
      check,
      ok,
      message: ok
        ? 'Arquivos presentes.'
        : 'Execute setup; a extensão é sincronizada por up.',
    });
  }
  try {
    await requireContract(
      await localClient(`http://127.0.0.1:${config.port}`, 5000),
    );
    checks.push({
      check: 'api',
      ok: true,
      message: 'Servidor acessível e contrato compatível.',
    });
  } catch {
    checks.push({
      check: 'api',
      ok: false,
      message: 'Servidor indisponível ou incompatível; execute flow-batch up.',
    });
  }
  return checks;
}
