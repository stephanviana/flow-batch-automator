import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  WebContentsView,
} from 'electron';
import { DEFAULT_PORT } from '@flow-batch/protocol';
import { resolveDesktopPaths, type DesktopPaths } from './paths.js';
import { DesktopRuntime } from './runtime.js';

if (process.platform === 'win32' && process.execPath.startsWith('\\\\')) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

const TOP_BAR_HEIGHT = 96;

let mainWindow: BrowserWindow | undefined;
let barView: WebContentsView | undefined;
let appView: WebContentsView | undefined;
let runtime: DesktopRuntime | undefined;
let paths: DesktopPaths | undefined;
let quitting = false;

function layoutViews(window: BrowserWindow): void {
  if (!barView || !appView) return;
  const [width = 1360, height = 880] = window.getContentSize();
  barView.setBounds({ x: 0, y: 0, width, height: TOP_BAR_HEIGHT });
  appView.setBounds({
    x: 0,
    y: TOP_BAR_HEIGHT,
    width,
    height: Math.max(120, height - TOP_BAR_HEIGHT),
  });
}

function lockNavigation(view: WebContentsView, allowedPrefix: string): void {
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedPrefix)) event.preventDefault();
  });
}

function registerHandlers(
  currentRuntime: DesktopRuntime,
  currentPaths: DesktopPaths,
  apiUrl: string,
): void {
  ipcMain.handle('desktop:snapshot', () => currentRuntime.snapshot());
  ipcMain.handle(
    'desktop:navigate',
    (_event, route: '/orders' | '/connect') => {
      if (!['/orders', '/connect'].includes(route)) return;
      void appView?.webContents.loadURL(`${apiUrl}${route}`);
    },
  );
  ipcMain.handle('desktop:open-login', () => currentRuntime.openLogin());
  ipcMain.handle('desktop:connect-browser', () =>
    currentRuntime.connectBrowser(),
  );
  ipcMain.handle('desktop:select-profile', (_event, name: string) =>
    currentRuntime.selectProfile(name),
  );
  ipcMain.handle('desktop:create-profile', (_event, name: string) =>
    currentRuntime.createProfile(name),
  );
  ipcMain.handle('desktop:pair-executor', async () => {
    const outcome = await currentRuntime.pairExecutor();
    if (outcome.navigateTo)
      void appView?.webContents.loadURL(`${apiUrl}${outcome.navigateTo}`);
    return outcome;
  });
  ipcMain.handle(
    'desktop:install-mcp',
    (_event, client: 'antigravity' | 'codex') =>
      currentRuntime.installMcp(client),
  );
  ipcMain.handle(
    'desktop:open-folder',
    async (_event, target: 'videos' | 'library') => {
      const folder =
        target === 'library' ? currentPaths.libraryDir : currentPaths.videosDir;
      await mkdir(folder, { recursive: true });
      await shell.openPath(folder);
    },
  );
}

async function createWindow(): Promise<void> {
  paths = resolveDesktopPaths(
    process.env,
    app.isPackaged ? process.resourcesPath : undefined,
  );
  runtime = new DesktopRuntime(paths);
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const initial = await runtime.start(
    Number.isFinite(port) ? port : DEFAULT_PORT,
  );

  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: 'Flow Batch Automator',
    backgroundColor: '#0d1218',
    autoHideMenuBar: true,
  });
  mainWindow = window;

  barView = new WebContentsView({
    webPreferences: {
      preload: paths.preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  appView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.contentView.addChildView(barView);
  window.contentView.addChildView(appView);
  layoutViews(window);
  window.on('resize', () => layoutViews(window));
  window.on('closed', () => {
    mainWindow = undefined;
    barView = undefined;
    appView = undefined;
  });

  const barUrl = pathToFileURL(
    join(paths.assetsDir, 'desktop-bar.html'),
  ).toString();
  lockNavigation(barView, barUrl);
  lockNavigation(appView, initial.apiUrl);
  registerHandlers(runtime, paths, initial.apiUrl);

  await barView.webContents.loadURL(barUrl);
  await appView.webContents.loadURL(`${initial.apiUrl}/orders`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => {
    app.quit();
  });
  app.on('before-quit', (event) => {
    if (quitting || !runtime) return;
    event.preventDefault();
    quitting = true;
    void runtime.stop().finally(() => {
      app.quit();
    });
  });
  void app
    .whenReady()
    .then(createWindow)
    .catch(async (error: unknown) => {
      const detail =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error('Desktop startup failed:', detail);
      dialog.showErrorBox('Flow Batch Desktop', detail);
      await runtime?.stop().catch(() => {});
      app.exit(1);
    });
}
