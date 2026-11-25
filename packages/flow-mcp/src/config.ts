import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { FlowBrowserError } from './contracts.js';

export const DEFAULT_PROFILE_NAME = 'default';
export const profileNameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/);

export interface BrowserConfig {
  home: string;
  profile: string;
  activeProfile?: string;
  profiles?: string[];
  executable: string | undefined;
}

export function profileDirectory(home: string, name: string): string {
  const validated = profileNameSchema.parse(name);
  return validated === DEFAULT_PROFILE_NAME
    ? join(resolve(home), 'chrome-profile')
    : join(resolve(home), 'profiles', validated);
}

export function browserConfig(
  env: NodeJS.ProcessEnv = process.env,
): BrowserConfig {
  const home =
    env.FLOW_BROWSER_HOME ?? join(homedir(), '.flow-batch', 'flow-browser');
  if (!isAbsolute(home))
    throw new FlowBrowserError(
      'invalid_config',
      'FLOW_BROWSER_HOME deve ser um caminho absoluto.',
    );
  const executable = env.FLOW_BROWSER_CHROME;
  if (executable && !isAbsolute(executable))
    throw new FlowBrowserError(
      'invalid_config',
      'FLOW_BROWSER_CHROME deve ser um caminho absoluto.',
    );
  const requestedProfile = env.FLOW_BROWSER_PROFILE;
  const activeProfile = requestedProfile
    ? profileNameSchema.safeParse(requestedProfile).data
    : DEFAULT_PROFILE_NAME;
  if (requestedProfile && !activeProfile)
    throw new FlowBrowserError(
      'invalid_config',
      'FLOW_BROWSER_PROFILE deve usar apenas letras, números, "-" e "_".',
    );
  const resolvedProfile = activeProfile ?? DEFAULT_PROFILE_NAME;
  return {
    home: resolve(home),
    profile: profileDirectory(home, resolvedProfile),
    activeProfile: resolvedProfile,
    profiles: [...new Set([DEFAULT_PROFILE_NAME, resolvedProfile])],
    executable,
  };
}

export function chromeExecutable(config: BrowserConfig): string {
  if (config.executable) {
    if (process.platform !== 'win32' && /\.exe$/i.test(config.executable))
      throw new FlowBrowserError(
        'cross_os_chrome',
        'Execute Node e Chrome no mesmo sistema: Node do Windows para Chrome do Windows, ou Chrome Linux no WSL.',
      );
    if (existsSync(config.executable)) return config.executable;
    throw new FlowBrowserError(
      'chrome_missing',
      'O executável definido em FLOW_BROWSER_CHROME não existe.',
    );
  }
  const paths: Record<string, string[]> = {
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    win32: [
      join(
        process.env.PROGRAMFILES ?? 'C:\\Program Files',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe',
      ),
      join(
        process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe',
      ),
      ...(process.env.LOCALAPPDATA
        ? [
            join(
              process.env.LOCALAPPDATA,
              'Google',
              'Chrome',
              'Application',
              'chrome.exe',
            ),
          ]
        : []),
    ],
  };
  const found = paths[process.platform]?.find((path) => existsSync(path));
  if (!found)
    throw new FlowBrowserError(
      'chrome_missing',
      'Chrome não encontrado. Defina FLOW_BROWSER_CHROME; nenhuma instalação é feita automaticamente.',
    );
  return found;
}
