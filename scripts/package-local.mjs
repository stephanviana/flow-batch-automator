import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import {
  repositoryRoot as root,
  releaseMetadata,
  distributionManifest,
} from './npm/manifest.mjs';
import { createDependencyLock } from './npm/dependencies.mjs';
import { auditPackage } from './npm/audit.mjs';

const staging = join(root, '.cache', 'local-package');
const destination = join(root, 'dist', 'npm');
const release = await releaseMetadata();
const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
const nodeImage = dockerfile.match(/^FROM (\S+) AS build/m)?.[1];
if (!nodeImage) throw new Error('Missing pinned Node image in Dockerfile');
await rm(staging, { recursive: true, force: true });
await mkdir(join(staging, 'bin'), { recursive: true });
await mkdir(join(staging, 'runtime'), { recursive: true });
await mkdir(destination, { recursive: true });
const compilation = {
  platform: 'node',
  format: 'esm',
  bundle: true,
  target: 'node24',
  legalComments: 'inline',
  external: Object.keys(release.dependencies),
  alias: {
    '@flow-batch/protocol': join(root, 'packages/protocol/src/index.ts'),
  },
};
await build({
  ...compilation,
  entryPoints: [join(root, 'packages/orchestrator/src/main.ts')],
  outfile: join(staging, 'dist/main.mjs'),
});
await build({
  ...compilation,
  entryPoints: [
    join(root, 'packages/orchestrator/src/local-cli/native-server.ts'),
  ],
  outfile: join(staging, 'dist/native-server.mjs'),
});
await cp(
  join(root, 'packages/orchestrator/dist/public'),
  join(staging, 'dist/public'),
  { recursive: true },
);
await build({
  ...compilation,
  entryPoints: [join(root, 'packages/orchestrator/src/local-cli/main.ts')],
  outfile: join(staging, 'bin', 'flow-batch.mjs'),
  banner: { js: '#!/usr/bin/env node' },
});
for (const script of ['library', 'orders'])
  await build({
    ...compilation,
    entryPoints: [join(root, 'scripts', `${script}.mjs`)],
    outfile: join(staging, 'bin', `${script}.mjs`),
  });
await cp(
  join(root, 'packages/orchestrator/dist/public/flow-batch-mcp.mjs'),
  join(staging, 'bin', 'flow-batch-mcp.mjs'),
);
await cp(
  join(root, 'packages/extension/dist'),
  join(staging, 'runtime/extension'),
  { recursive: true },
);
for (const name of ['healthcheck', 'sync-extension'])
  await cp(
    join(root, 'scripts', `${name}.mjs`),
    join(staging, 'runtime', `${name}.mjs`),
  );
await writeFile(
  join(staging, 'runtime/Dockerfile'),
  (await readFile(join(root, 'packaging/Dockerfile'), 'utf8')).replaceAll(
    '__NODE_IMAGE__',
    nodeImage,
  ),
);
await cp(
  join(root, 'packaging/Dockerfile.dockerignore'),
  join(staging, 'runtime/Dockerfile.dockerignore'),
);
await cp(
  join(root, 'THIRD_PARTY_NOTICES.md'),
  join(staging, 'THIRD_PARTY_NOTICES.md'),
);
await writeFile(
  join(staging, 'README.md'),
  (await readFile(join(root, 'packaging/README.md'), 'utf8')).replaceAll(
    '__PACKAGE_NAME__',
    release.name,
  ),
);
await writeFile(
  join(staging, 'package.json'),
  JSON.stringify(distributionManifest(release), null, 2) + '\n',
);
await createDependencyLock(staging, release);
const candidate = await mkdtemp(join(root, '.cache/npm-candidate-'));
try {
  execFileSync(
    'npm',
    [
      'pack',
      '--offline',
      '--ignore-scripts',
      '--cache',
      join(root, '.cache/npm'),
      '--pack-destination',
      candidate,
    ],
    { cwd: staging, stdio: 'inherit' },
  );
  const file = join(candidate, release.filename);
  const review = await auditPackage(file, release);
  await rename(file, release.artifact);
  console.log(JSON.stringify(review, null, 2));
  console.log('Pacote npm gerado e auditado. Nenhum conteúdo foi publicado.');
} finally {
  await rm(candidate, { recursive: true, force: true });
}
