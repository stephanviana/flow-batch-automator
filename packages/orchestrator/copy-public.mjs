import {
  MATERIAL_LIMIT,
  VIDEO_MATERIAL_LIMIT,
  ORDER_GROUP_LIMIT,
  preparationFormatLabels,
  cloneModeLabels,
  DEFAULT_CLONE_MODE,
  orderVideoModelLabels,
  DEFAULT_ORDER_VIDEO_MODEL,
} from '@flow-batch/protocol';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
const destination = resolve(process.argv[2], 'public');
await mkdir(destination, { recursive: true });
await cp(new URL('./public/', import.meta.url), destination, {
  recursive: true,
});
await cp(
  new URL('../../shared/styles/theme.css', import.meta.url),
  resolve(destination, 'theme.css'),
);
const browserConfiguration = {
  MATERIAL_LIMIT,
  VIDEO_MATERIAL_LIMIT,
  ORDER_GROUP_LIMIT,
  formats: Object.entries(preparationFormatLabels),
  cloneModes: Object.entries(cloneModeLabels),
  DEFAULT_CLONE_MODE,
  videoModels: Object.entries(orderVideoModelLabels),
  DEFAULT_ORDER_VIDEO_MODEL,
};
await writeFile(
  resolve(destination, 'orders-config.js'),
  Object.entries(browserConfiguration)
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
    .join('\n') + '\n',
);
await build({
  entryPoints: [new URL('./src/mcp/main.ts', import.meta.url).pathname],
  outfile: resolve(destination, 'flow-batch-mcp.mjs'),
  bundle: true,
  banner: { js: '// flow-batch-standalone-mcp:1' },
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'inline',
});
