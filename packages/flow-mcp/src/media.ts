import type { Page } from 'playwright-core';
import {
  FlowBrowserError,
  requireProject,
  type AssetInput,
  type AssetListing,
  type FlowAsset,
} from './contracts.js';
import { requireIdleProject } from './session.js';

interface GridSnapshot {
  assets: FlowAsset[];
  unidentified: boolean;
  hasScroller: boolean;
  top: number;
}

async function readGrid(page: Page): Promise<GridSnapshot> {
  return page.evaluate(() => {
    const scroller = document.querySelector('.page-container');
    const assets: FlowAsset[] = [];
    let unidentified = false;
    for (const tile of document.querySelectorAll('flow-grid-tile-container')) {
      if (
        tile.querySelector(
          'flow-collection-tile, flow-error-tile, flow-scene-tile',
        )
      )
        continue;
      const image = tile.querySelector('flow-image-tile');
      const video = tile.querySelector('flow-video-tile');
      if (!image && !video) continue;
      // Signed thumbnail URLs are never identities and never leave the browser.
      const direct = tile
        .querySelector('[data-media-id]')
        ?.getAttribute('data-media-id');
      const mediaId =
        direct && /^[a-zA-Z0-9_-]{1,128}$/.test(direct) ? direct : null;
      if (!mediaId) {
        unidentified = true;
        continue;
      }
      assets.push({
        mediaId,
        title: (tile.getAttribute('aria-label') ?? '').slice(0, 500),
        kind: video ? 'video' : 'image',
      });
    }
    return {
      assets,
      unidentified,
      hasScroller: Boolean(scroller),
      top: scroller?.scrollTop ?? 0,
    };
  });
}

async function scrollGrid(page: Page, top?: number): Promise<boolean> {
  return page.evaluate((target) => {
    const scroller = document.querySelector('.page-container');
    if (!scroller) return false;
    const previous = scroller.scrollTop;
    scroller.scrollTop =
      target ?? previous + Math.max(1, scroller.clientHeight * 0.8);
    return scroller.scrollTop !== previous;
  }, top);
}

async function collectGrid(
  page: Page,
  input: AssetInput,
): Promise<AssetListing> {
  const first = await readGrid(page);
  const found = new Map<string, FlowAsset>();
  let unidentifiedTilesSeen = false;
  let reachedEnd = false;
  if (first.hasScroller) {
    await scrollGrid(page, 0);
    await page.waitForTimeout(200);
  }
  const deadline = Date.now() + 12000;
  for (
    let step = 0;
    step <= input.maxScrolls && Date.now() < deadline;
    step++
  ) {
    await requireIdleProject(page, input.projectId);
    const snapshot = await readGrid(page);
    unidentifiedTilesSeen ||= snapshot.unidentified;
    for (const asset of snapshot.assets) {
      const known = found.get(asset.mediaId);
      if (known && known.kind !== asset.kind)
        throw new FlowBrowserError(
          'ambiguous_media',
          'Um ID de mídia apareceu em tipos diferentes. Confira o projeto.',
        );
      if (!known && found.size < input.limit) found.set(asset.mediaId, asset);
    }
    if (
      found.size >= input.limit ||
      step === input.maxScrolls ||
      !snapshot.hasScroller
    )
      break;
    if (!(await scrollGrid(page))) {
      await page.waitForTimeout(400);
      if (!(await scrollGrid(page))) {
        reachedEnd = true;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  requireProject(page.url(), input.projectId);
  return {
    projectId: input.projectId,
    scope: 'current-view',
    assets: [...found.values()],
    reachedEnd,
    unidentifiedTilesSeen,
  };
}

export async function listProjectAssets(
  page: Page,
  input: AssetInput,
): Promise<AssetListing> {
  await requireIdleProject(page, input.projectId);
  const initialUrl = page.url();
  const position = await readGrid(page);
  try {
    return await collectGrid(page, input);
  } finally {
    if (position.hasScroller && page.url() === initialUrl)
      await scrollGrid(page, position.top).catch(() => {});
  }
}

export function findExistingImage(
  listing: AssetListing,
  mediaId: string,
): FlowAsset {
  const asset = listing.assets.find(
    (candidate) => candidate.mediaId === mediaId,
  );
  if (!asset || asset.kind !== 'image')
    throw new FlowBrowserError(
      'image_not_found_in_view',
      'A imagem não foi confirmada por ID na visualização consultada. Confira filtros e limites da consulta; nenhuma imagem será gerada como fallback.',
    );
  return asset;
}
