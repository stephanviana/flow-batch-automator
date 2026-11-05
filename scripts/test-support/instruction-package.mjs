// Synthetic compiler contracts only. Never installed by the application.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
const formats = [
  'factory',
  'factory-group',
  'factory-truck',
  'factory-inclined',
  'pov',
  'full-pov',
  'seller',
  'clone',
];
export const animationTemplates = Object.entries({
  factory: 'Fábrica',
  'factory-inclined': 'Esteira inclinada',
  seller: 'Vendedora',
  pov: 'POV',
  clone: 'Clonagem',
})
  .map(
    ([role, heading]) =>
      `## ${heading} — fixture\n\n\`\`\`text\nRole: ${role}. Duration: {{duracao_segundos}}.\n{{direcao}}\n{{fala}}\nVisual exclusions: synthetic fixture.\n\`\`\``,
  )
  .join('\n\n');
export function instructionFiles() {
  return {
    'instrucoes/rotas.json': JSON.stringify({
      version: 2,
      animation: 'instrucoes/animacao.md',
      common: ['instrucoes/geral.md'],
      formats: Object.fromEntries(
        formats.map((format) => [format, [`instrucoes/${format}.md`]]),
      ),
    }),
    'instrucoes/geral.md': 'Synthetic common document.',
    'instrucoes/animacao.md': animationTemplates,
    ...Object.fromEntries(
      formats.map((format) => [
        `instrucoes/${format}.md`,
        `Synthetic ${format} document.`,
      ]),
    ),
  };
}
export function installInstructions(root) {
  for (const [path, text] of Object.entries(instructionFiles())) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text, { mode: 0o600 });
  }
}
