import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LibraryFiles } from '@flow-batch/protocol';
import { readText } from './files.js';
import { initialRouting } from './routing.js';

export function seedFiles(assets: URL): LibraryFiles {
  const root = fileURLToPath(new URL('library-seed/', assets));
  const files: LibraryFiles = {};
  function walk(folder: string, prefix: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(folder, entry.name), relative);
      else
        files[relative] = readText(join(folder, entry.name))
          .replaceAll('agents/', 'instrucoes/')
          .replaceAll('skills/', 'fluxos/');
    }
  }
  walk(root, '');
  files['instrucoes/rotas.json'] =
    JSON.stringify(initialRouting, null, 2) + '\n';
  return files;
}
