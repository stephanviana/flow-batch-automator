import {
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function regularFile(path: string): Promise<Buffer | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error(`Use um arquivo regular, sem link simbólico: ${path}`);
    return readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function ensureDirectory(path: string): Promise<void> {
  const absolute = resolve(path),
    parent = dirname(absolute);
  if (parent !== absolute && absolute !== parse(absolute).root)
    await ensureDirectory(parent);
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error(`Use uma pasta regular, sem link simbólico: ${absolute}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(absolute, { mode: 0o700 });
  }
}
export async function unchanged(
  path: string,
  original: Buffer | null,
): Promise<void> {
  const current = await regularFile(path);
  if (original === null ? current !== null : !current?.equals(original))
    throw new Error(
      `O arquivo mudou durante a instalação. Execute novamente: ${path}`,
    );
}
export async function backupFile(
  path: string,
  contents: Buffer | null,
): Promise<string | null> {
  if (contents === null) return null;
  const folder = join(dirname(path), '.flow-batch-backups');
  await ensureDirectory(folder);
  const backup = join(folder, `${Date.now()}-${randomUUID()}.bak`);
  await writeFile(backup, contents, { flag: 'wx', mode: 0o600 });
  return backup;
}
export async function atomicReplace(
  path: string,
  contents: Buffer,
  expected: Buffer | null,
): Promise<void> {
  await ensureDirectory(dirname(path));
  const temporary = join(dirname(path), `.flow-install-${randomUUID()}.tmp`);
  await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
  try {
    await unchanged(path, expected);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
export async function rollbackConnector(
  path: string,
  installed: Buffer,
  original: Buffer | null,
): Promise<void> {
  await unchanged(path, installed);
  if (original) await atomicReplace(path, original, installed);
  else await unlink(path);
}
