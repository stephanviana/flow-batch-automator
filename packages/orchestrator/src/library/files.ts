import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  libraryFileSchema,
  libraryFilesSchema,
  type LibraryFiles,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';
import { LIBRARY_DOCUMENT } from './document.js';
import { BASE_DOCUMENT } from './modular.js';

function localAncestors(path: string): void {
  let current = resolve(path);
  for (;;) {
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (entry?.isSymbolicLink())
      throw new HttpError(409, 'A biblioteca não admite links simbólicos.');
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
export function directory(path: string): void {
  localAncestors(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
    throw new HttpError(
      409,
      'A biblioteca exige pastas locais sem links simbólicos.',
    );
}
export function readText(path: string, limit = 16_777_216): string {
  localAncestors(path);
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new HttpError(
      409,
      'A biblioteca exige arquivos regulares sem links simbólicos.',
    );
  const fd = openSync(
    path,
    constants.O_RDONLY |
      (process.platform === 'win32'
        ? 0
        : constants.O_NOFOLLOW | constants.O_NONBLOCK),
  );
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.ino !== before.ino || file.dev !== before.dev)
      throw new HttpError(409, 'A biblioteca exige arquivos regulares.');
    if (file.size > limit)
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
  try {
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
export function draftFiles(root: string): LibraryFiles {
  const files: LibraryFiles = {};
  localAncestors(root);
  for (const name of [LIBRARY_DOCUMENT, BASE_DOCUMENT])
    if (lstatSync(join(root, name), { throwIfNoEntry: false }))
      files[name] = readText(
        join(root, name),
        name === BASE_DOCUMENT ? 1_048_576 : 8_388_608,
      );
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
  for (const name of ['instrucoes', 'formatos']) {
    const path = join(root, name);
    if (lstatSync(path, { throwIfNoEntry: false })) {
      localAncestors(path);
      if (!lstatSync(path).isDirectory())
        throw new HttpError(409, 'A biblioteca exige pastas locais.');
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
