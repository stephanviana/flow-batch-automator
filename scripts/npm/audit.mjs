import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { archiveEntries } from './tar.mjs';
import { verifyDependencyLock } from './dependencies.mjs';
import { inspectEntries, localPrivateLiterals } from './privacy.mjs';
import {
  distributionManifest,
  parseReleaseJson,
  repositoryRoot,
} from './manifest.mjs';

export async function auditPackage(artifact, release, expectedGraph) {
  const bytes = await readFile(artifact);
  const entries = archiveEntries(bytes);
  const allowed = new Set(
    parseReleaseJson(
      await readFile(join(repositoryRoot, 'packaging/npm-files.json'), 'utf8'),
    ).map((path) => `package/${path}`),
  );
  const files = entries.filter((entry) => entry.type === '0');
  if (
    files.length !== allowed.size ||
    files.some((entry) => !allowed.has(entry.path)) ||
    entries.some((entry) => !['0', '5'].includes(entry.type))
  )
    throw new Error('Release audit refused unexpected or missing files.');
  const manifest = parseReleaseJson(
    files
      .find((entry) => entry.path === 'package/package.json')
      .content.toString('utf8'),
  );
  if (
    JSON.stringify(manifest) !== JSON.stringify(distributionManifest(release))
  )
    throw new Error(
      'Release manifest differs from the configured name, version or access.',
    );
  const lock = parseReleaseJson(
    files
      .find((entry) => entry.path === 'package/runtime/package-lock.json')
      .content.toString('utf8'),
  );
  verifyDependencyLock(lock, release, expectedGraph);
  if (!files.some((entry) => entry.path === 'package/dist/main.mjs'))
    throw new Error('Release has no compiled server.');
  const issues = inspectEntries(entries, await localPrivateLiterals());
  if (issues.length)
    throw new Error(
      `Release privacy audit refused ${issues.length} findings: ${[...new Set(issues.map((issue) => issue.split(': ').at(-1)))].join(', ')}. Matched values were not logged.`,
    );
  return {
    name: manifest.name,
    version: manifest.version,
    access: manifest.publishConfig.access,
    files: files.length,
    dependencies: Object.keys(lock.packages).length - 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
