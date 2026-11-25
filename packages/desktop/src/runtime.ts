import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT } from '@flow-batch/protocol';
import {
  createApp,
  installInstructions,
  installMcpConnector,
  loadConfig,
  type AppConfig,
} from '@flow-batch/orchestrator';

type OrchestratorApp = ReturnType<typeof createApp>;
import {
  chromeExecutable,
  ExecutorControl,
  FlowBrowserError,
  FlowBrowserService,
  listBrowserProfiles,
  loadBrowserConfig,
  ProfileBrowser,
  saveBrowserProfile,
  type BrowserConfig,
  type BrowserStatus,
  type ExecutorStatus,
} from '@flow-batch/flow-mcp';
import type { DesktopActionOutcome, DesktopSnapshot } from './contracts.js';
import type { DesktopPaths } from './paths.js';

function detectedChrome(config: BrowserConfig): string | null {
  try {
    return chromeExecutable(config);
  } catch {
    return null;
  }
}

function preferredNodeBinary(): { executable: string; runAsNode: boolean } {
  if (!process.versions.electron)
    return { executable: process.execPath, runAsNode: false };
  const windowsNode = join(
    process.env.PROGRAMFILES ?? 'C:\\Program Files',
    'nodejs',
    'node.exe',
  );
  if (process.platform === 'win32' && existsSync(windowsNode))
    return { executable: windowsNode, runAsNode: false };
  return { executable: process.execPath, runAsNode: true };
}

export class DesktopRuntime {
  private app: OrchestratorApp | undefined;
  private appConfig: AppConfig | undefined;
  private browserConfig: BrowserConfig | undefined;
  private browser: ProfileBrowser | undefined;
  private service: FlowBrowserService | undefined;
  private executor: ExecutorControl | undefined;
  private apiUrl = `http://127.0.0.1:${DEFAULT_PORT}`;

  constructor(private readonly paths: DesktopPaths) {}

  async start(port = DEFAULT_PORT): Promise<DesktopSnapshot> {
    if (this.app) return this.snapshot();
    process.env.FLOW_BROWSER_DOWNLOADS_DIR = this.paths.downloadsDir;
    const config = loadConfig({
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: this.paths.databasePath,
      MATERIALS_DIR: this.paths.materialsDir,
      LIBRARY_DIR: this.paths.libraryDir,
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    });
    if (existsSync(this.paths.bundledLibraryDir))
      installInstructions(
        this.paths.bundledLibraryDir,
        config.libraryDirectory,
      );
    const app = createApp(config);
    await app.listen({ host: config.host, port: config.port });
    const address = app.server.address();
    const resolvedPort =
      address && typeof address !== 'string' ? address.port : config.port;
    this.apiUrl = `http://127.0.0.1:${resolvedPort}`;
    this.app = app;
    this.appConfig = config;
    await this.reloadBrowser();
    return this.snapshot();
  }

  private async reloadBrowser(): Promise<void> {
    await this.browser?.disconnect();
    const config = await loadBrowserConfig({
      ...process.env,
      FLOW_BROWSER_HOME: this.paths.browserHome,
    });
    this.browserConfig = config;
    this.browser = new ProfileBrowser(config);
    this.service = new FlowBrowserService(this.browser);
    this.executor = new ExecutorControl(config, this.apiUrl);
  }

  private requireReady(): {
    app: OrchestratorApp;
    appConfig: AppConfig;
    browserConfig: BrowserConfig;
    browser: ProfileBrowser;
    service: FlowBrowserService;
    executor: ExecutorControl;
  } {
    if (
      !this.app ||
      !this.appConfig ||
      !this.browserConfig ||
      !this.browser ||
      !this.service ||
      !this.executor
    )
      throw new Error('O aplicativo ainda não terminou de inicializar.');
    return {
      app: this.app,
      appConfig: this.appConfig,
      browserConfig: this.browserConfig,
      browser: this.browser,
      service: this.service,
      executor: this.executor,
    };
  }

