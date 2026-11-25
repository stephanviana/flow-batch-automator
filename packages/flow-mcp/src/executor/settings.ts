import { setTimeout as delay } from 'node:timers/promises';
import type { Locator, Page } from 'playwright-core';
import type { FlowSettings } from '@flow-batch/protocol';
import { ExecutionError } from './errors.js';

export interface GenerationSettings {
  kind: 'image' | 'video';
  model: string;
  aspect: '9:16' | '16:9';
  duration?: number;
  resolution?: '360p' | '720p';
}

export function imageModelName(model: FlowSettings['imageModel']): string {
  const names = {
    GEM_PIX_2: 'Nano Banana Pro',
    BELUGA: 'Nano Banana 2.1',
    HARBOR_SEAL: 'Nano Banana 2 Lite',
  };
  return names[model];
}

export function videoSettings(flow: FlowSettings): GenerationSettings {
  if (flow.videoModel.startsWith('abra_i2v_'))
    return {
      kind: 'video',
      model: 'Omni 1.1 Flash',
      aspect: flow.aspect,
      duration: Number(flow.videoModel.split('_')[2]?.replace('s', '')),
      resolution: flow.videoModel.endsWith('_360p') ? '360p' : '720p',
    };
  if (flow.videoModel === 'veo_3_1_i2v_lite')
    return { kind: 'video', model: 'Veo 3.1 - Lite', aspect: flow.aspect };
  throw new ExecutionError(
    'flow_model_unsupported',
    'O modelo registrado não é suportado por este executor. Os parâmetros não foram alterados.',
    true,
  );
}

async function isRadioSelected(target: Locator): Promise<boolean> {
  if (await target.isChecked().catch(() => false)) return true;
  return target.evaluate((element) => {
    const ariaChecked = element.getAttribute('aria-checked');
    if (ariaChecked !== null) return ariaChecked === 'true';
    const ariaSelected = element.getAttribute('aria-selected');
    if (ariaSelected !== null) return ariaSelected === 'true';
    const ariaPressed = element.getAttribute('aria-pressed');
    if (ariaPressed !== null) return ariaPressed === 'true';
    return element.getAttribute('data-state') === 'checked';
  });
}

async function selectRadio(target: Locator, name: string): Promise<void> {
  if (await isRadioSelected(target)) return;
  await target.click({ timeout: 5000 });
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (await isRadioSelected(target)) return;
    await delay(50);
  }
  throw new ExecutionError(
    'flow_setting_unconfirmed',
    `A configuração (${name}) não foi confirmada na interface.`,
    true,
  );
}

async function radio(page: Page, name: string): Promise<void> {
  const target = page.getByRole('radio', { name, exact: true });
  if ((await target.count()) !== 1)
    throw new ExecutionError(
      'flow_setting_missing',
      `A interface não oferece a opção registrada: ${name}.`,
      true,
    );
  await selectRadio(target, name);
}

async function model(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole('button', {
    name: 'Select model family',
    exact: true,
  });
  await trigger.click();
  const choices = page.getByRole('menuitem');
  const labels = await choices.allTextContents();
  const indices = labels
    .map((label, index) =>
      label.replace(/^[^A-Za-z]+/, '').trim() === name ? index : -1,
    )
    .filter((index) => index >= 0);
  if (indices.length !== 1)
    throw new ExecutionError(
      'flow_model_unavailable',
      `O modelo registrado ${name} não está disponível. Nenhum modelo substituto foi selecionado.`,
      true,
    );
  await choices.nth(indices[0]!).click();
  if (!(await trigger.innerText()).includes(name))
    throw new ExecutionError(
      'flow_model_unconfirmed',
      'A interface não confirmou o modelo selecionado. Nenhuma geração será enviada.',
      true,
    );
}

export async function applyGenerationSettings(
  page: Page,
  settings: GenerationSettings,
): Promise<number> {
  await page
    .getByRole('button', { name: 'Settings trigger', exact: true })
    .click();
  try {
    await radio(page, settings.kind === 'image' ? 'Image' : 'Video');
    if (settings.kind === 'video') await radio(page, 'Frames');
    await model(page, settings.model);
    await radio(page, settings.aspect);
    if (settings.resolution) {
      const resolution = page.getByRole('radio', {
        name: new RegExp(`^${settings.resolution}(?:\\s|$)`),
      });
      if ((await resolution.count()) !== 1)
        throw new ExecutionError(
          'flow_resolution_missing',
          'A resolução registrada não está disponível.',
          true,
        );
      await selectRadio(resolution, settings.resolution);
    }
    if (settings.duration) await radio(page, `${settings.duration}s`);
    await radio(page, 'x1');
    const quote = page.getByRole('link', { name: /^\d[\d,]*\s+credits?$/ });
    if ((await quote.count()) !== 1)
      throw new ExecutionError(
        'flow_quote_missing',
        'Não foi possível conferir o custo na interface. Nenhuma geração foi enviada.',
        true,
      );
    const credits = Number((await quote.innerText()).replace(/[^\d]/g, ''));
    if (!Number.isSafeInteger(credits) || credits < 0)
      throw new ExecutionError(
        'flow_quote_invalid',
        'O custo não foi confirmado.',
        true,
      );
    return credits;
  } finally {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
}
