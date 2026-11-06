import { element, field } from './orders-elements.js';
import { materialsEditor } from './orders-materials-editor.js';
import { formatsEditor } from './orders-format-editor.js';
import { iconButton } from './ui-icons.js';
export { element } from './orders-elements.js';
export { formats } from './orders-format-editor.js';

export function productEditor(parent) {
  const id = crypto.randomUUID();
  const container = element(parent, 'div', '', 'product');
  const heading = element(container, 'div', '', 'product-heading');
  const number = element(heading, 'span', '', 'product-number');
  const title = element(heading, 'h3', 'Produto 1');
  const toggle = iconButton(
    heading,
    'Recolher produto',
    'down',
    'product-toggle icon-button',
  );
  const remove = iconButton(heading, 'Remover produto', 'trash');
  const body = element(container, 'div', '', 'product-body');
  body.id = `product-${id}`;
  toggle.setAttribute('aria-controls', body.id);
  function expand(expanded) {
    body.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute(
      'aria-label',
      expanded ? 'Recolher produto' : 'Expandir produto',
    );
    toggle.title = expanded ? 'Recolher produto' : 'Expandir produto';
  }
  expand(true);
  toggle.addEventListener('click', () => expand(body.hidden));
  container.addEventListener('invalid', () => expand(true), true);
  const content = element(body, 'div', '', 'product-content');
  const informationColumn = element(content, 'div', '', 'product-information');
  const name = field(informationColumn, 'Nome do produto', 'input', {
    required: true,
    maxLength: 120,
    placeholder: 'Ex.: Mini ar-condicionado',
  });
  const information = field(
    informationColumn,
    'Informações e orientações',
    'textarea',
    {
      maxLength: 8000,
      placeholder: 'Características confirmadas e direção para o agente.',
    },
  );
  information.setAttribute(
    'aria-label',
    'Informações do produto e orientações',
  );
  const materialsColumn = element(content, 'div', '', 'product-materials');
  const materials = materialsEditor(materialsColumn);
  const formats = formatsEditor(body, materials);
  return {
    container,
    remove,
    renumber(index) {
      number.textContent = String(index).padStart(2, '0');
      title.textContent = `Produto ${index}`;
    },
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
