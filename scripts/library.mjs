import { resolve, join, extname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { draftFiles } from '../packages/orchestrator/dist/library/files.js';
import { previewSplit } from '../packages/orchestrator/dist/library/split.js';
import {
  LibraryStore,
  filesHash,
} from '../packages/orchestrator/dist/library/store.js';
import {
  validateLibrary,
  consolidatedDocument,
} from '../packages/orchestrator/dist/library/routing.js';
import {
  readInstallation,
  stateDirectory,
} from '../packages/orchestrator/dist/local-cli/config.js';

const [command, ...rawArgs] = process.argv.slice(2);
const preserveOriginals = rawArgs.includes('--preserve-originals');
const args = rawArgs.filter((argument) => argument !== '--preserve-originals');
try {
  const root = stateDirectory();
  const installation = await readInstallation(root);
  const defaultDirectory =
    installation?.libraryDirectory ?? join(root, 'biblioteca');
  const usesFile = ['import', 'export', 'restore'].includes(command);
  const destination =
    usesFile && args.length === 1
      ? defaultDirectory
      : (args[0] ?? defaultDirectory);
  const argument = usesFile ? args.at(-1) : undefined;
  if (
    ![
      'init',
      'import',
      'export',
      'validate',
      'restore',
      'convert',
      'split',
    ].includes(command) ||
    args.length > (usesFile ? 2 : 1) ||
    (preserveOriginals && command !== 'split')
  )
    throw new Error(
      'Uso: library init [PASTA] | import [PASTA] BIBLIOTECA.MD_OU_BACKUP.JSON | export [PASTA] DESTINO.MD_OU_JSON | validate [PASTA] | convert [PASTA] | split [PASTA] [--preserve-originals] | restore [PASTA] REVISAO',
    );
  const path = resolve(destination);
  if (command === 'split' && !preserveOriginals) {
    const files = draftFiles(path);
    console.log(
      JSON.stringify(
        { libraryDirectory: path, ...previewSplit(files, filesHash(files)) },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  const library = new LibraryStore(path);
  if (command === 'import') {
    if (!argument)
      throw new Error('Informe o arquivo do pacote de instruções.');
    const contents = await readFile(resolve(argument), 'utf8');
    if (extname(argument).toLowerCase() === '.md')
      library.importDocument(contents, library.draft().hash);
    else library.import(JSON.parse(contents), library.draft().hash);
  } else if (command === 'export') {
    if (!argument) throw new Error('Informe um novo arquivo de backup.');
    await writeFile(
      resolve(argument),
      extname(argument).toLowerCase() === '.md'
        ? consolidatedDocument(library.draft().files)
        : JSON.stringify(library.export(), null, 2) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  } else if (command === 'validate') validateLibrary(library.draft().files);
  else if (command === 'convert') library.convert(library.draft().hash);
  else if (command === 'split')
    library.split(library.draft().hash, preserveOriginals);
  else if (command === 'restore') {
    if (!argument) throw new Error('Informe a revisão a restaurar.');
    library.restore(argument, library.draft().hash);
  }
  console.log(
    JSON.stringify(
      {
        libraryDirectory: path,
        configuration: `LIBRARY_DIR=${path}`,
        ...library.status(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
