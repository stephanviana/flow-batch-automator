import { api } from './management-api.js';
const $ = (id) => document.getElementById(id);
let state,
  backup,
  backupExpected,
  loadedPath,
  dirty = false,
  busy = false;
async function action(operation) {
  if (busy) return;
  busy = true;
  $('status').className = '';
  try {
    await operation();
  } catch (error) {
    $('status').textContent = error.message;
    $('status').className = 'error';
  } finally {
    busy = false;
  }
}
function savedRequired() {
  if (dirty) throw new Error('Salve o texto do rascunho antes de continuar.');
}
function options(select, values, previous) {
  select.replaceChildren(
    ...values.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
  if (values.some(([value]) => value === previous)) select.value = previous;
}
async function comparison() {
  if (!$('files').value || !$('revision').value) return;
  const file = await api('/manage/library/file', {
    path: $('files').value,
    revision: $('revision').value,
  });
  $('comparison').value = file.text;
  $('difference').textContent =
    file.text === $('editor').value
      ? 'Conteúdo igual à revisão selecionada.'
      : 'O rascunho difere da revisão selecionada. Compare os textos antes de publicar.';
}
async function loadFile() {
  const file = await api('/manage/library/file', { path: $('files').value });
  $('editor').value = file.text;
  loadedPath = $('files').value;
  dirty = false;
  await comparison();
}
async function refresh() {
  state = await api('/manage/library');
  options(
    $('files'),
    state.files.map((path) => [path, path]),
    $('files').value,
  );
  options(
    $('revision'),
    state.revisions.map((revision) => [
      revision.revision,
      `${new Date(revision.createdAt).toLocaleString('pt-BR')} · ${revision.message}${revision.revision === state.revision ? ' · publicada' : ''}`,
    ]),
    state.revision,
  );
  $('published').textContent =
    `Revisão publicada: ${state.revision.slice(0, 12)}. ${state.changed ? 'Há alterações no rascunho.' : 'Rascunho igual à revisão publicada.'}`;
  await loadFile();
}
$('editor').addEventListener('input', () => {
  dirty = true;
  $('difference').textContent = 'Edição ainda não salva.';
});
$('files').addEventListener(
  'change',
  () =>
    void action(async () => {
      if (dirty) $('files').value = loadedPath;
      savedRequired();
      await loadFile();
    }),
);
$('revision').addEventListener('change', () => void action(comparison));
$('refresh').addEventListener(
  'click',
  () =>
    void action(async () => {
      savedRequired();
      await refresh();
    }),
);
$('save').addEventListener(
  'click',
  () =>
    void action(async () => {
      state = await api('/manage/library/save', {
        path: $('files').value,
        text: $('editor').value,
        expectedDraftHash: state.draftHash,
      });
      dirty = false;
      await refresh();
      $('status').textContent =
        'Rascunho salvo. Publique para usar nos próximos pedidos.';
    }),
);
$('new-file').addEventListener(
  'click',
  () =>
    void action(async () => {
      savedRequired();
      const path = $('new-path').value.trim();
      if (state.files.includes(path))
        throw new Error('Este arquivo já existe. Selecione-o na lista.');
      await api('/manage/library/save', {
        path,
        text: '',
        expectedDraftHash: state.draftHash,
      });
      await refresh();
      $('files').value = path;
      await loadFile();
    }),
);
$('swipe').addEventListener(
  'change',
  () =>
    void action(async () => {
      savedRequired();
      const file = $('swipe').files[0];
      if (!file) return;
      if (file.size > 262144) throw new Error('Use um swipe com até 256 KB.');
      const path = `swipes/${file.name}`;
      if (state.files.includes(path))
        throw new Error(
          'Já existe um swipe com esse nome. Edite-o ou use outro nome para comparar as referências.',
        );
      await api('/manage/library/save', {
        path,
        text: await file.text(),
        expectedDraftHash: state.draftHash,
      });
      await refresh();
      $('files').value = path;
      await loadFile();
    }),
);
$('publish').addEventListener(
  'click',
  () =>
    void action(async () => {
      savedRequired();
      await api('/manage/library/publish', {
        expectedDraftHash: state.draftHash,
        message: $('message').value || 'Atualização da biblioteca',
      });
      await refresh();
      $('status').textContent =
        'Biblioteca publicada. As reservas existentes preservam sua revisão.';
    }),
);
$('restore').addEventListener(
  'click',
  () =>
    void action(async () => {
      savedRequired();
      await api('/manage/library/restore', {
        revision: $('revision').value,
        expectedDraftHash: state.draftHash,
      });
      await refresh();
      $('status').textContent =
        'Revisão restaurada no rascunho. Revise e publique quando estiver pronto.';
    }),
);
$('export').addEventListener(
  'click',
  () =>
    void action(async () => {
      savedRequired();
      const blob = await api('/manage/library/export', undefined, {}, true);
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = 'flow-biblioteca.json';
      link.click();
      URL.revokeObjectURL(url);
    }),
);
$('backup').addEventListener(
  'change',
  () =>
    void action(async () => {
      backup = undefined;
      $('import').disabled = true;
      const file = $('backup').files[0];
      if (!file) return;
      if (file.size > 60_000_000)
        throw new Error('Use um backup com até 60 MB.');
      const candidate = JSON.parse(await file.text());
      const preview = await api('/manage/library/import-preview', candidate);
      $('import-preview').textContent =
        `${preview.revisions} revisões. ${preview.changes.length} arquivos alterados.\nArquivos existentes que serão substituídos ou retirados do rascunho:\n${preview.conflicts.join('\n') || 'Nenhum.'}\n\nTodos os arquivos alterados:\n${preview.changes.join('\n') || 'Nenhum.'}`;
      backup = candidate;
      backupExpected = preview.expectedDraftHash;
      $('import').disabled = false;
    }),
);
$('import').addEventListener(
  'click',
  () =>
    void action(async () => {
      savedRequired();
      if (!backup) return;
      await api('/manage/library/import', {
        backup,
        expectedDraftHash: backupExpected,
      });
      backup = undefined;
      $('import').disabled = true;
      await refresh();
      $('status').textContent =
        'Biblioteca importada com seu histórico e rascunho.';
    }),
);
$('download-mcp').addEventListener(
  'click',
  () =>
    void action(async () => {
      const blob = await api('/manage/agent/download', undefined, {}, true);
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = 'flow-batch-mcp.mjs';
      link.click();
      URL.revokeObjectURL(url);
    }),
);
void action(refresh);
