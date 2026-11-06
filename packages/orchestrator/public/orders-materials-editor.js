import { element } from './orders-elements.js';
import { icon } from './ui-icons.js';
import { MATERIAL_LIMIT, VIDEO_MATERIAL_LIMIT } from './orders-config.js';

function selectionFor(file, image = false) {
  return {
    key: crypto.randomUUID(),
    file,
    image,
    preview:
      image || /\.mp4$/i.test(file.name) ? URL.createObjectURL(file) : null,
  };
}

function release(selection) {
  if (selection?.preview) URL.revokeObjectURL(selection.preview);
}

function selectionRow(list, selection, onRemove) {
  const row = element(list, 'li');
  element(
    row,
    'span',
    `${selection.file.name} · ${(selection.file.size / 1024 / 1024).toFixed(1)} MB `,
  );
  const remove = element(row, 'button', 'Remover', 'secondary');
  remove.type = 'button';
  if (selection.image)
    remove.setAttribute(
      'aria-label',
      `Remover imagem de referência: ${selection.file.name}`,
    );
  remove.addEventListener('click', onRemove);
  if (!selection.preview) return row;
  const preview = element(
    row,
    selection.image ? 'img' : 'video',
    '',
    selection.image ? 'reference-image' : 'reference-video',
  );
  preview.src = selection.preview;
  if (selection.image) preview.alt = `Referência: ${selection.file.name}`;
  else {
    preview.controls = true;
    preview.preload = 'metadata';
    preview.playsInline = true;
    preview.setAttribute('aria-label', `Prévia de ${selection.file.name}`);
  }
  return row;
}

function uploadField(
  parent,
  title,
  label,
  action,
  description,
  glyph,
  attributes,
) {
  const wrapper = element(parent, 'label', title, 'upload-field');
  const tile = element(wrapper, 'span', '', 'upload-tile');
  icon(tile, glyph);
  const text = element(tile, 'span');
  element(text, 'strong', action);
  element(text, 'small', description);
  const input = element(tile, 'input');
  Object.assign(input, { type: 'file', ...attributes });
  input.setAttribute('aria-label', label);
  return input;
}

export function materialsEditor(parent) {
  const reference = uploadField(
    parent,
    'Imagem de referência',
    'Imagem de referência para o Flow',
    'Adicionar imagem',
    `PNG, JPEG ou WebP · até ${MATERIAL_LIMIT / 1024 / 1024} MB`,
    'image',
    {
      type: 'file',
      accept: '.png,.jpg,.jpeg,.webp',
      required: true,
    },
  );
  const referenceList = element(
    parent,
    'ul',
    '',
    'file-list reference-selection',
  );
  let referenceSelection = null;
  const additional = element(parent, 'div', '', 'additional-materials');
  const picker = uploadField(
    additional,
    'Materiais adicionais',
    'Materiais adicionais (fotos, prints, documentos ou vídeos)',
    'Adicionar arquivos',
    'Fotos, documentos ou vídeo de referência',
    'paperclip',
    {
      type: 'file',
      multiple: true,
      accept: '.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.json,.mp4',
    },
  );
  picker.title = `Imagens e documentos: até ${MATERIAL_LIMIT / 1024 / 1024} MB. Para clonar: um único MP4 de até ${VIDEO_MATERIAL_LIMIT / 1024 / 1024} MB. Trocar o modo de criação limpa os materiais adicionais; a imagem de referência é mantida.`;
  const list = element(additional, 'ul', '', 'file-list');
  const videoError = element(additional, 'p', '', 'error');
  videoError.setAttribute('role', 'status');
  let videoRequired = false;
  const selections = [];
  const listeners = new Set();
  const videoSelections = () =>
    selections.filter((selection) => selection.preview && !selection.image);
  function validateVideo() {
    const count = videoSelections().length;
    const message =
      count > 1
        ? 'Use apenas um vídeo de referência por produto. Para outro vídeo, prepare outro lote.'
        : videoRequired && count === 0
          ? 'Importe um vídeo MP4 nos materiais adicionais para clonar o formato.'
          : '';
    picker.setCustomValidity(message);
    videoError.textContent = count > 1 ? message : '';
    return message;
  }
  function render() {
    list.replaceChildren();
    const files = new globalThis.DataTransfer();
    for (const selection of selections) {
      files.items.add(selection.file);
      selectionRow(list, selection, () => {
        selections.splice(selections.indexOf(selection), 1);
        release(selection);
        render();
      });
    }
    picker.files = files.files;
    validateVideo();
    for (const listener of listeners) listener();
  }
  reference.addEventListener('change', () => {
    release(referenceSelection);
    const file = reference.files[0];
    referenceSelection = file ? selectionFor(file, true) : null;
    referenceList.replaceChildren();
    if (referenceSelection)
      selectionRow(referenceList, referenceSelection, () => {
        release(referenceSelection);
        referenceSelection = null;
        reference.value = '';
        referenceList.replaceChildren();
      });
  });
  picker.addEventListener('change', () => {
    for (const file of picker.files) selections.push(selectionFor(file));
    render();
  });
  function clearAdditional() {
    for (const selection of selections) release(selection);
    selections.length = 0;
    picker.value = '';
    render();
  }
  return {
    clearAdditional,
    requireVideo(required) {
      videoRequired = required;
      validateVideo();
    },
    videos: () =>
      videoSelections().map((selection) => ({
        value: selection.key,
        label: selection.file.name,
      })),
    onChange: (listener) => listeners.add(listener),
    dispose() {
      release(referenceSelection);
      for (const selection of selections) release(selection);
      listeners.clear();
    },
    async read(api) {
      if (!referenceSelection)
        throw new Error('Escolha uma imagem do produto para o Flow.');
      const videoMessage = validateVideo();
      if (videoMessage) throw new Error(videoMessage);
      const materials = [referenceSelection, ...selections];
      if (materials.length > 30)
        throw new Error('Use até 30 materiais por produto.');
      for (const { file, preview, image } of materials) {
        const limit = preview && !image ? VIDEO_MATERIAL_LIMIT : MATERIAL_LIMIT;
        if (!file.size || file.size > limit)
          throw new Error(`${file.name}: use até ${limit / 1024 / 1024} MB.`);
      }
      const imported = new Map();
      for (const { key, file } of materials) {
        const material = await api('/manage/materials', file, {
          'Content-Type': 'application/octet-stream',
          'X-Flow-Filename': encodeURIComponent(file.name),
        });
        imported.set(key, material.id);
      }
      return {
        imported,
        materials: [...new Set(imported.values())],
        referenceId: imported.get(referenceSelection.key),
      };
    },
  };
}
