import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { chromeExecutable, type BrowserConfig } from './config.js';
import { FlowBrowserError, type BrowserStatus } from './contracts.js';
import { withLaunchLock } from './launch-lock.js';

const processSchema = z.strictObject({
  pid: z.number().int().positive(),
  profile: z.string(),
});

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function manualLoginStatus(): BrowserStatus {
  return {
    phase: 'manual-login',
    projectId: null,
    language: null,
    checkedAt: Date.now(),
    message:
      'Faça login manualmente no Chrome. Ao terminar, feche essa janela e execute pnpm flow:connect para conectar a automação ao mesmo perfil.',
  };
}

export class ManualLogin {
  constructor(private readonly config: BrowserConfig) {}

  async isOpen(): Promise<boolean> {
    let content: string;
    try {
      content = await readFile(
        join(this.config.home, 'login-process.json'),
        'utf8',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new FlowBrowserError(
        'login_state_unreadable',
        'Não foi possível consultar a janela de login manual.',
      );
    }
    try {
      const stored = processSchema.parse(JSON.parse(content));
      return stored.profile === this.config.profile && running(stored.pid);
    } catch {
      throw new FlowBrowserError(
        'login_state_invalid',
        'O estado local da janela de login é inválido.',
      );
    }
  }

  async open(): Promise<void> {
    if (await this.isOpen()) return;
    const executable = chromeExecutable(this.config);
    await mkdir(this.config.profile, { recursive: true, mode: 0o700 });
    await withLaunchLock(this.config.home, async () => {
      if (!(await this.isOpen())) await this.start(executable);
    });
  }

  private async start(executable: string): Promise<void> {
    // No CDP, Playwright connection, injected scripts or automation flags during
    // credential entry. The user operates the normal browser directly.
    const child = spawn(
      executable,
      [
        `--user-data-dir=${this.config.profile}`,
        '--no-default-browser-check',
        'https://flow.google.com/?hl=en',
      ],
      { detached: true, stdio: 'ignore' },
    );
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () =>
        reject(
          new FlowBrowserError(
            'chrome_login_failed',
            'Não foi possível abrir o Chrome para login manual.',
          ),
        ),
      );
    });
    child.unref();
    await delay(300);
    if (!child.pid || child.exitCode !== null)
      throw new FlowBrowserError(
        'chrome_login_failed',
        'A janela de login não foi confirmada. Confira se já existe uma janela usando o perfil dedicado.',
      );
    await writeFile(
      join(this.config.home, 'login-process.json'),
      JSON.stringify({ pid: child.pid, profile: this.config.profile }),
      { mode: 0o600 },
    );
  }
}
