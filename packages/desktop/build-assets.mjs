import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const destination = resolve(import.meta.dirname, 'dist', 'public');
await mkdir(destination, { recursive: true });
await cp(new URL('./public/', import.meta.url), destination, {
  recursive: true,
});
await cp(
  new URL('../../shared/styles/theme.css', import.meta.url),
  resolve(destination, 'theme.css'),
);
await build({
  entryPoints: [new URL('./src/preload.ts', import.meta.url).pathname],
  outfile: resolve(import.meta.dirname, 'dist', 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
