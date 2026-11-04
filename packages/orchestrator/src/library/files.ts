import {
  constants,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  libraryFileSchema,
  libraryFilesSchema,
  type LibraryFiles,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

export function directory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
    throw new HttpError(
      409,
      'A biblioteca exige pastas locais sem links simbólicos.',
    );
}
export function readText(path: string, limit = 16_777_216): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (lstatSync(path).size > limit)
      throw new HttpError(413, 'Arquivo da biblioteca excede o limite.');
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}
export function atomicWrite(path: string, contents: string): void {
  directory(dirname(path));
  const temporary = join(dirname(path), `.flow-${randomUUID()}`);
  writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}
export function draftFiles(root: string): LibraryFiles {
  const files: LibraryFiles = {};
  function walk(folder: string, prefix: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink())
        throw new HttpError(409, 'Remova links simbólicos da biblioteca.');
      if (entry.isDirectory()) walk(join(folder, entry.name), relative);
      else {
        libraryFileSchema.parse(relative);
        if (Object.keys(files).length >= 128)
          throw new HttpError(413, 'A biblioteca permite até 128 arquivos.');
        files[relative] = readText(join(folder, entry.name), 1_048_576);
      }
    }
  }
  for (const name of ['instrucoes', 'fluxos', 'swipes']) {
    const path = join(root, name);
    if (existsSync(path)) {
      directory(path);
      walk(path, name);
    }
  }
  return Object.keys(files).length ? libraryFilesSchema.parse(files) : files;
}
export function writeDraft(root: string, files: LibraryFiles): void {
  for (const [name, text] of Object.entries(files)) {
    libraryFileSchema.parse(name);
    let parent = root;
    for (const part of name.split('/').slice(0, -1)) {
      parent = join(parent, part);
      directory(parent);
    }
    atomicWrite(join(root, name), text);
  }
}
