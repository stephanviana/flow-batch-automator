import {
  MATERIAL_LIMIT,
  VIDEO_MATERIAL_LIMIT,
  ORDER_GROUP_LIMIT,
  preparationFormatLabels,
} from '@flow-batch/protocol';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = resolve(process.argv[2], 'public');
await mkdir(destination, { recursive: true });
await cp(new URL('./public/', import.meta.url), destination, {
  recursive: true,
});
await cp(
  new URL('../ui/theme.css', import.meta.url),
  resolve(destination, 'theme.css'),
);
await cp(
  new URL('../../agents/animacao.md', import.meta.url),
  resolve(destination, 'animacao.md'),
);

await writeFile(
  resolve(destination, 'orders-config.js'),
  `export const MATERIAL_LIMIT = ${MATERIAL_LIMIT};\nexport const VIDEO_MATERIAL_LIMIT = ${VIDEO_MATERIAL_LIMIT};\nexport const ORDER_GROUP_LIMIT = ${ORDER_GROUP_LIMIT};\nexport const formats = ${JSON.stringify(Object.entries(preparationFormatLabels))};\n`,
);
