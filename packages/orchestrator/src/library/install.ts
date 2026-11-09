import { lstatSync, readdirSync, mkdirSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type LibraryFiles } from '@flow-batch/protocol';
import { atomicWrite, draftFiles, readText } from './files.js';
import { emptyModules, modulePaths } from './modular.js';
import { validateLibrary } from './routing.js';
import { filesHash, LibraryStore } from './store.js';

export interface InstructionInstallResult {
  status: 'installed' | 'preserved';
  files: number;
}
export function bundledInstructions(source: string): LibraryFiles {
  const instructions = draftFiles(source);
  if (
    Object.keys(instructions).length !== modulePaths.length ||
    modulePaths.some((path) => instructions[path] === undefined)
  )
    throw new Error('A edição distribuída exige base.md e os oito formatos.');
  validateLibrary(instructions);
  return instructions;
}
function untouchedScaffold(root: string): boolean {
  const allowed = [
    'base.md',
    'formatos',
    '.historico',
    'instrucoes.json',
    'biblioteca.json',
  ];
  return (
    readdirSync(root).every((name) => allowed.includes(name)) &&
    filesHash(draftFiles(root)) === filesHash(emptyModules()) &&
    readdirSync(join(root, '.historico')).length === 0
  );
}
function populateScaffold(
  root: string,
  original: LibraryFiles,
  edition: LibraryFiles,
): void {
  const written: string[] = [];
  try {
    for (const path of modulePaths) {
      const destination = join(root, path);
      if (readText(destination) !== original[path])
        throw new Error(
          'As instruções mudaram durante setup; preserve as edições e tente novamente.',
        );
      atomicWrite(destination, edition[path]!);
      written.push(path);
    }
  } catch (failure) {
    const failures: unknown[] = [failure];
    for (const path of written.reverse()) {
      try {
        const destination = join(root, path);
        if (readText(destination) === edition[path])
          atomicWrite(destination, original[path]!);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Falha ao instalar instruções; confira os arquivos antes de repetir setup.',
        { cause: failure },
      );
    throw failure;
  }
}
export function installInstructions(
  source: string,
  destination: string,
): InstructionInstallResult {
  const edition = bundledInstructions(source);
  if (resolve(source) === resolve(destination))
    return { status: 'preserved', files: Object.keys(edition).length };
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  // Validate existing paths before LibraryStore may create metadata or scaffolds.
  if (existing) draftFiles(destination);
  const library = new LibraryStore(destination);
  if (!untouchedScaffold(destination))
    return {
      status: 'preserved',
      files: Object.keys(library.draft().files).length,
    };
  const lock = join(destination, '.flow-install');
  mkdirSync(lock, { mode: 0o700 });
  try {
    const original = library.draft();
    if (original.hash !== filesHash(emptyModules()) || library.history().length)
      throw new Error('A biblioteca mudou durante setup. Execute novamente.');
    populateScaffold(destination, original.files, edition);
    return { status: 'installed', files: Object.keys(edition).length };
  } finally {
    rmdirSync(lock);
  }
}
