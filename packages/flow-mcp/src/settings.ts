import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import {
  browserConfig,
  chromeExecutable,
  DEFAULT_PROFILE_NAME,
  profileDirectory,
  profileNameSchema,
  type BrowserConfig,
} from './config.js';
import { FlowBrowserError } from './contracts.js';

type SupportedPlatform = 'linux' | 'win32' | 'darwin';

function currentPlatform(): SupportedPlatform {
  if (
    process.platform === 'linux' ||
    process.platform === 'win32' ||
    process.platform === 'darwin'
  )
    return process.platform;
  throw new FlowBrowserError(
    'unsupported_platform',
    'Sistema operacional não suportado para a configuração do navegador.',
  );
}

const settingsSchema = z.strictObject({
  version: z.literal(1),
  platform: z.enum(['linux', 'win32', 'darwin']),
  chrome: z.string().min(1).max(4096).optional(),
  activeProfile: profileNameSchema.optional(),
  profiles: z.array(profileNameSchema).max(32).optional(),
});

type StoredSettings = z.infer<typeof settingsSchema>;

export interface ProfileSummary {
  name: string;
  directory: string;
  initialized: boolean;
}

async function readSettings(home: string): Promise<StoredSettings | null> {
  let text: string;
  try {
    text = await readFile(join(home, 'settings.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new FlowBrowserError(
      'settings_unreadable',
      'Não foi possível ler a configuração local do navegador.',
    );
  }
  let settings: StoredSettings;
  try {
    settings = settingsSchema.parse(JSON.parse(text));
  } catch {
    throw new FlowBrowserError(
      'settings_invalid',
      'A configuração local do navegador é inválida.',
    );
  }
  if (
    settings.platform === process.platform &&
    settings.chrome &&
    !isAbsolute(settings.chrome)
  )
    throw new FlowBrowserError(
      'settings_invalid',
      'O executável salvo deve ter caminho absoluto.',
    );
  return settings;
}

async function writeSettings(
  home: string,
  settings: StoredSettings,
): Promise<void> {
  const validated = settingsSchema.parse(settings);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const staging = join(home, `.settings-${randomUUID()}.tmp`);
  try {
    await writeFile(staging, JSON.stringify(validated, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(staging, join(home, 'settings.json'));
  } finally {
    await unlink(staging).catch(() => {});
  }
}

export async function loadBrowserConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BrowserConfig> {
  const defaults = browserConfig(env);
  const settings = await readSettings(defaults.home);
  if (!settings) return defaults;
  const activeProfile =
    env.FLOW_BROWSER_PROFILE ?? settings.activeProfile ?? DEFAULT_PROFILE_NAME;
  const profiles = [
    ...new Set([
      DEFAULT_PROFILE_NAME,
      ...(settings.profiles ?? []),
      activeProfile,
    ]),
  ];
  const samePlatform = settings.platform === process.platform;
  const executable =
    defaults.executable ?? (samePlatform ? settings.chrome : undefined);
  return {
    home: defaults.home,
    profile: profileDirectory(defaults.home, activeProfile),
    activeProfile,
    profiles,
    executable,
  };
}

export async function saveBrowserExecutable(
  config: BrowserConfig,
  executable: string,
): Promise<BrowserConfig> {
  const validated = browserConfig({
    FLOW_BROWSER_HOME: config.home,
    FLOW_BROWSER_CHROME: executable,
    ...(config.activeProfile
      ? { FLOW_BROWSER_PROFILE: config.activeProfile }
      : {}),
  });
  chromeExecutable(validated);
  const existing = await readSettings(config.home);
  const activeProfile =
    config.activeProfile ?? existing?.activeProfile ?? DEFAULT_PROFILE_NAME;
  const profiles = [
    ...new Set([
      DEFAULT_PROFILE_NAME,
      ...(existing?.profiles ?? []),
      ...(config.profiles ?? []),
      activeProfile,
    ]),
  ];
  await writeSettings(config.home, {
    version: 1,
    platform: currentPlatform(),
    chrome: executable,
    activeProfile,
    profiles,
  });
  return { ...validated, activeProfile, profiles };
}

export async function saveBrowserProfile(
  config: BrowserConfig,
  name: string,
): Promise<BrowserConfig> {
  const parsed = profileNameSchema.safeParse(name);
  if (!parsed.success)
    throw new FlowBrowserError(
      'invalid_profile',
      'Nome de perfil inválido. Use apenas letras, números, "-" e "_".',
    );
  const existing = await readSettings(config.home);
  const profiles = [
    ...new Set([
      DEFAULT_PROFILE_NAME,
      ...(existing?.profiles ?? []),
      ...(config.profiles ?? []),
      parsed.data,
    ]),
  ];
  const executable =
    config.executable ??
    (existing?.platform === process.platform ? existing.chrome : undefined);
  await writeSettings(config.home, {
    version: 1,
    platform: currentPlatform(),
    ...(executable ? { chrome: executable } : {}),
    activeProfile: parsed.data,
    profiles,
  });
  return {
    home: config.home,
    profile: profileDirectory(config.home, parsed.data),
    activeProfile: parsed.data,
    profiles,
    executable,
  };
}

export async function listBrowserProfiles(
  config: BrowserConfig,
): Promise<{ activeProfile: string; profiles: ProfileSummary[] }> {
  const diskProfiles: string[] = [];
  try {
    const entries = await readdir(join(config.home, 'profiles'), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        profileNameSchema.safeParse(entry.name).success
      )
        diskProfiles.push(entry.name);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const activeProfile = config.activeProfile ?? DEFAULT_PROFILE_NAME;
  const names = [
    ...new Set([
      DEFAULT_PROFILE_NAME,
      ...(config.profiles ?? []),
      ...diskProfiles,
      activeProfile,
    ]),
  ];
  return {
    activeProfile,
    profiles: names.map((name) => {
      const directory = profileDirectory(config.home, name);
      return {
        name,
        directory,
        initialized: existsSync(join(directory, 'Default')),
      };
    }),
  };
}
