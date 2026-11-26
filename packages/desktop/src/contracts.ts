import type {
  BrowserStatus,
  ExecutorStatus,
  ProfileSummary,
} from '@flow-batch/flow-mcp';

export interface DesktopSnapshot {
  apiUrl: string;
  activeProfile: string;
  profiles: ProfileSummary[];
  chromeExecutable: string | null;
  browser: BrowserStatus;
  executor: ExecutorStatus;
  executorConnecting: boolean;
  executorConnectionMessage: string | null;
  videosDir: string;
  libraryDir: string;
}

export interface DesktopActionOutcome {
  snapshot: DesktopSnapshot;
  message: string;
  navigateTo?: string;
}

export interface DesktopBridge {
  getSnapshot: () => Promise<DesktopSnapshot>;
  navigate: (route: '/orders' | '/connect') => Promise<void>;
  openLogin: () => Promise<DesktopActionOutcome>;
  connectBrowser: () => Promise<DesktopActionOutcome>;
  selectProfile: (name: string) => Promise<DesktopActionOutcome>;
  createProfile: (name: string) => Promise<DesktopActionOutcome>;
  pairExecutor: () => Promise<DesktopActionOutcome>;
  installMcp: (
    client: 'antigravity' | 'codex',
  ) => Promise<DesktopActionOutcome>;
  openFolder: (target: 'videos' | 'library') => Promise<void>;
}
