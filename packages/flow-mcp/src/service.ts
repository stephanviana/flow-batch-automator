import type { Page } from 'playwright-core';
import type { ProfileBrowser } from './browser.js';
import {
  assetInputSchema,
  findImageInputSchema,
  projectIdSchema,
  FlowBrowserError,
  type AssetListing,
  type BrowserStatus,
  type FlowAsset,
} from './contracts.js';
import {
  closedStatus,
  inspectSession,
  openExistingProject,
} from './session.js';
import { findExistingImage, listProjectAssets } from './media.js';
import { manualLoginStatus } from './manual-login.js';

export interface BrowserAccess {
  connect: ProfileBrowser['connect'];
  page: ProfileBrowser['page'];
  launch: ProfileBrowser['launch'];
  login: ProfileBrowser['login'];
  isLoginOpen: ProfileBrowser['isLoginOpen'];
  reserve: ProfileBrowser['reserve'];
}

export class FlowBrowserService {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly browser: BrowserAccess) {}

  private exclusive<T>(
    operation: () => Promise<T>,
    reserve = true,
  ): Promise<T> {
    const result = this.pending.then(async () => {
      const release = reserve ? await this.browser.reserve() : undefined;
      try {
        return await operation();
      } finally {
        await release?.();
      }
    });
    this.pending = result.catch(() => {});
    return result;
  }

  private async requirePage(projectId?: string): Promise<Page> {
    const page = await this.browser.page(projectId);
    if (!page)
      throw new FlowBrowserError(
        'flow_tab_missing',
        'Abra o Flow no Chrome dedicado com pnpm flow:login.',
      );
    return page;
  }

  status(): Promise<BrowserStatus> {
    return this.exclusive(async () => {
      if (await this.browser.isLoginOpen()) return manualLoginStatus();
      if (!(await this.browser.connect()))
        return closedStatus('browser-closed');
      const page = await this.browser.page();
      return page ? inspectSession(page) : closedStatus('no-flow-tab');
    }, false);
  }

  login(): Promise<BrowserStatus> {
    return this.exclusive(async () => {
      await this.browser.login();
      return manualLoginStatus();
    });
  }

  connectSession(): Promise<BrowserStatus> {
    return this.exclusive(async () => {
      await this.browser.launch();
      const page = await this.browser.page();
      return page ? inspectSession(page) : closedStatus('no-flow-tab');
    });
  }

  openProject(projectId: string): Promise<BrowserStatus> {
    const validated = projectIdSchema.parse(projectId);
    return this.exclusive(async () =>
      openExistingProject(await this.requirePage(), validated),
    );
  }

  assets(input: unknown): Promise<AssetListing> {
    const validated = assetInputSchema.parse(input);
    return this.exclusive(async () =>
      listProjectAssets(await this.requirePage(validated.projectId), validated),
    );
  }

  findImage(input: unknown): Promise<{ projectId: string; image: FlowAsset }> {
    const validated = findImageInputSchema.parse(input);
    return this.exclusive(async () => {
      const listing = await listProjectAssets(
        await this.requirePage(validated.projectId),
        validated,
      );
      return {
        projectId: validated.projectId,
        image: findExistingImage(listing, validated.mediaId),
      };
    });
  }
}
