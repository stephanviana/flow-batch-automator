import { cp, lstat, mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const markerName = '.flow-batch-foundation.json';

async function exists(filename) {
  try {
    return await lstat(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function validateDestination(destination, project) {
  await mkdir(destination, { recursive: true });
  if (!(await lstat(destination)).isDirectory())
    throw new Error('Destination must be a directory, not a symbolic link');
  const entries = await readdir(destination);
  if (entries.length > 0) {
    const marker = await exists(join(destination, markerName));
    if (!marker || marker.isSymbolicLink()) {
      throw new Error(
        'Destination contains an existing installation. Preserve it and choose an empty WIN_EXTENSION_DIR before syncing.',
      );
    }
    const installed = JSON.parse(
      await readFile(join(destination, markerName), 'utf8'),
    );
    if (installed.project !== project)
      throw new Error('Destination belongs to another project');
  }
}

async function copyRegularFile(source, destination, filename) {
  const target = join(destination, filename);
  const temporary = `${target}.flow-batch-tmp`;
  const sourceInfo = await lstat(join(source, filename));
  if (!sourceInfo.isFile())
    throw new Error('Extension source must contain regular files only');
  for (const path of [target, temporary]) {
    const info = await exists(path);
    if (info && !info.isFile())
      throw new Error('Destination contains a non-regular file');
  }
  await cp(join(source, filename), temporary);
  await rename(temporary, target);
}

/** @param {string} sourceDirectory @param {string} destinationDirectory @returns {Promise<void>} */
export async function syncExtension(sourceDirectory, destinationDirectory) {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  if (source === destination)
    throw new Error('Source and destination must differ');
  const sourceMarker = JSON.parse(
    await readFile(join(source, markerName), 'utf8'),
  );
  if (sourceMarker.project !== 'flow-batch-automator')
    throw new Error('Invalid extension source');
  await validateDestination(destination, sourceMarker.project);
  const filenames = (await readdir(source)).filter(
    (filename) => filename !== markerName,
  );
  filenames.push(markerName); // Publish the build marker last.
  for (const filename of filenames) {
    await copyRegularFile(source, destination, filename);
  }
  console.log(`Extension synced (${sourceMarker.build}). Reload it in Chrome.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  syncExtension(
    process.argv[2] ?? '/extension',
    process.argv[3] ?? '/destination',
  ).catch(() => {
    console.error(
      'Extension sync failed. Check permissions and preserve any existing installation; use an empty WIN_EXTENSION_DIR. Orchestrator startup is blocked.',
    );
    process.exitCode = 1;
  });
}
