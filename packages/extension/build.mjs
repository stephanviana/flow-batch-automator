import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const outputDirectory = new URL('./dist/', import.meta.url);
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: ['src/worker.ts', 'src/sidepanel.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
});
await cp(new URL('./public/', import.meta.url), outputDirectory, {
  recursive: true,
});
await cp(
  new URL('../ui/theme.css', import.meta.url),
  new URL('theme.css', outputDirectory),
);
const digest = createHash('sha256');
const manifest = JSON.parse(
  await readFile(new URL('manifest.json', outputDirectory), 'utf8'),
);
for (const filename of (await readdir(outputDirectory)).sort()) {
  digest.update(filename);
  digest.update(await readFile(new URL(filename, outputDirectory)));
}
await writeFile(
  new URL('.flow-batch-foundation.json', outputDirectory),
  JSON.stringify({
    project: 'flow-batch-automator',
    version: manifest.version,
    build: digest.digest('hex'),
  }) + '\n',
);
