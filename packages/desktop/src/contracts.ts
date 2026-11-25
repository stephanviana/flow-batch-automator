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
  workerRunning: boolean;
  queueRunning: boolean;
  blockedByReview: boolean;
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
  startOrPairExecutor: () => Promise<DesktopActionOutcome>;
  toggleQueue: () => Promise<DesktopActionOutcome>;
  installMcp: (
    client: 'antigravity' | 'codex',
  ) => Promise<DesktopActionOutcome>;
  openFolder: (target: 'videos' | 'library') => Promise<void>;
}
