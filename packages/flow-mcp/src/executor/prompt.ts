import type { Page } from 'playwright-core';
import { ExecutionError } from './errors.js';

// Read editing structure, not layout: innerText adds extra blank lines around
// browser-created divs, while textContent drops paragraph boundaries entirely.
export function composerText(element: HTMLElement): string {
  const block = (node: Node): boolean =>
    node instanceof HTMLElement &&
    /^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/.test(node.tagName);
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node instanceof HTMLBRElement) {
      if (
        node.classList.contains('ProseMirror-trailingBreak') ||
        (node.nextSibling && block(node.nextSibling)) ||
        node.parentNode?.childNodes.length === 1
      )
        return '';
      return '\n';
    }
    return [...node.childNodes]
      .map((child, index, siblings) => {
        const boundary =
          index > 0 && (block(child) || block(siblings[index - 1]!));
        return (boundary ? '\n' : '') + read(child);
      })
      .join('');
  };
  return read(element);
}

export async function exactPrompt(page: Page, text: string): Promise<void> {
  const composer = page.locator('.ProseMirror[contenteditable="true"]');
  if ((await composer.count()) !== 1)
    throw new ExecutionError(
      'composer_ambiguous',
      'O compositor não foi identificado de forma única.',
      true,
    );
  await composer.fill(text);
  if ((await composer.evaluate(composerText)) !== text)
    throw new ExecutionError(
      'prompt_changed',
      'A interface não preservou o texto preparado. Nenhuma geração será enviada com texto diferente.',
      true,
    );
}
