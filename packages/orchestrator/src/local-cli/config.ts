import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  atomicReplace,
  backupFile,
  ensureDirectory,
  regularFile,
} from '../mcp/install-files.js';

const absolutePath = z
  .string()
  .min(1)
  .refine(isAbsolute, 'Use um caminho absoluto.');
export const installationSchema = z.strictObject({
  version: z.literal(1),
  runtime: z.enum(['native', 'docker']).default('docker'),
  dataDirectory: absolutePath.optional(),
  libraryDirectory: absolutePath,
  extensionDirectory: absolutePath,
  workspace: absolutePath,
  project: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  volume: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/),
  port: z.number().int().min(1024).max(65535),
  mcp: z
    .strictObject({
      clients: z.array(z.enum(['antigravity', 'codex'])).min(1),
      codexConfig: absolutePath,
      antigravityConfig: absolutePath,
    })
    .optional(),
});
export type Installation = z.infer<typeof installationSchema>;
export interface SetupPaths {
  library?: string;
  extension?: string;
  workspace?: string;
  project?: string;
  volume?: string;
  port?: string;
  runtime?: string;
  data?: string;
}
export function installationRuntime(
  platform: NodeJS.Platform,
  previous: Installation | null,
  requested?: string,
): 'native' | 'docker' {
  const runtime = z
    .enum(['native', 'docker'])
    .parse(
      requested ??
        previous?.runtime ??
        (platform === 'win32' ? 'native' : 'docker'),
    );
  if (platform === 'win32' && runtime === 'docker')
    throw new Error(
      'No Windows, use --runtime native. O modo Docker permanece disponível no Linux/WSL.',
    );
  return runtime;
}
export function stateDirectory(): string {
  return resolve(process.env.FLOW_BATCH_HOME ?? join(homedir(), '.flow-batch'));
}
export async function readInstallation(
  root: string,
): Promise<Installation | null> {
  const contents = await regularFile(join(root, 'installation.json'));
  if (!contents) return null;
  return installationSchema.parse(JSON.parse(contents.toString('utf8')));
}
export function setupConfiguration(
  root: string,
  previous: Installation | null,
  paths: SetupPaths,
): Installation {
  const library =
    paths.library ?? previous?.libraryDirectory ?? join(root, 'biblioteca');
  const extension = paths.extension ?? previous?.extensionDirectory;
  if (!extension)
    throw new Error(
      'Primeira configuração: informe --extension PASTA. A biblioteca usa a pasta padrão; --library é opcional.',
    );
  const project = paths.project ?? previous?.project ?? 'flow-batch-local';
  return installationSchema.parse({
    version: 1,
    runtime: installationRuntime(process.platform, previous, paths.runtime),
    dataDirectory: resolve(
      paths.data ?? previous?.dataDirectory ?? join(root, 'data'),
    ),
    libraryDirectory: resolve(library),
    extensionDirectory: resolve(extension),
    workspace: resolve(
      paths.workspace ?? previous?.workspace ?? join(root, 'pedidos'),
    ),
    project,
    volume: paths.volume ?? previous?.volume ?? `${project}_sqlite_data`,
    port: paths.port ? Number(paths.port) : (previous?.port ?? 4319),
    ...(previous?.mcp ? { mcp: previous.mcp } : {}),
  });
}
export async function saveInstallation(
  root: string,
  config: Installation,
): Promise<string | null> {
  const file = join(root, 'installation.json');
  const original = await regularFile(file);
  const contents = Buffer.from(JSON.stringify(config, null, 2) + '\n');
  if (original?.equals(contents)) return null;
  await ensureDirectory(root);
  const backup = await backupFile(file, original);
  await atomicReplace(file, contents, original);
  return backup;
}
export async function requireInstallation(root: string): Promise<Installation> {
  const config = await readInstallation(root);
  if (!config) throw new Error('Execute flow-batch setup antes deste comando.');
  return config;
}
