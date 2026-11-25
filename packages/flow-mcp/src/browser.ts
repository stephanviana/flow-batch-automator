import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright-core';
import { chromeExecutable, type BrowserConfig } from './config.js';
import { ManualLogin } from './manual-login.js';
import { withLaunchLock } from './launch-lock.js';
import { reserveBrowser } from './browser-lease.js';
import {
  FlowBrowserError,
  isFlowUrl,
  isGoogleLoginUrl,
  projectFromUrl,
} from './contracts.js';

// Bind to the endpoint written by our dedicated profile, rather than attaching
// to whichever browser happens to listen on a fixed debugging port.
export async function profileEndpoint(profile: string): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new FlowBrowserError(
      'profile_unreadable',
      'Não foi possível ler o perfil dedicado do Flow.',
    );
  }
  const [port, browserPath] = content.trim().split(/\r?\n/);
  if (
    !port ||
    !/^\d{1,5}$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    !browserPath ||
    !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath)
  )
    throw new FlowBrowserError(
      'profile_invalid',
      'O endpoint do perfil dedicado é inválido. Confira o Chrome do Flow.',
    );
  return `ws://127.0.0.1:${port}${browserPath}`;
}

export function selectFlowPage<T extends Pick<Page, 'url'>>(
  pages: T[],
  projectId?: string,
): T | null {
  let candidates = pages.filter((page) => isFlowUrl(page.url()));
  if (!candidates.length && !projectId)
    candidates = pages.filter((page) => isGoogleLoginUrl(page.url()));
  const matching = projectId
    ? candidates.filter((page) => projectFromUrl(page.url()) === projectId)
    : candidates;
  if (matching.length > 1)
    throw new FlowBrowserError(
      'ambiguous_tabs',
      'Há várias abas correspondentes no Chrome dedicado. Mantenha uma única aba para este projeto.',
    );
  if (projectId && !matching.length && candidates.length)
    throw new FlowBrowserError(
      'project_mismatch',
      'Abra o projeto solicitado com flow_browser_open_project antes da consulta.',
    );
  return matching[0] ?? null;
}

export class ProfileBrowser {
  private browser: Browser | undefined;
  private readonly manual: ManualLogin;
  constructor(private readonly config: BrowserConfig) {
    this.manual = new ManualLogin(config);
  }

  reserve(): Promise<() => Promise<void>> {
    return reserveBrowser(this.config.home);
  }

  isLoginOpen(): Promise<boolean> {
    return this.manual.isOpen();
  }

  async login(): Promise<void> {
    if (await this.connect())
      throw new FlowBrowserError(
        'close_controlled_browser',
        'Feche a janela dedicada conectada à automação antes de iniciar o login manual.',
      );
    await this.manual.open();
  }

  async connect(): Promise<Browser | null> {
    if (await this.isLoginOpen()) return null;
    if (this.browser?.isConnected()) return this.browser;
    const endpoint = await profileEndpoint(this.config.profile);
    if (!endpoint) return null;
    try {
      this.browser = await chromium.connectOverCDP(endpoint, {
        timeout: 2000,
        noDefaults: true,
      });
      return this.browser;
    } catch {
      return null;
    }
  }

  async page(projectId?: string): Promise<Page | null> {
    const browser = await this.connect();
    return browser
      ? selectFlowPage(
          browser.contexts().flatMap((context) => context.pages()),
          projectId,
        )
      : null;
  }

  async launch(): Promise<void> {
    if (await this.isLoginOpen())
      throw new FlowBrowserError(
        'manual_login_active',
        'Conclua o login e feche a janela manual antes de conectar a automação.',
      );
    if (await this.connect()) return;
    const executable = chromeExecutable(this.config);
    await mkdir(this.config.profile, { recursive: true, mode: 0o700 });
    await withLaunchLock(this.config.home, () => this.startChrome(executable));
  }

  private async startChrome(executable: string): Promise<void> {
    const child = spawn(
      executable,
      [
        `--user-data-dir=${this.config.profile}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        'https://flow.google.com/?hl=en',
      ],
      { detached: true, stdio: 'ignore' },
    );
    let failed = false;
    child.once('error', () => {
      failed = true;
    });
    child.unref();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (failed || child.exitCode !== null)
        throw new FlowBrowserError(
          'chrome_launch_failed',
          'O Chrome dedicado não iniciou. Confira o executável e a disponibilidade de uma sessão gráfica.',
        );
      if (await this.connect()) return;
      await delay(400);
    }
    throw new FlowBrowserError(
      'chrome_launch_timeout',
      'A abertura do Chrome não foi confirmada. Confira a janela antes de tentar novamente.',
    );
  }

  async disconnect(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    // For connectOverCDP, close disconnects this client and leaves Chrome open.
    await browser?.close().catch(() => {});
  }
}
