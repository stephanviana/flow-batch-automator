import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LibraryStore } from '../packages/orchestrator/dist/library/store.js';
import { seedFiles } from '../packages/orchestrator/dist/library/seed.js';

const [command, destination] = process.argv.slice(2);
if (command !== 'init' || !destination) {
  console.error('Uso: pnpm library init CAMINHO_DA_BIBLIOTECA');
  process.exitCode = 1;
} else {
  const path = resolve(destination);
  const assets = new URL(
    '../packages/orchestrator/dist/public/',
    import.meta.url,
  );
  const library = new LibraryStore(path, seedFiles(assets));
  console.log(
    JSON.stringify(
      {
        libraryDirectory: path,
        libraryId: library.current().libraryId,
        revision: library.current().revision,
        configuration: `LIBRARY_DIR=${path}`,
        uri: pathToFileURL(path).href,
      },
      null,
      2,
    ),
  );
}
