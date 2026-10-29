import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = resolve(process.argv[2], 'public');
await mkdir(destination, { recursive: true });
await cp(new URL('./public/', import.meta.url), destination, {
  recursive: true,
});
