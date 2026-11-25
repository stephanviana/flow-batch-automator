import type { Page } from 'playwright-core';
import {
  FlowBrowserError,
  isFlowUrl,
  isGoogleLoginUrl,
  projectFromUrl,
  requireProject,
  type BrowserStatus,
} from './contracts.js';

const messages: Record<BrowserStatus['phase'], string> = {
  'manual-login':
    'Conclua o login manual e feche a janela antes de conectar a automação.',
  'browser-closed':
    'Use pnpm flow:login para entrar manualmente ou pnpm flow:connect para abrir uma sessão já autenticada.',
  'no-flow-tab': 'Abra o Flow na janela dedicada.',
  'login-required':
    'A conta não está autenticada. Feche essa janela e use pnpm flow:login para entrar manualmente antes de conectar a automação.',
  'project-required':
    'Abra um projeto existente do Flow para consultar suas imagens.',
  'not-ready': 'A interface do projeto ainda não está pronta para consulta.',
  busy: 'Há geração em andamento. Aguarde a conclusão antes de navegar ou consultar a grade.',
  ready: 'Projeto aberto no Chrome dedicado; consulta disponível.',
};

export function closedStatus(
  phase: 'browser-closed' | 'no-flow-tab',
): BrowserStatus {
  return {
    phase,
    projectId: null,
    language: null,
    checkedAt: Date.now(),
    message: messages[phase],
  };
}

export async function inspectSession(page: Page): Promise<BrowserStatus> {
  if (isGoogleLoginUrl(page.url()))
    return {
      ...closedStatus('no-flow-tab'),
      phase: 'login-required',
      message: messages['login-required'],
    };
  if (!isFlowUrl(page.url()))
    throw new FlowBrowserError(
      'flow_tab_missing',
      'A aba selecionada deixou o Flow.',
    );
  const before = page.url();
  const snapshot = await page.evaluate(() => ({
    language: document.documentElement.lang.slice(0, 32) || null,
    signIn: [...document.querySelectorAll('a, button')].some((element) =>
      /^(sign in|entrar|fazer login)$/i.test(element.textContent?.trim() ?? ''),
    ),
    composer: Boolean(
      document.querySelector('.ProseMirror[contenteditable="true"]'),
    ),
    grid: Boolean(
      document.querySelector(
        'flow-grid, flow-grid-tile-container, .page-container',
      ),
    ),
    busy:
      Boolean(
        document.querySelector(
          'flow-grid-tile-container [role="progressbar"], flow-grid-tile-container flow-progress-indicator, flow-grid-tile-container flow-progress-tile',
        ),
      ) ||
      [...document.querySelectorAll('flow-grid-tile-container')].some((tile) =>
        /(?:^|\s)\d{1,3}\s*%(?:\s|$)/.test(tile.textContent?.trim() ?? ''),
      ),
  }));
  if (page.url() !== before)
    throw new FlowBrowserError(
      'page_changed',
      'A aba mudou durante a consulta. Confira o projeto aberto.',
    );
  const projectId = projectFromUrl(before);
  const path = new URL(before).pathname;
  const phase: BrowserStatus['phase'] =
    path.startsWith('/about') || snapshot.signIn
      ? 'login-required'
      : !projectId
        ? 'project-required'
        : snapshot.busy
          ? 'busy'
          : snapshot.grid || snapshot.composer
            ? 'ready'
            : 'not-ready';
  return {
    phase,
    projectId,
    language: snapshot.language,
    checkedAt: Date.now(),
    message: messages[phase],
  };
}

export async function requireIdleProject(
  page: Page,
  projectId: string,
): Promise<void> {
  requireProject(page.url(), projectId);
  const status = await inspectSession(page);
  if (status.phase !== 'ready')
    throw new FlowBrowserError(status.phase, status.message);
  const pathname = new URL(page.url()).pathname;
  if (pathname.replace(/\/$/, '') !== `/project/${projectId}`)
    throw new FlowBrowserError(
      'project_view_required',
      'Volte à grade do projeto antes de consultar as imagens.',
    );
}

export async function openExistingProject(
  page: Page,
  projectId: string,
): Promise<BrowserStatus> {
  const status = await inspectSession(page);
  if (status.phase === 'busy' || status.phase === 'login-required')
    throw new FlowBrowserError(status.phase, status.message);
  if (
    status.projectId === projectId &&
    new URL(page.url()).pathname.replace(/\/$/, '') === `/project/${projectId}`
  )
    return status;
  const target = `https://flow.google.com/project/${projectId}?hl=en`;
  if (page.url() !== target) {
    const draft = await page
      .locator('.ProseMirror[contenteditable="true"]')
      .allTextContents();
    if (draft.some((text) => text.trim()))
      throw new FlowBrowserError(
        'composer_not_empty',
        'Há um texto no compositor. Preserve ou limpe esse texto manualmente antes de navegar.',
      );
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }
  requireProject(page.url(), projectId);
  return inspectSession(page);
}
