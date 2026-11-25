import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import {
  browserConfig,
  chromeExecutable,
  type BrowserConfig,
} from './config.js';
import { FlowBrowserError } from './contracts.js';

const settingsSchema = z.strictObject({
  version: z.literal(1),
  platform: z.enum(['linux', 'win32', 'darwin']),
  chrome: z.string().min(1).max(4096),
});

export async function loadBrowserConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BrowserConfig> {
  const defaults = browserConfig(env);
  if (defaults.executable) return defaults;
  let text: string;
  try {
    text = await readFile(join(defaults.home, 'settings.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
    throw new FlowBrowserError(
      'settings_unreadable',
      'Não foi possível ler a configuração local do navegador.',
    );
  }
  let settings: z.infer<typeof settingsSchema>;
  try {
    settings = settingsSchema.parse(JSON.parse(text));
  } catch {
    throw new FlowBrowserError(
      'settings_invalid',
      'A configuração local do navegador é inválida.',
    );
  }
  if (settings.platform !== process.platform) return defaults;
  if (!isAbsolute(settings.chrome))
    throw new FlowBrowserError(
      'settings_invalid',
      'O executável salvo deve ter caminho absoluto.',
    );
  return { ...defaults, executable: settings.chrome };
}

export async function saveBrowserExecutable(
  config: BrowserConfig,
  executable: string,
): Promise<BrowserConfig> {
  const validated = browserConfig({
    FLOW_BROWSER_HOME: config.home,
    FLOW_BROWSER_CHROME: executable,
  });
  chromeExecutable(validated);
  const settings = settingsSchema.parse({
    version: 1,
    platform: process.platform,
    chrome: executable,
  });
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  const staging = join(config.home, `.settings-${randomUUID()}.tmp`);
  try {
    await writeFile(staging, JSON.stringify(settings, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(staging, join(config.home, 'settings.json'));
  } finally {
    await unlink(staging).catch(() => {});
  }
  return validated;
}
