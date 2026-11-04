import { element, field } from './orders-elements.js';
import { formats, ORDER_GROUP_LIMIT } from './orders-config.js';
export { formats } from './orders-config.js';

function modePicker(parent) {
  const picker = element(parent, 'fieldset', '', 'creation-mode');
  element(picker, 'legend', 'Como criar estes vídeos?');
  const name = `creation-mode-${crypto.randomUUID()}`;
  for (const [value, title, description] of [
    [
      'standard',
      'Usar formatos padrão',
      'Escolha entre os formatos de fábrica, POV e vendedora.',
    ],
    [
      'clone',
      'Clonar um vídeo',
      'Adapte a estrutura de um vídeo de referência ao produto.',
    ],
  ]) {
    const label = element(picker, 'label', '', 'mode-choice');
    const radio = element(label, 'input');
    Object.assign(radio, {
      type: 'radio',
      name,
      value,
      checked: value === 'standard',
    });
    radio.setAttribute('aria-label', title);
    const text = element(label, 'span');
    element(text, 'strong', title);
    element(text, 'span', description, 'hint');
  }
  return picker;
}
function formatGroup(parent, materials) {
  const row = element(parent, 'div', '', 'group creation-group');
  const mode = modePicker(row);
  const controls = element(row, 'div', '', 'group-fields');
  const format = field(controls, 'Formato', 'select');
  for (const [value, title] of formats)
    if (value !== 'clone') element(format, 'option', title).value = value;
  const reference = element(controls, 'div', '', 'clone-reference');
  element(reference, 'strong', 'Vídeo de referência');
  const videoName = element(reference, 'p', '', 'hint');
  const count = field(controls, 'Variações', 'input', {
    type: 'number',
    min: '1',
    max: '20',
    value: '3',
    required: true,
  });
  const remove = element(controls, 'button', 'Remover', 'secondary');
  remove.type = 'button';
  const hint = element(
    row,
    'p',
    'O vídeo importado acima será usado automaticamente. Para clonar outro formato de vídeo, prepare outro lote.',
    'hint clone-guidance',
  );
  function refresh() {
    const clone = mode.querySelector('input:checked').value === 'clone';
    row.dataset.mode = clone ? 'clone' : 'standard';
    format.parentElement.hidden = clone;
    format.disabled = clone;
    format.required = !clone;
    reference.hidden = !clone;
    hint.hidden = !clone;
    const videos = materials.videos();
    videoName.textContent =
      videos.length === 1
        ? videos[0].label
        : videos.length > 1
          ? 'Mantenha apenas um MP4 nos materiais adicionais.'
          : 'Importe um MP4 nos materiais adicionais acima.';
  }
  mode.addEventListener('change', () => {
    format.value = '';
    materials.clearAdditional();
    refresh();
  });
  refresh();
  return {
    id: crypto.randomUUID(),
    mode,
    format,
    count,
    remove,
    row,
    refresh,
  };
}
export function formatsEditor(parent, materials) {
  element(parent, 'h4', 'Criação dos vídeos', 'creation-heading');
  const groups = element(parent, 'div');
  const add = element(parent, 'button', 'Adicionar criação', 'secondary');
  add.type = 'button';
  const choices = [];
  function refresh() {
    choices.forEach((choice) => choice.refresh());
    materials.requireVideo(
      choices.some(
        (choice) => choice.mode.querySelector('input[value="clone"]').checked,
      ),
    );
  }
  function addGroup() {
    if (choices.length >= ORDER_GROUP_LIMIT) return;
    const choice = formatGroup(groups, materials);
    choices.push(choice);
    add.disabled = choices.length >= ORDER_GROUP_LIMIT;
    choice.remove.addEventListener('click', () => {
      choices.splice(choices.indexOf(choice), 1);
      choice.row.remove();
      add.disabled = false;
      refresh();
    });
    refresh();
  }
  materials.onChange(refresh);
  add.addEventListener('click', addGroup);
  addGroup();
  return {
    read(imported) {
      if (!choices.length)
        throw new Error('Escolha pelo menos um formato para o produto.');
      const videos = materials.videos();
      const videoReferenceId =
        videos.length === 1 ? imported.get(videos[0].value) : undefined;
      return choices.map((choice) => {
        const clone =
          choice.mode.querySelector('input:checked').value === 'clone';
        if (clone && !videoReferenceId)
          throw new Error('Importe um único vídeo MP4 para clonar o formato.');
        if (!clone && !choice.format.value)
          throw new Error('Selecione o formato padrão para cada criação.');
        return {
          id: choice.id,
          format: clone ? 'clone' : choice.format.value,
          count: Number(choice.count.value),
          ...(clone ? { videoReferenceId } : {}),
        };
      });
    },
  };
}
