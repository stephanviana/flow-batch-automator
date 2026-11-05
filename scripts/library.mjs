import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { LibraryStore } from '../packages/orchestrator/dist/library/store.js';
import { validateLibrary } from '../packages/orchestrator/dist/library/routing.js';

const [command, destination, argument] = process.argv.slice(2);
try {
  if (
    !destination ||
    !['init', 'import', 'export', 'validate', 'restore'].includes(command)
  )
    throw new Error(
      'Uso: pnpm library init PASTA | import PASTA PACOTE.JSON | export PASTA BACKUP.JSON | validate PASTA | restore PASTA REVISAO',
    );
  const path = resolve(destination),
    library = new LibraryStore(path);
  if (command === 'import') {
    if (!argument)
      throw new Error('Informe o arquivo do pacote de instruções.');
    library.import(
      JSON.parse(await readFile(resolve(argument), 'utf8')),
      library.draft().hash,
    );
  } else if (command === 'export') {
    if (!argument) throw new Error('Informe um novo arquivo de backup.');
    await writeFile(
      resolve(argument),
      JSON.stringify(library.export(), null, 2) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  } else if (command === 'validate') validateLibrary(library.draft().files);
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
