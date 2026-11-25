import { setTimeout as delay } from 'node:timers/promises';
import type { Locator, Page } from 'playwright-core';
import { ExecutionError } from './errors.js';

export function mediaTile(page: Page, mediaId: string): Locator {
  // IDs were validated by the protocol before they can reach this selector.
  return page
    .locator('flow-grid-tile-container')
    .filter({ has: page.locator(`[data-media-id="${mediaId}" i]`) });
}

export async function waitForMedia(
  page: Page,
  mediaId: string,
  kind: 'image' | 'video',
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + (kind === 'image' ? 240000 : 900000);
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const tile = mediaTile(page, mediaId);
    if ((await tile.count()) === 1) {
      const ready = await tile
        .locator(
          kind === 'image' ? 'img[data-media-id]' : 'video[data-media-id]',
        )
        .evaluateAll((elements) =>
          elements.some((element) =>
            element instanceof HTMLImageElement
              ? element.complete && element.naturalWidth > 0
              : element instanceof HTMLVideoElement && element.readyState >= 2,
          ),
        );
      if (ready) return;
      const box = await tile.boundingBox();
      if (box)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }
    await page.waitForTimeout(1000);
  }
  throw new ExecutionError(
    'flow_media_timeout',
    'A mídia enviada ainda não foi confirmada. Confira o Flow antes de autorizar outra tentativa.',
    false,
  );
}

export async function attachImage(
  page: Page,
  mediaId: string,
  frame: boolean,
): Promise<void> {
  const tile = mediaTile(page, mediaId);
  if ((await tile.count()) !== 1)
    throw new ExecutionError(
      'source_image_unconfirmed',
      'A imagem de origem não está identificada de forma única no projeto.',
      true,
    );
  const thumbnail = await tile
    .locator('img[data-media-id]')
    .getAttribute('src');
  await page
    .getByRole('button', {
      name: frame ? 'Start' : 'Add ingredients to the prompt box',
      exact: true,
    })
    .click();
  const picker = page.getByRole('listbox', { name: 'Asset list', exact: true });
  await picker.waitFor({ state: 'visible', timeout: 10000 });
  const options = picker.getByRole('option');
  await options
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .catch(() => {});

  const deadline = Date.now() + 3000;
  let match: { index: number; stats: string } | null = null;
  let lastStats = '0 opções no seletor';
  while (Date.now() < deadline) {
    const result = await options.evaluateAll(
      (entries, input) => {
        const normalize = (raw: string | null): string | null => {
          if (!raw) return null;
          try {
            const parsed = new URL(raw, globalThis.location.href);
            if (
              (parsed.hostname === 'flow.google.com' ||
                parsed.hostname === 'lh3.googleusercontent.com') &&
              parsed.pathname.startsWith('/asb/')
            )
              return `asb:${parsed.pathname.replace(/=[^/]*$/, '')}`;
            return `${parsed.origin}${parsed.pathname.replace(/=[ws]\d+[^/]*$/i, '')}`;
          } catch {
            return raw;
          }
        };
        const targetId = input.mediaId.toLowerCase();
        const targetNorm = normalize(input.thumbnail);
        const idIndices: number[] = [];
        const exactSrcIndices: number[] = [];
        const normSrcIndices: number[] = [];
        entries.forEach((entry, index) => {
          const ownId = entry.getAttribute('data-media-id')?.toLowerCase();
          const childIds = [...entry.querySelectorAll('[data-media-id]')].map(
            (node) => node.getAttribute('data-media-id')?.toLowerCase(),
          );
          const srcs = [...entry.querySelectorAll('img')].map((img) =>
            img.getAttribute('src'),
          );
          const srcMatchesId = srcs.some((raw) => {
            if (!raw) return false;
            try {
              const parsed = new URL(raw, globalThis.location.href);
              return (
                parsed.origin === 'https://flow-content.google' &&
                parsed.pathname
                  .split('/')
                  .some((segment) => segment.toLowerCase() === targetId)
              );
            } catch {
              return false;
            }
          });
          if (ownId === targetId || childIds.includes(targetId) || srcMatchesId)
            idIndices.push(index);
          if (input.thumbnail && srcs.includes(input.thumbnail))
            exactSrcIndices.push(index);
          if (targetNorm && srcs.some((src) => normalize(src) === targetNorm))
            normSrcIndices.push(index);
        });
        const stats = `${entries.length} opções, ${idIndices.length} por ID, ${exactSrcIndices.length} por URL exata, ${normSrcIndices.length} por URL base`;
        const index =
          idIndices.length === 1
            ? idIndices[0]!
            : exactSrcIndices.length === 1
              ? exactSrcIndices[0]!
              : normSrcIndices.length === 1
                ? normSrcIndices[0]!
                : -1;
        return { index, stats };
      },
      { mediaId, thumbnail },
    );
    lastStats = result.stats;
    if (result.index >= 0) {
      match = result;
      break;
    }
    await delay(100);
  }
  if (!match) {
    await page.keyboard.press('Escape').catch(() => {});
    throw new ExecutionError(
      'source_picker_ambiguous',
      `O seletor não confirmou a imagem por ID (${lastStats}). Nenhuma imagem substituta será gerada.`,
      true,
    );
  }
  try {
    await options.nth(match.index).click();
    const closedOnSelect = await picker
      .waitFor({ state: 'hidden', timeout: 500 })
      .then(() => true)
      .catch(() => false);
    if (!closedOnSelect) {
      const add = page.getByRole('button', {
        name: 'Add to prompt',
        exact: true,
      });
      if ((await add.count()) === 1 && (await add.isVisible()))
        await add.click({ timeout: 3000 }).catch(() => {});
      await picker.waitFor({ state: 'hidden', timeout: 5000 });
    }
  } catch (error) {
    await page.keyboard.press('Escape').catch(() => {});
    throw error;
  }
}
