import { element, field } from './orders-elements.js';
import { materialsEditor } from './orders-materials-editor.js';
import { formatsEditor } from './orders-format-editor.js';
export { element } from './orders-elements.js';
export { formats } from './orders-format-editor.js';

export function productEditor(parent) {
  const id = crypto.randomUUID();
  const container = element(parent, 'div', '', 'product');
  const heading = element(container, 'div', '', 'section-heading');
  element(heading, 'h3', 'Produto');
  const remove = element(heading, 'button', 'Remover produto', 'secondary');
  remove.type = 'button';
  const name = field(container, 'Nome do produto', 'input', {
    required: true,
    maxLength: 120,
  });
  const information = field(
    container,
    'Informações do produto e orientações',
    'textarea',
    {
      maxLength: 8000,
      placeholder:
        'Características confirmadas, observações e direção para o agente.',
    },
  );
  const materials = materialsEditor(container);
  const formats = formatsEditor(container, materials);
  return {
    container,
    remove,
    dispose: materials.dispose,
    async read(api) {
      const selection = await materials.read(api);
      return {
        id,
        name: name.value,
        information: information.value,
        materials: selection.materials,
        referenceId: selection.referenceId,
        groups: formats.read(selection.imported),
      };
    },
  };
}