  private async readExecutorSummary(
    app: OrchestratorApp,
    executor: ExecutorControl,
  ): Promise<{
    executor: ExecutorStatus;
    queueRunning: boolean;
    blockedByReview: boolean;
    activeCount: number;
  }> {
    let status: ExecutorStatus;
    try {
      status = await executor.status();
    } catch {
      status = {
        clientId: null,
        authorized: false,
        connected: false,
        needsPairing: true,
      };
    }
    const stats = await this.internalQueueState(app, status.clientId);
    return { executor: status, ...stats };
  }

  private async internalQueueState(
    app: OrchestratorApp,
    clientId: string | null,
  ): Promise<{
    queueRunning: boolean;
    blockedByReview: boolean;
    activeCount: number;
  }> {
    const login = await app.inject({
      method: 'GET',
      url: '/orders',
      headers: { host: new URL(this.apiUrl).host },
    });
    const cookie = String(login.headers['set-cookie'] ?? '').split(';')[0];
    const response = await app.inject({
      method: 'GET',
      url: '/manage/executor',
      headers: {
        host: new URL(this.apiUrl).host,
        cookie,
        'x-flow-management': '1',
      },
    });
    if (response.statusCode !== 200)
      return { queueRunning: false, blockedByReview: false, activeCount: 0 };
    const body = response.json() as {
      executor: { id: string; running: boolean } | null;
      blockedByReview: boolean;
      counts: { active: number };
    };
    const matching =
      !clientId || body.executor?.id === clientId ? body.executor : null;
    return {
      queueRunning: Boolean(matching?.running),
      blockedByReview: body.blockedByReview,
      activeCount: body.counts.active,
    };
  }

  private async ensureIdleForBrowserSwitch(): Promise<void> {
    const { app, executor, service } = this.requireReady();
    const state = await this.readExecutorSummary(app, executor);
    if (state.activeCount > 0)
      throw new FlowBrowserError(
        'execution_in_progress',
        'Aguarde a conclusão ou revise os takes ativos antes de trocar o navegador ou perfil.',
      );
    const status = await service.status().catch((): BrowserStatus => ({
      phase: 'browser-closed',
      projectId: null,
      language: null,
      checkedAt: Date.now(),
      message: '',
    }));
    if (status.phase === 'busy')
      throw new FlowBrowserError(
        'browser_busy',
        'O Chrome dedicado está com uma geração em andamento.',
      );
    await executor.stop();
  }

  async snapshot(): Promise<DesktopSnapshot> {
    const { app, browserConfig, service, executor } = this.requireReady();
    const [profiles, browserStatus, summary, worker] = await Promise.all([
      listBrowserProfiles(browserConfig),
      service.status().catch((): BrowserStatus => ({
        phase: 'browser-closed',
        projectId: null,
        language: null,
        checkedAt: Date.now(),
        message: 'Chrome fechado.',
      })),
      this.readExecutorSummary(app, executor),
      executor.workerProcess().catch(() => ({ running: false, pid: null })),
    ]);
    return {
      apiUrl: this.apiUrl,
      activeProfile: profiles.activeProfile,
      profiles: profiles.profiles,
      chromeExecutable: detectedChrome(browserConfig),
      browser: browserStatus,
      executor: summary.executor,
      workerRunning: worker.running,
      queueRunning: summary.queueRunning,
      blockedByReview: summary.blockedByReview,
      videosDir: this.paths.videosDir,
      libraryDir: this.paths.libraryDir,
    };
  }

  async openLogin(): Promise<DesktopActionOutcome> {
    const { browser, service } = this.requireReady();
    await this.ensureIdleForBrowserSwitch();
    if (await browser.connect())
      throw new FlowBrowserError(
        'close_controlled_browser',
        'Feche a janela atual do Chrome conectado à automação e clique em Login novamente.',
      );
    await service.login();
    return {
      snapshot: await this.snapshot(),
      message:
        'Chrome aberto para login manual. Ao concluir, feche essa janela e clique em "Conectar Flow".',
    };
  }

