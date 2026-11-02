export const formats = [
  ['factory', 'Fábrica Padrão'],
  ['factory-group', 'Fábrica Grupo'],
  ['factory-truck', 'Fábrica + Caminhão'],
  ['factory-inclined', 'Fábrica Esteira Inclinada'],
  ['pov', 'POV'],
  ['seller', 'Full Vendedora'],
];
export function element(parent, tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}
function field(parent, title, tag, attributes = {}) {
  const label = element(parent, 'label', title),
    input = element(label, tag);
  Object.assign(input, attributes);
  return input;
}
export function productEditor(parent) {
  const id = crypto.randomUUID(),
    container = element(parent, 'div', '', 'product');
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
  const picker = field(
    container,
    'Adicionar fotos, prints ou documentos',
    'input',
    {
      type: 'file',
      multiple: true,
      accept: '.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.json',
    },
  );
  const list = element(container, 'ul', '', 'file-list');
  const reference = field(
    container,
    'Imagem de referência para o Flow',
    'select',
    { required: true },
  );
  const groups = element(container, 'div');
  const add = element(container, 'button', 'Adicionar formato', 'secondary');
  add.type = 'button';
  let files = [];
  const choices = [];
  function renderFiles() {
    const previous = reference.value;
    list.replaceChildren();
    reference.replaceChildren();
    files.forEach((file, index) => {
      const row = element(
        list,
        'li',
        `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB `,
      );
      const drop = element(row, 'button', 'Remover', 'secondary');
      drop.type = 'button';
      drop.addEventListener('click', () => {
        files.splice(index, 1);
        renderFiles();
      });
      if (/\.(png|jpe?g|webp)$/i.test(file.name)) {
        const option = element(reference, 'option', file.name);
        option.value = String(index);
      }
    });
    if ([...reference.options].some((option) => option.value === previous))
      reference.value = previous;
  }
  picker.addEventListener('change', () => {
    files.push(...picker.files);
    picker.value = '';
    renderFiles();
  });
  function addGroup() {
    const row = element(groups, 'div', '', 'group');
    const format = field(row, 'Formato', 'select');
    for (const [value, title] of formats) {
      const option = element(format, 'option', title);
      option.value = value;
    }
    const count = field(row, 'Variações', 'input', {
      type: 'number',
      min: '1',
      max: '20',
      value: '3',
      required: true,
    });
    const remove = element(row, 'button', 'Remover', 'secondary');
    remove.type = 'button';
    const choice = { id: crypto.randomUUID(), format, count, row };
    choices.push(choice);
    remove.addEventListener('click', () => {
      choices.splice(choices.indexOf(choice), 1);
      row.remove();
    });
  }
  add.addEventListener('click', addGroup);
  addGroup();
  return {
    container,
    remove,
    async read(api) {
      if (!files.length || !reference.value || !choices.length)
        throw new Error(
          'Cada produto precisa de materiais, uma imagem de referência e pelo menos um formato.',
        );
      const imported = [];
      for (const file of files) {
        if (!file.size || file.size > 8388608)
          throw new Error(`${file.name}: use arquivos de até 8 MB.`);
        imported.push(
          await api('/manage/materials', file, {
            'Content-Type': 'application/octet-stream',
            'X-Flow-Filename': encodeURIComponent(file.name),
          }),
        );
      }
      return {
        id,
        name: name.value,
        information: information.value,
        materials: [...new Set(imported.map((material) => material.id))],
        referenceId: imported[Number(reference.value)].id,
        groups: choices.map((choice) => ({
          id: choice.id,
          format: choice.format.value,
          count: Number(choice.count.value),
        })),
      };
    },
  };
}
