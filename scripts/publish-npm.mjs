import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditPackage } from './npm/audit.mjs';
import { releaseMetadata } from './npm/manifest.mjs';

// Publishing an audited copy prevents a build replacing the tarball mid-command.
const root = await mkdtemp(join(tmpdir(), 'flow-npm-publish-'));
try {
  if (process.argv.slice(2).some((arg) => arg !== '--dry-run'))
    throw new Error('Use pnpm publish:npm [--dry-run].');
  const release = await releaseMetadata();
  const copy = join(root, release.filename);
  await writeFile(copy, await readFile(release.artifact), {
    flag: 'wx',
    mode: 0o600,
  });
  const review = await auditPackage(copy, release);
  console.log(JSON.stringify(review, null, 2));
  execFileSync(
    'npm',
    [
      'publish',
      copy,
      '--ignore-scripts',
      '--registry',
      release.registry,
      '--access',
      release.access,
      ...(process.argv.includes('--dry-run') ? ['--dry-run'] : []),
    ],
    { stdio: 'inherit', cwd: root },
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