  async connectBrowser(): Promise<DesktopActionOutcome> {
    const { service } = this.requireReady();
    const status = await service.connectSession();
    return {
      snapshot: await this.snapshot(),
      message:
        status.phase === 'ready'
          ? 'Chrome conectado e pronto no projeto aberto.'
          : status.message,
    };
  }

  async selectProfile(name: string): Promise<DesktopActionOutcome> {
    const { browserConfig } = this.requireReady();
    await this.ensureIdleForBrowserSwitch();
    await this.browser?.disconnect();
    await saveBrowserProfile(browserConfig, name);
    await this.reloadBrowser();
    return {
      snapshot: await this.snapshot(),
      message: `Perfil "${name}" ativado. O pareamento local (clientId) foi preservado.`,
    };
  }

  async createProfile(name: string): Promise<DesktopActionOutcome> {
    return this.selectProfile(name);
  }

  async startOrPairExecutor(): Promise<DesktopActionOutcome> {
    const { executor, service } = this.requireReady();
    const current = await executor.status();
    if (current.needsPairing) {
      const pairing = await executor.pair();
      return {
        snapshot: await this.snapshot(),
        message: `Código de pareamento ${pairing.code}. Confirme a conexão na tela Conexões.`,
        navigateTo: `/connect?request=${pairing.requestId}`,
      };
    }
    await service.connectSession();
    await executor.start();
    return {
      snapshot: await this.snapshot(),
      message: 'Executor local iniciado e conectado à fila.',
    };
  }

  async toggleQueue(): Promise<DesktopActionOutcome> {
    const { app, executor } = this.requireReady();
    const state = await this.readExecutorSummary(app, executor);
    if (!state.executor.clientId || !state.executor.authorized)
      throw new FlowBrowserError(
        'executor_not_authorized',
        'Pareie e autorize o executor em Conexões antes de controlar a fila.',
      );
    const login = await app.inject({
      method: 'GET',
      url: '/orders',
      headers: { host: new URL(this.apiUrl).host },
    });
    const cookie = String(login.headers['set-cookie'] ?? '').split(';')[0];
    const nextAction = state.queueRunning ? 'pause' : 'start';
    const response = await app.inject({
      method: 'POST',
      url: '/manage/executor/control',
      headers: {
        host: new URL(this.apiUrl).host,
        origin: this.apiUrl,
        cookie,
        'x-flow-management': '1',
      },
      payload: { action: nextAction, clientId: state.executor.clientId },
    });
    if (response.statusCode !== 200)
      throw new Error(
        (response.json() as { error?: string }).error ??
          'Não foi possível atualizar o estado da fila.',
      );
    return {
      snapshot: await this.snapshot(),
      message: nextAction === 'pause' ? 'Fila pausada.' : 'Fila retomada.',
    };
  }

  async installMcp(
    client: 'antigravity' | 'codex',
  ): Promise<DesktopActionOutcome> {
    const node = preferredNodeBinary();
    const home = homedir();
    const result = await installMcpConnector({
      client,
      sourceFile: this.paths.standaloneMcpFile,
      homeDirectory: home,
      ...(process.env.CODEX_HOME ? { codexHome: process.env.CODEX_HOME } : {}),
      workspace: this.paths.workspaceDir,
      server: this.apiUrl,
      nodeExecutable: node.executable,
      runAsNode: node.runAsNode,
      browser: {
        entryFile: this.paths.browserMcpFile,
        homeDirectory: this.paths.browserHome,
        downloadsDirectory: this.paths.downloadsDir,
      },
      skipCheck: true,
    });
    return {
      snapshot: await this.snapshot(),
      message: `${client === 'antigravity' ? 'Antigravity' : 'Codex'} configurado com flow-batch e flow-browser (${result.configFile}).`,
    };
  }

  async stop(): Promise<void> {
    await this.executor?.stop().catch(() => {});
    await this.browser?.disconnect().catch(() => {});
    const app = this.app;
    this.app = undefined;
    await app?.close();
  }
}
