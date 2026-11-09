import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export function parseReleaseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid release JSON. Contents were not logged.');
  }
}
export async function releaseMetadata() {
  const root = parseReleaseJson(
    await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
  );
  const config = parseReleaseJson(
    await readFile(join(repositoryRoot, 'packaging/npm.json'), 'utf8'),
  );
  if (
    !/^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(config.name) ||
    !['public', 'restricted'].includes(config.access) ||
    config.registry !== 'https://registry.npmjs.org/'
  )
    throw new Error('Invalid npm release name, access or registry.');
  const orchestrator = parseReleaseJson(
    await readFile(
      join(repositoryRoot, 'packages/orchestrator/package.json'),
      'utf8',
    ),
  );
  const dependencies = Object.fromEntries(
    Object.entries(orchestrator.dependencies).filter(
      ([name]) => !name.startsWith('@flow-batch/'),
    ),
  );
  if (
    Object.values(dependencies).some(
      (version) => !/^\d+\.\d+\.\d+$/.test(version),
    )
  )
    throw new Error('Release dependencies must use exact registry versions.');
  const filename = `${config.name.slice(1).replace('/', '-')}-${root.version}.tgz`;
  return {
    ...config,
    dependencies,
    version: root.version,
    engines: root.engines,
    filename,
    artifact: join(repositoryRoot, 'dist/npm', filename),
  };
}
export function distributionManifest(release) {
  return {
    name: release.name,
    version: release.version,
    type: 'module',
    description:
      'Ferramenta local para pedidos de TikTok Shop e execução autorizada no Google Flow',
    license: 'UNLICENSED',
    engines: release.engines,
    os: ['linux', 'win32'],
    bin: { 'flow-batch': 'bin/flow-batch.mjs' },
    files: [
      'bin/',
      'dist/',
      'runtime/',
      'instrucoes/',
      'THIRD_PARTY_NOTICES.md',
    ],
    dependencies: release.dependencies,
    publishConfig: { registry: release.registry, access: release.access },
  };
}
